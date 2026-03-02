/**
 * YouTube Audio Worker - runs on Fly.io
 *
 * Strategy 1: youtube_transcript_api (Python) - fast, no bot detection
 * Strategy 2: yt-dlp audio download + ffmpeg + Whisper + GPT
 */
import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  mkdir, readdir, readFile, writeFile, rm,
} from 'fs/promises';
import { existsSync, statSync, chmodSync } from 'fs';
import { join } from 'path';
import os from 'os';
import OpenAI from 'openai';

const app = express();
app.use(express.json());

// CORS: allow cross-origin requests from any Amplify / custom domain
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'content-type, x-worker-secret, x-filename, authorization',
  );
  // Preflight: browsers send OPTIONS before the real POST — respond immediately
  // without going through authMiddleware (which would reject it as Unauthorized)
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

const execAsync = promisify(exec);
const PORT = parseInt(process.env.PORT || '8080', 10);

// Auth
const SHARED_SECRET = process.env.WORKER_SECRET || '';

function authMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (!SHARED_SECRET) { next(); return; }
  const token = req.headers['x-worker-secret'] as string | undefined;
  if (token !== SHARED_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// Lazy OpenAI client
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

// Constants
const WHISPER_MAX_BYTES = 24 * 1024 * 1024;
const CHUNK_DURATION_SEC = 20 * 60;
const MAX_VIDEO_DURATION_SEC = 100 * 60;
const COOKIES_PATH = join(os.tmpdir(), 'yt-cookies.txt');

// Write YouTube cookies from env var (set via: flyctl secrets set YOUTUBE_COOKIES="$(cat cookies.txt)")
async function initCookies(): Promise<void> {
  const raw = process.env.YOUTUBE_COOKIES;
  if (!raw) { console.log('[worker] No YOUTUBE_COOKIES set, yt-dlp will run without cookies'); return; }
  await writeFile(COOKIES_PATH, raw, 'utf8');
  console.log(`[worker] Wrote YouTube cookies to ${COOKIES_PATH} (${raw.length} chars)`);
}

function cookiesArg(): string {
  return existsSync(COOKIES_PATH) ? `--cookies "${COOKIES_PATH}"` : '';
}

// Proxy support: set YTDLP_PROXY env var, e.g. "socks5://user:pass@host:port" or "http://user:pass@host:port"
// Webshare.io residential proxy: https://proxy.webshare.io/ (~$3/month)
function proxyArg(): string {
  const p = process.env.YTDLP_PROXY;
  return p ? `--proxy "${p}"` : '';
}

// Python script for youtube_transcript_api (bypasses bot detection via timedtext API)
const TRANSCRIPT_SCRIPT = `
import sys, json
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound

video_id = sys.argv[1]
langs = sys.argv[2:] or ['zh-TW','zh-Hant','zh-Hans','zh','en']
try:
    transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
    transcript = None
    for lang in langs:
        try:
            transcript = transcript_list.find_transcript([lang])
            break
        except: pass
    if not transcript:
        for t in transcript_list:
            transcript = t
            break
    if not transcript:
        print("NO_TRANSCRIPT", file=sys.stderr); sys.exit(1)
    data = transcript.fetch()
    print(' '.join(item['text'] for item in data if item.get('text')))
except TranscriptsDisabled:
    print("TRANSCRIPTS_DISABLED", file=sys.stderr); sys.exit(1)
except NoTranscriptFound:
    print("NO_TRANSCRIPT", file=sys.stderr); sys.exit(1)
except Exception as e:
    print(f"ERROR: {e}", file=sys.stderr); sys.exit(1)
`;

// Path to the Python transcript script (written to disk at startup to avoid shell escaping issues)
const TRANSCRIPT_SCRIPT_PATH = join(os.tmpdir(), 'yt_transcript.py');

async function ensureTranscriptScript(): Promise<void> {
  try {
    await writeFile(TRANSCRIPT_SCRIPT_PATH, TRANSCRIPT_SCRIPT, 'utf8');
    console.log('[worker] Transcript script written to', TRANSCRIPT_SCRIPT_PATH);
  } catch (e) {
    console.error('[worker] Failed to write transcript script:', e);
  }
}

async function getYouTubeTranscript(videoId: string): Promise<string | null> {
  try {
    const cmd = `python3 "${TRANSCRIPT_SCRIPT_PATH}" ${videoId} zh-TW zh-Hant zh-Hans zh en`;
    const { stdout, stderr } = await execAsync(cmd, { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
    if (stderr && !stdout.trim()) {
      console.log(`[worker] Transcript fetch stderr: ${stderr.slice(0, 200)}`);
      return null;
    }
    const text = stdout.trim();
    if (!text) return null;
    console.log(`[worker] Transcript fetched: ${text.length} chars`);
    return text;
  } catch (err: any) {
    const msg = err?.stderr || err?.message || '';
    console.log(`[worker] youtube_transcript_api: ${msg.slice(0, 200)}`);
    return null;
  }
}

// yt-dlp binary management
let ytDlpBin: string | null = null;

async function ensureYtDlp(): Promise<string> {
  if (ytDlpBin) return ytDlpBin;

  // 1. Try system yt-dlp (installed in Dockerfile)
  try {
    const { stdout } = await execAsync('yt-dlp --version', { timeout: 5000 });
    if (stdout.trim()) {
      console.log('[worker] system yt-dlp:', stdout.trim());
      ytDlpBin = 'yt-dlp';
      return ytDlpBin;
    }
  } catch { /* not in PATH */ }

  // 2. Download to /tmp
  const binDir = join(os.tmpdir(), 'yt-dlp-bin');
  const binaryPath = join(binDir, 'yt-dlp_linux');
  if (existsSync(binaryPath)) { ytDlpBin = binaryPath; return ytDlpBin; }

  console.log('[worker] Downloading yt-dlp binary...');
  await mkdir(binDir, { recursive: true });
  const assetName = process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`;
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`Download yt-dlp failed: HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();
  await writeFile(binaryPath, Buffer.from(buf));
  chmodSync(binaryPath, 0o755);
  console.log('[worker] yt-dlp ready:', binaryPath);
  ytDlpBin = binaryPath;
  return ytDlpBin;
}

// ffmpeg detection
async function ensureFfmpeg(): Promise<string> {
  const candidates = ['ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
  for (const bin of candidates) {
    try {
      const { stdout } = await execAsync(`${bin} -version`, { timeout: 10000 });
      console.log(`[worker] ffmpeg found: ${bin}`, (stdout || '').split('\n')[0]);
      return bin;
    } catch (err: any) {
      console.log(`[worker] ffmpeg check failed for "${bin}":`, err?.message?.slice(0, 200) || 'unknown error');
    }
  }
  try {
    const { stdout } = await execAsync('which ffmpeg', { timeout: 5000 });
    const found = stdout.trim();
    if (found) {
      console.log(`[worker] ffmpeg found via which: ${found}`);
      return found;
    }
  } catch (err: any) {
    console.log('[worker] which ffmpeg failed:', err?.message?.slice(0, 200));
  }
  throw new Error('ffmpeg not available on this host (all candidates failed)');
}

// Audio utilities
async function getAudioDuration(ffmpeg: string, filePath: string): Promise<number> {
  try {
    const result = await execAsync(`"${ffmpeg}" -i "${filePath}"`, { timeout: 15000 })
      .catch((e: any) => ({ stdout: '', stderr: e.stderr || e.message || '' }));
    const output = ((result as any).stdout || '') + ((result as any).stderr || '');
    const m = output.match(/Duration:\s*(\d+):(\d+):(\d+)/);
    if (m) return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
  } catch { /* ignore */ }
  return 0;
}

async function splitAudio(
  ffmpeg: string, inputPath: string, outputDir: string, chunkSec: number,
): Promise<string[]> {
  const ext = inputPath.split('.').pop()?.toLowerCase() || 'm4a';
  const pattern = join(outputDir, `chunk_%03d.${ext}`);
  const cmd = `"${ffmpeg}" -i "${inputPath}" -f segment -segment_time ${chunkSec} -c copy -reset_timestamps 1 "${pattern}"`;
  await execAsync(cmd, { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 });
  const files = await readdir(outputDir);
  return files.filter((f) => /^chunk_\d+\.\w+$/.test(f)).sort().map((f) => join(outputDir, f));
}

async function transcribeFile(filePath: string, ext: string): Promise<string> {
  const mimeMap: Record<string, string> = {
    m4a: 'audio/mp4', webm: 'audio/webm', mp3: 'audio/mpeg',
    ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav',
    mp4: 'video/mp4', aac: 'audio/aac',
  };
  const mimeType = mimeMap[ext] || 'audio/mp4';
  const buf = await readFile(filePath);
  const whisperFile = new File([buf], `audio.${ext}`, { type: mimeType });
  const result = await getOpenAI().audio.transcriptions.create({
    file: whisperFile, model: 'whisper-1', response_format: 'text', language: 'zh',
  });
  return typeof result === 'string' ? result : (result as any).text || String(result);
}

// GPT formatting
async function formatTranscript(rawText: string): Promise<string> {
  if (!rawText || rawText.trim().length < 50) return rawText.trim();
  try {
    const CHUNK_SIZE = 3000;
    const chunks = splitText(rawText.trim(), CHUNK_SIZE);
    const parts: string[] = [];
    for (const chunk of chunks) {
      const completion = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini', temperature: 0,
        messages: [
          {
            role: 'system',
            content: [
              'You are a transcript editor. Clean up the following speech transcript:',
              '1. Remove filler words and repetitions',
              '2. Fix punctuation and sentence boundaries',
              '3. Merge broken sentences for readability',
              '4. Remove clearly off-topic interjections',
              '5. Preserve the original meaning and language (keep Chinese as Chinese)',
              'Return only the cleaned transcript text, no commentary.',
            ].join('\n'),
          },
          { role: 'user', content: chunk },
        ],
        max_tokens: 4096,
      });
      parts.push(completion.choices[0]?.message?.content?.trim() ?? chunk);
    }
    return parts.join('\n\n');
  } catch (err) {
    console.warn('[worker] GPT formatting failed:', err);
    return rawText.trim();
  }
}

function splitText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxChars;
    if (end >= text.length) { chunks.push(text.slice(start)); break; }
    const breakChars = ['\u3002', '\uff0c', '\uff01', '\uff1f', '\n', ' ', '\u3001'];
    let cutAt = end;
    for (const ch of breakChars) {
      const idx = text.lastIndexOf(ch, end);
      if (idx > start + maxChars * 0.5) { cutAt = idx + 1; break; }
    }
    chunks.push(text.slice(start, cutAt));
    start = cutAt;
  }
  return chunks;
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// Main API endpoint
// ── 音頻檔案直接上傳轉錄端點（繞過 Amplify 10MB 限制）──────────────
// 前端直接 POST binary 到此端點，X-Filename header 傳檔名
// 支援最大 250MB，自動 ffmpeg 分片後逐片 Whisper 轉錄
app.post('/api/audio-transcribe',
  authMiddleware,
  express.raw({ type: '*/*', limit: '250mb' }),
  async (req: express.Request, res: express.Response) => {
    const rawFileName = (req.headers['x-filename'] as string) || 'audio.mp3';
    // Front-end encodes filename with encodeURIComponent to stay ISO-8859-1 safe
    let fileName = rawFileName;
    try { fileName = decodeURIComponent(rawFileName); } catch { /* already plain ASCII */ }
    const ext = (fileName.split('.').pop() || 'mp3').toLowerCase();
    const tmpDir = join(os.tmpdir(), `audio-upload-${Date.now()}`);
    const chunkDir = join(tmpDir, 'chunks');
    try {
      await mkdir(tmpDir, { recursive: true });
      await mkdir(chunkDir, { recursive: true });
      const audioPath = join(tmpDir, `upload.${ext}`);
      await writeFile(audioPath, req.body as Buffer);
      const fileSizeBytes = statSync(audioPath).size;
      const fileSizeMB = fileSizeBytes / (1024 * 1024);
      console.log(`[worker] Audio upload: ${fileName} (${fileSizeMB.toFixed(1)}MB)`);
      const WHISPER_MAX_BYTES = 24 * 1024 * 1024;
      const CHUNK_DURATION_SEC = 20 * 60;
      let transcript = '';
      if (fileSizeBytes <= WHISPER_MAX_BYTES) {
        console.log('[worker] Transcribing directly...');
        transcript = await transcribeFile(audioPath, ext);
      } else {
        const ffmpeg = await ensureFfmpeg();
        const chunks = await splitAudio(ffmpeg, audioPath, chunkDir, CHUNK_DURATION_SEC);
        console.log(`[worker] Split into ${chunks.length} chunks`);
        const parts: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunkPath = chunks[i];
          const chunkExt = chunkPath.split('.').pop()?.toLowerCase() || ext;
          const chunkBytes = statSync(chunkPath).size;
          if (chunkBytes > WHISPER_MAX_BYTES) { console.warn(`[worker] Chunk ${i + 1} too large, skipping`); continue; }
          console.log(`[worker] Transcribing chunk ${i + 1}/${chunks.length}...`);
          const part = await transcribeFile(chunkPath, chunkExt);
          if (part.trim()) parts.push(part.trim());
        }
        transcript = parts.join(' ');
      }
      if (!transcript || !transcript.trim()) {
        res.status(422).json({ error: 'EMPTY_TRANSCRIPTION', message: '轉錄結果為空，請確認音頻包含語音內容。' });
        return;
      }
      console.log(`[worker] Whisper done: ${transcript.length} chars, formatting...`);
      const formatted = await formatTranscript(transcript.trim());
      console.log(`[worker] Done: ${formatted.length} chars`);
      res.json({ transcript: formatted, source: 'whisper', fileName, charCount: formatted.length });
    } catch (error: any) {
      console.error('[worker] audio-transcribe error:', error);
      res.status(500).json({ error: 'TRANSCRIPTION_FAILED', message: error?.message || 'Unknown error' });
    } finally {
      try { if (existsSync(tmpDir)) await rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

app.post('/api/youtube-audio', authMiddleware, async (req: express.Request, res: express.Response) => {
  const tmpDir = join(os.tmpdir(), `yt-audio-${Date.now()}`);
  const chunkDir = join(tmpDir, 'chunks');

  try {
    const { url, startTime, endTime } = req.body;
    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'INVALID_URL', message: 'Please provide a valid YouTube URL' });
      return;
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      res.status(400).json({ error: 'INVALID_URL', message: 'Cannot extract YouTube video ID' });
      return;
    }

    console.log(`[worker] Starting: ${videoId}`);

    // Strategy 1: youtube_transcript_api (no bot detection)
    // Skip if startTime/endTime specified (cannot time-filter captions easily)
    if (!startTime && !endTime) {
      console.log('[worker] Trying YouTube transcript API first...');
      const transcriptText = await getYouTubeTranscript(videoId);
      if (transcriptText && transcriptText.length > 50) {
        console.log('[worker] Transcript available, skipping audio download');
        const formatted = await formatTranscript(transcriptText);
        res.json({
          transcript: formatted,
          source: 'youtube_transcript',
          videoId,
          charCount: formatted.length,
        });
        return;
      }
      console.log('[worker] No transcript, falling back to audio download');
    } else {
      console.log('[worker] Time range specified, skipping transcript, using audio');
    }

    // Strategy 2: yt-dlp + Whisper
    const [ytDlp, ffmpeg] = await Promise.all([ensureYtDlp(), ensureFfmpeg()]);
    await mkdir(tmpDir, { recursive: true });
    await mkdir(chunkDir, { recursive: true });

    const fakeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    const ytBase = `"${ytDlp}" --user-agent "${fakeUA}" --add-headers "Accept-Language:zh-TW,zh;q=0.9,en;q=0.8" ${cookiesArg()} ${proxyArg()}`.trim();
    // tv_embedded often bypasses bot detection; web_creator is another good option
    const playerClients = ['tv_embedded', 'ios', 'web_creator', 'android', 'mweb', 'web'];

    // Check video duration
    try {
      const { stdout: infoJson } = await execAsync(
        `${ytBase} --extractor-args "youtube:player_client=tv_embedded" --dump-json --no-playlist "https://www.youtube.com/watch?v=${videoId}"`,
        { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
      );
      const dur: number = JSON.parse(infoJson).duration || 0;
      console.log(`[worker] Duration: ${Math.round(dur / 60)} min`);
      if (dur > MAX_VIDEO_DURATION_SEC) {
        res.status(400).json({
          error: 'VIDEO_TOO_LONG',
          message: `Video is ${Math.round(dur / 60)} min, exceeds 100 min limit`,
        });
        return;
      }
    } catch { /* ignore duration check errors */ }

    // Format selector
    const fmtSel = 'bestaudio[abr<=48][ext=webm]/bestaudio[abr<=48]/bestaudio[abr<=64][ext=m4a]/bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio';
    const outTpl = join(tmpDir, '%(id)s.%(ext)s');
    let downloadOk = false;
    let lastErr = '';
    console.log('[worker] Downloading audio...');

    for (const client of playerClients) {
      const dlCmd = `${ytBase} --extractor-args "youtube:player_client=${client}" -f "${fmtSel}" --no-playlist --no-post-overwrites -o "${outTpl}" "https://www.youtube.com/watch?v=${videoId}"`;
      try {
        console.log(`[worker] Trying player_client=${client}...`);
        const { stderr } = await execAsync(dlCmd, { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 });
        if (stderr) console.log('[worker] yt-dlp stderr:', stderr.slice(0, 300));
        downloadOk = true;
        console.log(`[worker] Download succeeded with player_client=${client}`);
        break;
      } catch (dlError: any) {
        lastErr = dlError?.stderr || dlError?.message || 'unknown';
        console.log(`[worker] player_client=${client} failed:`, lastErr.slice(0, 300));
      }
    }

    if (!downloadOk) {
      try {
        console.log('[worker] Trying default (no player_client)...');
        const dlCmd = `${ytBase} -f "${fmtSel}" --no-playlist --no-post-overwrites -o "${outTpl}" "https://www.youtube.com/watch?v=${videoId}"`;
        const { stderr } = await execAsync(dlCmd, { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 });
        if (stderr) console.log('[worker] yt-dlp stderr:', stderr.slice(0, 300));
        downloadOk = true;
        console.log('[worker] Download succeeded with default');
      } catch (dlError: any) {
        lastErr = dlError?.stderr || dlError?.message || 'unknown';
        console.log('[worker] Default also failed:', lastErr.slice(0, 300));
      }
    }

    if (!downloadOk) {
      const isBotBlock = lastErr.includes('Sign in to confirm') || lastErr.includes('not a bot');
      res.status(isBotBlock ? 403 : 500).json({
        error: isBotBlock ? 'BOT_DETECTED' : 'DOWNLOAD_FAILED',
        message: isBotBlock
          ? 'YouTube bot detection triggered. Please try again later.'
          : `Download failed: ${lastErr.slice(0, 200)}`,
      });
      return;
    }

    // Find downloaded audio file
    const allFiles = await readdir(tmpDir);
    const audioFile = allFiles.find((f) => /\.(m4a|webm|mp3|ogg|opus|wav|mp4|aac)$/i.test(f));
    if (!audioFile) {
      console.error('[worker] No audio file. Files:', allFiles);
      res.status(500).json({ error: 'DOWNLOAD_FAILED', message: 'No audio file found after download' });
      return;
    }

    let audioPath = join(tmpDir, audioFile);
    const ext = audioFile.split('.').pop()?.toLowerCase() || 'm4a';

    // Trim to time range if specified
    if (startTime || endTime) {
      const trimmedPath = join(tmpDir, `trimmed.${ext}`);
      const ssArg = startTime ? `-ss "${startTime}"` : '';
      const toArg = endTime ? `-to "${endTime}"` : '';
      const trimCmd = `"${ffmpeg}" -i "${audioPath}" ${ssArg} ${toArg} -c copy "${trimmedPath}"`;
      console.log(`[worker] Trimming: ${startTime || '00:00:00'} to ${endTime || 'end'}`);
      await execAsync(trimCmd, { timeout: 60_000, maxBuffer: 50 * 1024 * 1024 });
      if (existsSync(trimmedPath)) audioPath = trimmedPath;
    }

    const fileBytes = statSync(audioPath).size;
    const fileMB = fileBytes / (1024 * 1024);
    console.log(`[worker] Audio: ${fileMB.toFixed(1)} MB`);

    // Transcribe with Whisper
    let transcript = '';
    if (fileBytes <= WHISPER_MAX_BYTES) {
      console.log('[worker] Transcribing directly...');
      transcript = await transcribeFile(audioPath, ext);
    } else {
      console.log(`[worker] ${fileMB.toFixed(1)}MB > 24MB, splitting...`);
      const dur = await getAudioDuration(ffmpeg, audioPath);
      const chunks = await splitAudio(ffmpeg, audioPath, chunkDir, CHUNK_DURATION_SEC);
      console.log(`[worker] ${chunks.length} chunks (dur ~${Math.round(dur / 60)}min)`);
      const parts: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunkBytes = statSync(chunks[i]).size;
        if (chunkBytes > WHISPER_MAX_BYTES) { console.warn(`[worker] Chunk ${i + 1} too large, skip`); continue; }
        const chunkExt = chunks[i].split('.').pop()?.toLowerCase() || ext;
        const part = await transcribeFile(chunks[i], chunkExt);
        if (part.trim()) parts.push(part.trim());
      }
      transcript = parts.join(' ');
    }

    if (!transcript.trim()) {
      res.status(422).json({ error: 'EMPTY_TRANSCRIPTION', message: 'Transcription returned empty result' });
      return;
    }

    console.log(`[worker] Whisper done: ${transcript.length} chars, formatting...`);
    const formatted = await formatTranscript(transcript.trim());
    console.log(`[worker] Done: ${formatted.length} chars`);

    res.json({
      transcript: formatted,
      source: 'whisper',
      videoId,
      charCount: formatted.length,
    });
  } catch (error: any) {
    console.error('[worker] Error:', error);
    const msg = error?.message || '';

    if (msg.includes('Sign in to confirm') || msg.includes('bot')) {
      res.status(503).json({
        error: 'YOUTUBE_BLOCKED',
        message: 'YouTube bot detection triggered. Please try again later.',
      });
      return;
    }
    if (msg.includes('Video unavailable') || msg.includes('Private video')) {
      res.status(404).json({ error: 'VIDEO_UNAVAILABLE', message: 'Video is unavailable or private' });
      return;
    }

    res.status(500).json({ error: 'TRANSCRIPTION_FAILED', message: msg || 'Unknown error' });
  } finally {
    try {
      if (existsSync(tmpDir)) await rm(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
});

// Health check
app.get('/health', (_req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', service: 'youtube-audio-worker' });
});

// Start server
Promise.all([initCookies(), ensureTranscriptScript()]).then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[worker] YouTube Audio Worker running on port ${PORT}`);
  });
});