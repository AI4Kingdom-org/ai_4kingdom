/**
 * YouTube Audio Worker — Fly.io 微服務
 *
 * 部署於 Fly.io（永久免費 VM，非 AWS IP），yt-dlp 可正常下載 YouTube 音頻。
 * 完整流程：yt-dlp 下載 → ffmpeg 分片 → Whisper 轉錄 → GPT-4o-mini 格式化
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

const execAsync = promisify(exec);
const PORT = parseInt(process.env.PORT || '8080', 10);

// ── 安全驗證 ────────────────────────────────
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

// ── OpenAI（延遲初始化，避免啟動時缺少 API Key 就報錯）───
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

// ── 常數 ────────────────────────────────────
const WHISPER_MAX_BYTES = 24 * 1024 * 1024;
const CHUNK_DURATION_SEC = 20 * 60;
const MAX_VIDEO_DURATION_SEC = 100 * 60;

// ── yt-dlp ──────────────────────────────────
let ytDlpBin: string | null = null;

async function ensureYtDlp(): Promise<string> {
  if (ytDlpBin) return ytDlpBin;

  // 1. 系統 yt-dlp (Dockerfile 已安裝)
  try {
    const { stdout } = await execAsync('yt-dlp --version', { timeout: 5000 });
    if (stdout.trim()) {
      console.log('[worker] system yt-dlp:', stdout.trim());
      ytDlpBin = 'yt-dlp';
      return ytDlpBin;
    }
  } catch { /* not in PATH */ }

  // 2. 自動下載到 /tmp
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

// ── ffmpeg ──────────────────────────────────
async function ensureFfmpeg(): Promise<string> {
  try {
    await execAsync('ffmpeg -version', { timeout: 5000 });
    return 'ffmpeg';
  } catch {
    throw new Error('ffmpeg not available on this host');
  }
}

// ── 音頻工具 ────────────────────────────────
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

// ── GPT 格式化 ──────────────────────────────
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
            content: `你是一位專業的文字編輯，負責整理語音轉錄文字。
請對輸入的文字進行以下處理：
1. 加上正確的中文標點符號（句號、逗號、問號、感嘆號、頓號等）
2. 適當分段，使文字結構清晰（根據語意換行，段落之間加一個空行）
3. 修正明顯的同音字/語音辨識錯誤（如「的地得」、「再在」等）
4. 保留所有原始語義，不刪減、不改寫、不添加內容
5. 如原文有重複詞彙（口語習慣），保留不刪
只輸出整理後的文字，不要加任何說明或前言。`,
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
    const breakChars = ['。', '！', '？', '…', '\n', ' ', '，'];
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

// ── extractVideoId ──────────────────────────
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

// ── 主 API ──────────────────────────────────
app.post('/api/youtube-audio', authMiddleware, async (req: express.Request, res: express.Response) => {
  const tmpDir = join(os.tmpdir(), `yt-audio-${Date.now()}`);
  const chunkDir = join(tmpDir, 'chunks');

  try {
    const { url, startTime, endTime } = req.body;
    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'INVALID_URL', message: '請提供有效的 YouTube URL' });
      return;
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      res.status(400).json({ error: 'INVALID_URL', message: '無法識別 YouTube 影片 ID' });
      return;
    }

    console.log(`[worker] Starting: ${videoId}`);

    const [ytDlp, ffmpeg] = await Promise.all([ensureYtDlp(), ensureFfmpeg()]);
    await mkdir(tmpDir, { recursive: true });
    await mkdir(chunkDir, { recursive: true });

    // ── 時長預檢 ──────────────────────────
    try {
      const { stdout: infoJson } = await execAsync(
        `"${ytDlp}" --dump-json --no-playlist "https://www.youtube.com/watch?v=${videoId}"`,
        { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
      );
      const dur: number = JSON.parse(infoJson).duration || 0;
      console.log(`[worker] Duration: ${Math.round(dur / 60)} min`);
      if (dur > MAX_VIDEO_DURATION_SEC) {
        res.status(400).json({
          error: 'VIDEO_TOO_LONG',
          message: `影片時長約 ${Math.round(dur / 60)} 分鐘，超出上限（100 分鐘）。`,
        });
        return;
      }
    } catch { /* 預檢失敗不阻擋 */ }

    // ── 下載音頻 ──────────────────────────
    const fmtSel = 'bestaudio[abr<=48][ext=webm]/bestaudio[abr<=48]/bestaudio[abr<=64][ext=m4a]/bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio';
    const outTpl = join(tmpDir, '%(id)s.%(ext)s');
    const dlCmd = `"${ytDlp}" -f "${fmtSel}" --no-playlist --no-post-overwrites -o "${outTpl}" "https://www.youtube.com/watch?v=${videoId}"`;
    console.log('[worker] Downloading audio...');
    const { stderr } = await execAsync(dlCmd, { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 });
    if (stderr) console.log('[worker] yt-dlp stderr:', stderr.slice(0, 300));

    // ── 找到下載的音頻檔 ──────────────────
    const allFiles = await readdir(tmpDir);
    const audioFile = allFiles.find((f) => /\.(m4a|webm|mp3|ogg|opus|wav|mp4|aac)$/i.test(f));
    if (!audioFile) {
      console.error('[worker] No audio file. Files:', allFiles);
      res.status(500).json({ error: 'DOWNLOAD_FAILED', message: '下載音頻失敗' });
      return;
    }

    let audioPath = join(tmpDir, audioFile);
    const ext = audioFile.split('.').pop()?.toLowerCase() || 'm4a';

    // ── 時段裁剪 ────────────────────────────
    if (startTime || endTime) {
      const trimmedPath = join(tmpDir, `trimmed.${ext}`);
      const ssArg = startTime ? `-ss "${startTime}"` : '';
      const toArg = endTime ? `-to "${endTime}"` : '';
      const trimCmd = `"${ffmpeg}" -i "${audioPath}" ${ssArg} ${toArg} -c copy "${trimmedPath}"`;
      console.log(`[worker] Trimming: ${startTime || '00:00:00'} → ${endTime || 'end'}`);
      await execAsync(trimCmd, { timeout: 60_000, maxBuffer: 50 * 1024 * 1024 });
      if (existsSync(trimmedPath)) audioPath = trimmedPath;
    }

    const fileBytes = statSync(audioPath).size;
    const fileMB = fileBytes / (1024 * 1024);
    console.log(`[worker] Audio: ${fileMB.toFixed(1)} MB`);

    // ── Whisper 轉錄 ────────────────────────
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
      res.status(422).json({ error: 'EMPTY_TRANSCRIPTION', message: '轉錄結果為空' });
      return;
    }

    console.log(`[worker] Whisper done: ${transcript.length} chars — formatting...`);
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
        message: '此 YouTube 影片受到機器人偵測限制，請改用手動上傳音頻。',
      });
      return;
    }
    if (msg.includes('Video unavailable') || msg.includes('Private video')) {
      res.status(404).json({ error: 'VIDEO_UNAVAILABLE', message: '影片無法訪問' });
      return;
    }

    res.status(500).json({ error: 'TRANSCRIPTION_FAILED', message: msg || '處理失敗' });
  } finally {
    try {
      if (existsSync(tmpDir)) await rm(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
});

// ── 健康檢查 ─────────────────────────────────
app.get('/health', (_req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', service: 'youtube-audio-worker' });
});

// ── 啟動 ────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[worker] YouTube Audio Worker running on port ${PORT}`);
});
