import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { exec } from 'child_process';
import { promisify } from 'util';
import { unlink, mkdir, readdir, readFile, writeFile, chmod } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { formatTranscript } from '../../../lib/formatTranscript';

// Whisper API 單次上限（保留 1MB buffer）
const WHISPER_MAX_BYTES = 24 * 1024 * 1024; // 24 MB
// 每個分片的目標時長（秒）— 20 分鐘，128kbps ≈ 18.3MB，安全範圍內
const CHUNK_DURATION_SEC = 20 * 60;
// Amplify 相容：YouTube 影片最長 100 分鐘
const MAX_VIDEO_DURATION_SEC = 100 * 60; // 6000s

const execAsync = promisify(exec);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// yt-dlp 二進制路徑（快取，避免重複查找）
let ytDlpPath: string | null = null;

/**
 * yt-dlp 通用參數：
 * - --js-runtimes nodejs：使用 Lambda 上已安裝的 Node.js 作為 JS runtime
 * - --extractor-args：使用 ios / mweb 客戶端 (跳過 YouTube datacenter IP 機器人偵測)
 * - --user-agent：模擬真實瀏覽器
 * - --no-check-certificates：避免 Lambda 上證書問題
 */
const YT_DLP_COMMON_ARGS = [
  '--js-runtimes', 'node',
  '--extractor-args', '"youtube:player_client=tv_embedded,ios,mweb"',
  '--user-agent', '"Mozilla/5.0 (iPhone; CPU iPhone OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1"',
  '--no-check-certificates',
  '--no-warnings',
].join(' ');

/**
 * 確保 yt-dlp 二進制可用。
 * 優先使用系統安裝的 yt-dlp，否則自動下載。
 * Linux/Lambda：下載 yt-dlp_linux 獨立二進制（內含 Python，不需要系統 python3）
 * Windows：透過 yt-dlp-wrap 下載 yt-dlp.exe
 */
async function ensureYtDlp(): Promise<string> {
  if (ytDlpPath) return ytDlpPath;

  try {
    const { stdout } = await execAsync('yt-dlp --version', { timeout: 5000 });
    if (stdout.trim()) {
      console.log('[youtube-audio] Using system yt-dlp:', stdout.trim());
      ytDlpPath = 'yt-dlp';
      return ytDlpPath;
    }
  } catch {
    // not in PATH
  }

  // Lambda 環境只有 /tmp 可寫，改用 os.tmpdir()
  const binDir = join(os.tmpdir(), 'yt-dlp-bin');
  const isWindows = os.platform() === 'win32';
  const binaryName = isWindows ? 'yt-dlp.exe' : 'yt-dlp_linux';
  const binaryPath = join(binDir, binaryName);

  if (existsSync(binaryPath)) {
    ytDlpPath = binaryPath;
    return ytDlpPath;
  }

  console.log('[youtube-audio] Downloading yt-dlp binary...');
  if (!existsSync(binDir)) {
    await mkdir(binDir, { recursive: true });
  }

  if (isWindows) {
    // Windows：使用 yt-dlp-wrap 內建下載器（下載 yt-dlp.exe）
    const YTDlpWrap = (await import('yt-dlp-wrap')).default;
    await YTDlpWrap.downloadFromGithub(binaryPath);
  } else {
    // Linux/Lambda：下載獨立二進制，不需要 python3
    // x86_64 → yt-dlp_linux，ARM64 → yt-dlp_linux_aarch64
    const assetName = process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
    const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`;
    console.log(`[youtube-audio] Fetching standalone binary: ${assetName}`);

    const response = await fetch(downloadUrl, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`Failed to download yt-dlp: HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    await writeFile(binaryPath, Buffer.from(arrayBuffer));
    await chmod(binaryPath, 0o755);
  }

  console.log('[youtube-audio] yt-dlp downloaded to:', binaryPath);
  ytDlpPath = binaryPath;
  return ytDlpPath;
}

/**
 * 取得 ffmpeg 執行檔路徑。
 * 優先系統 ffmpeg，其次 ffmpeg-static（bundled npm binary）。
 */
async function getFfmpegPath(): Promise<string | null> {
  try {
    await execAsync('ffmpeg -version', { timeout: 5000 });
    return 'ffmpeg';
  } catch {
    try {
      // 使用 require() 避免 Next.js bundle 將路徑轉換為內部模組 ID
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const p: string | null = require('ffmpeg-static');
      if (p && existsSync(p)) {
        console.log('[youtube-audio] Using ffmpeg-static:', p);
        return p;
      }
    } catch {
      // ffmpeg-static not available
    }
    return null;
  }
}

/**
 * 獲取音頻時長（秒），從 ffmpeg stderr 解析 Duration 行
 */
async function getAudioDuration(ffmpegPath: string, filePath: string): Promise<number> {
  try {
    // ffmpeg -i 會把 Duration 輸出到 stderr
    const result = await execAsync(`"${ffmpegPath}" -i "${filePath}"`, { timeout: 15000 })
      .catch((e: any) => ({ stdout: '', stderr: e.stderr || e.message || '' }));
    const output = (result.stdout || '') + (result.stderr || '');
    const m = output.match(/Duration:\s*(\d+):(\d+):(\d+)/);
    if (m) return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
  } catch (e) {
    console.warn('[youtube-audio] Could not get duration:', e);
  }
  return 0;
}

/**
 * 使用 ffmpeg 將音頻按固定時長切成多個片段
 * 回傳已排序的分片路徑陣列
 */
async function splitAudio(
  ffmpegPath: string,
  inputPath: string,
  outputDir: string,
  chunkSec: number
): Promise<string[]> {
  const ext = inputPath.split('.').pop()?.toLowerCase() || 'm4a';
  const pattern = join(outputDir, `chunk_%03d.${ext}`);
  const cmd = `"${ffmpegPath}" -i "${inputPath}" -f segment -segment_time ${chunkSec} -c copy -reset_timestamps 1 "${pattern}"`;
  console.log('[youtube-audio] Splitting with ffmpeg...');
  await execAsync(cmd, { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 });
  const files = await readdir(outputDir);
  return files
    .filter((f) => /^chunk_\d+\.\w+$/.test(f))
    .sort()
    .map((f) => join(outputDir, f));
}

/**
 * 將音頻檔轉成 File 物件後送 Whisper 轉錄，回傳文字
 */
async function transcribeFile(filePath: string, ext: string): Promise<string> {
  const mimeMap: Record<string, string> = {
    m4a: 'audio/mp4', webm: 'audio/webm', mp3: 'audio/mpeg',
    ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav',
    mp4: 'video/mp4', aac: 'audio/aac',
  };
  const mimeType = mimeMap[ext] || 'audio/mp4';
  const buf = await readFile(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const whisperFile = new File([ab], `audio.${ext}`, { type: mimeType });
  const result = await openai.audio.transcriptions.create({
    file: whisperFile,
    model: 'whisper-1',
    response_format: 'text',
    language: 'zh',
  });
  return typeof result === 'string' ? result : (result as any).text || String(result);
}

// ── YouTube 代理策略 ─────────────────────────────────────────────
// 使用兩套不同代碼庫的 YouTube 代理前端取得 Google CDN 直連 URL：
//   Piped  (Java)    — GET /streams/{videoId}       → audioStreams[]
//   Invidious (Crystal) — GET /api/v1/videos/{videoId} → adaptiveFormats[]
// Google CDN (*.googlevideo.com) 不受 AWS datacenter IP 封鎖。

/** Piped 公開實例（Java 實作，與 Invidious 互補） */
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.in.projectsegfau.lt',
  'https://watchapi.whatever.social',
  'https://pipedapi.moomoo.me',
];

/** Invidious 公開實例（Crystal 實作） */
const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.privacydev.net',
  'https://y.com.sb',
  'https://invidious.lunar.icu',
];

/** 代理 API 回傳的音頻串流資訊 */
interface ProxyAudioResult {
  url: string;       // Google CDN 直連 URL
  ext: string;       // 檔案副檔名 (webm / m4a)
  duration: number;  // 影片時長（秒）
  source: string;    // 來源描述
}

const PROXY_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; sermon-transcriber/1.0)' };

/**
 * 透過 Piped API 解析 YouTube 音頻串流
 * @see https://docs.piped.video/docs/api-documentation/
 */
async function resolveViaPiped(videoId: string): Promise<ProxyAudioResult> {
  for (const instance of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${instance}/streams/${videoId}`, {
        signal: AbortSignal.timeout(10_000),
        headers: PROXY_HEADERS,
      });
      if (!res.ok) { console.warn(`[youtube-audio] Piped ${instance} → ${res.status}`); continue; }
      const text = await res.text();
      if (!text || text.length < 2) { console.warn(`[youtube-audio] Piped ${instance} → empty body`); continue; }
      let data: any;
      try { data = JSON.parse(text); } catch { console.warn(`[youtube-audio] Piped ${instance} → invalid JSON`); continue; }
      if (data.error) { console.warn(`[youtube-audio] Piped ${instance} → API error: ${data.error}`); continue; }
      const duration: number = data.duration || 0;
      const streams: any[] = (data.audioStreams || []).filter((s: any) => s.url);
      if (streams.length === 0) continue;
      // 以 bitrate 接近 128kbps 為排序依據（品質夠用且檔案適中）
      streams.sort((a: any, b: any) =>
        Math.abs((a.bitrate ?? 0) - 128_000) - Math.abs((b.bitrate ?? 0) - 128_000)
      );
      const fmt = streams[0];
      const ext = fmt.mimeType?.includes('webm') ? 'webm' : 'm4a';
      const host = new URL(instance).hostname;
      console.log(`[youtube-audio] Piped ${host} → ${ext} @ ${Math.round((fmt.bitrate ?? 0) / 1000)}kbps, ${Math.round(duration / 60)}min`);
      return { url: fmt.url, ext, duration, source: `Piped(${host})` };
    } catch (err) {
      console.warn(`[youtube-audio] Piped ${instance} failed:`, (err as Error).message?.slice(0, 80));
    }
  }
  throw new Error('All Piped instances failed');
}

/**
 * 透過 Invidious API 解析 YouTube 音頻串流
 * @see https://docs.invidious.io/api/
 */
async function resolveViaInvidious(videoId: string): Promise<ProxyAudioResult> {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(`${instance}/api/v1/videos/${videoId}`, {
        signal: AbortSignal.timeout(10_000),
        headers: PROXY_HEADERS,
      });
      if (!res.ok) { console.warn(`[youtube-audio] Invidious ${instance} → ${res.status}`); continue; }
      const text = await res.text();
      if (!text || text.length < 2) { console.warn(`[youtube-audio] Invidious ${instance} → empty body`); continue; }
      let data: any;
      try { data = JSON.parse(text); } catch { console.warn(`[youtube-audio] Invidious ${instance} → invalid JSON`); continue; }
      if (data.error) { console.warn(`[youtube-audio] Invidious ${instance} → API error: ${data.error}`); continue; }
      const duration: number = data.lengthSeconds || 0;
      const formats: any[] = data.adaptiveFormats || [];
      const audioFormats = formats.filter((f) => f.type?.startsWith('audio/') && f.url);
      if (audioFormats.length === 0) continue;
      audioFormats.sort((a, b) => Math.abs((a.bitrate ?? 0) - 128_000) - Math.abs((b.bitrate ?? 0) - 128_000));
      const fmt = audioFormats[0];
      const ext = (fmt.type as string).includes('webm') ? 'webm' : 'm4a';
      const host = new URL(instance).hostname;
      console.log(`[youtube-audio] Invidious ${host} → ${ext} @ ${Math.round((fmt.bitrate ?? 0) / 1000)}kbps, ${Math.round(duration / 60)}min`);
      return { url: fmt.url as string, ext, duration, source: `Invidious(${host})` };
    } catch (err) {
      console.warn(`[youtube-audio] Invidious ${instance} failed:`, (err as Error).message?.slice(0, 80));
    }
  }
  throw new Error('All Invidious instances failed');
}

/**
 * 從 URL 提取 videoId
 */
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * POST /api/sunday-guide/youtube-audio
 * 下載 YouTube 影片音源並透過 Whisper 轉錄。支援最長約 1 小時影片：
 * - 優先選低位元率格式（48kbps webm/opus）確保單一檔案 < 25MB
 * - 若仍超限則用 ffmpeg-static 自動分片（每 20 分鐘一片），逐片轉錄後拼接
 *
 * Body: { url: string }
 * Response: { transcript: string, source: 'whisper', videoId: string, charCount: number }
 */
export async function POST(request: Request) {
  const tmpDir = join(os.tmpdir(), `yt-audio-${Date.now()}`);
  const chunkDir = join(tmpDir, 'chunks');

  try {
    const body = await request.json();
    const { url, startTime, endTime } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'INVALID_URL', message: '请提供有效的 YouTube URL' },
        { status: 400 }
      );
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: 'INVALID_URL', message: '无法识别 YouTube 影片 ID，请检查 URL 格式' },
        { status: 400 }
      );
    }

    console.log('[youtube-audio] Starting audio extraction for:', videoId);

    const ffmpegPath = await getFfmpegPath();

    await mkdir(tmpDir, { recursive: true });
    await mkdir(chunkDir, { recursive: true });

    // ── 音頻下載策略（多代理 + yt-dlp 備案）──────────────────────
    // 策略層級：Piped (5 實例) → Invidious (5 實例) → yt-dlp (最後手段)
    // 代理方案透過 Google CDN 直連下載，不受 AWS datacenter IP 封鎖影響
    const proxyStrategies: Array<{ name: string; fn: () => Promise<ProxyAudioResult> }> = [
      { name: 'Piped', fn: () => resolveViaPiped(videoId) },
      { name: 'Invidious', fn: () => resolveViaInvidious(videoId) },
    ];

    let downloaded = false;
    for (const { name, fn } of proxyStrategies) {
      if (downloaded) break;
      try {
        console.log(`[youtube-audio] Trying ${name}...`);
        const proxy = await fn();

        // 時長檢查（由代理 API 直接回傳，免除 yt-dlp --dump-json）
        if (proxy.duration > 0) {
          console.log(`[youtube-audio] Duration: ${Math.round(proxy.duration / 60)} min (${proxy.source})`);
          if (proxy.duration > MAX_VIDEO_DURATION_SEC) {
            return NextResponse.json(
              {
                error: 'VIDEO_TOO_LONG',
                message: `影片時長約 ${Math.round(proxy.duration / 60)} 分鐘，超出上限（100 分鐘）。請使用「指定轉錄片段」功能擷取部分內容，或選擇較短的影片。`,
              },
              { status: 400 }
            );
          }
        }

        // 從 Google CDN 下載音頻
        console.log(`[youtube-audio] Downloading via ${proxy.source}...`);
        const cdnRes = await fetch(proxy.url, { signal: AbortSignal.timeout(300_000) });
        if (!cdnRes.ok) {
          console.warn(`[youtube-audio] ${name} CDN HTTP ${cdnRes.status}, trying next strategy`);
          continue;
        }
        const buf = await cdnRes.arrayBuffer();
        if (buf.byteLength < 1000) {
          console.warn(`[youtube-audio] ${name} response too small (${buf.byteLength}B), trying next`);
          continue;
        }
        await writeFile(join(tmpDir, `${videoId}.${proxy.ext}`), Buffer.from(buf));
        console.log(`[youtube-audio] ✓ ${proxy.source} → ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB`);
        downloaded = true;
      } catch (err) {
        console.warn(`[youtube-audio] ${name} failed:`, (err as Error).message?.slice(0, 150));
      }
    }

    // yt-dlp 最後備案（Lambda 因 YouTube IP 封鎖幾乎必定失敗，但本地開發可用）
    if (!downloaded) {
      console.log('[youtube-audio] All proxy strategies failed, trying yt-dlp as last resort...');
      try {
        const ytDlp = await ensureYtDlp();

        // 時長預檢（代理策略未成功時才需要）
        try {
          const { stdout: infoJson } = await execAsync(
            `"${ytDlp}" ${YT_DLP_COMMON_ARGS} --dump-json --no-playlist "https://www.youtube.com/watch?v=${videoId}"`,
            { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
          );
          const dur: number = JSON.parse(infoJson).duration || 0;
          if (dur > MAX_VIDEO_DURATION_SEC) {
            return NextResponse.json(
              {
                error: 'VIDEO_TOO_LONG',
                message: `影片時長約 ${Math.round(dur / 60)} 分鐘，超出上限（100 分鐘）。`,
              },
              { status: 400 }
            );
          }
        } catch {
          // metadata 取得失敗不阻擋下載嘗試
        }

        const fmtSel =
          'bestaudio[abr<=48][ext=webm]/bestaudio[abr<=48]/bestaudio[abr<=64][ext=m4a]/bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio';
        const outTpl = join(tmpDir, '%(id)s.%(ext)s');
        const cmd = `"${ytDlp}" ${YT_DLP_COMMON_ARGS} -f "${fmtSel}" --no-playlist --no-post-overwrites -o "${outTpl}" "https://www.youtube.com/watch?v=${videoId}"`;
        console.log('[youtube-audio] Running yt-dlp...');
        const { stderr } = await execAsync(cmd, { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 });
        if (stderr) console.log('[youtube-audio] yt-dlp stderr:', stderr.slice(0, 300));
      } catch (dlpErr: any) {
        console.error('[youtube-audio] yt-dlp also failed:', (dlpErr as Error).message?.slice(0, 300));
        return NextResponse.json(
          {
            error: 'YOUTUBE_BLOCKED',
            message:
              '伺服器目前無法從 YouTube 取得此影片的音頻。所有下載管道（Piped / Invidious / yt-dlp）均已嘗試但未成功。\n\n' +
              '請改用「手動上傳音頻」功能：\n' +
              '1. 在您的電腦或手機上下載 YouTube 影片音頻（可用 yt-dlp、瀏覽器外掛或線上轉換工具）\n' +
              '2. 點擊頁面上的「上傳音頻檔案」按鈕\n' +
              '3. 選擇 MP3 / M4A / WebM 檔案，系統將自動使用 Whisper AI 轉錄',
          },
          { status: 503 }
        );
      }
    }

    // 找出下載的主音頻檔案
    const allFiles = await readdir(tmpDir);
    const audioFileName = allFiles.find((f) =>
      /\.(m4a|webm|mp3|ogg|opus|wav|mp4|aac)$/i.test(f)
    );

    if (!audioFileName) {
      console.error('[youtube-audio] No audio file. Files:', allFiles);
      return NextResponse.json(
        { error: 'DOWNLOAD_FAILED', message: '下载音频失败，未找到音频文件。' },
        { status: 500 }
      );
    }

    let audioFilePath = join(tmpDir, audioFileName);
    const ext = audioFileName.split('.').pop()?.toLowerCase() || 'm4a';

    // ── 時段裁剪（若有指定 startTime 或 endTime）─────────────────────────────
    if ((startTime || endTime) && ffmpegPath) {
      const trimmedPath = join(tmpDir, `trimmed.${ext}`);
      const ssArg = startTime ? `-ss "${startTime}"` : '';
      const toArg = endTime ? `-to "${endTime}"` : '';
      const trimCmd = `"${ffmpegPath}" -i "${audioFilePath}" ${ssArg} ${toArg} -c copy "${trimmedPath}"`;
      console.log(`[youtube-audio] Trimming segment: ${startTime || '00:00:00'} → ${endTime || 'end'}`);
      await execAsync(trimCmd, { timeout: 60_000, maxBuffer: 50 * 1024 * 1024 });
      if (existsSync(trimmedPath)) {
        audioFilePath = trimmedPath;
      } else {
        console.warn('[youtube-audio] Trim output not found, using original file.');
      }
    } else if ((startTime || endTime) && !ffmpegPath) {
      console.warn('[youtube-audio] ffmpeg not available, cannot trim segment. Using full audio.');
    }

    const fileSizeBytes = statSync(audioFilePath).size;
    const fileSizeMB = fileSizeBytes / (1024 * 1024);

    console.log(`[youtube-audio] Audio to transcribe: ${audioFilePath.split(/[\/\\]/).pop()} (${fileSizeMB.toFixed(1)}MB)${startTime || endTime ? ` [segment ${startTime || '00:00:00'}→${endTime || 'end'}]` : ''}`);

    let transcript = '';

    if (fileSizeBytes <= WHISPER_MAX_BYTES) {
      // ── 情況 A：檔案夠小，直接送 Whisper ─────────────────────
      console.log('[youtube-audio] Within 24MB, transcribing directly...');
      transcript = await transcribeFile(audioFilePath, ext);
    } else {
      // ── 情況 B：檔案過大，用 ffmpeg 分片後逐片轉錄 ────────────
      console.log(`[youtube-audio] ${fileSizeMB.toFixed(1)}MB > 24MB, splitting...`);

      if (!ffmpegPath) {
        return NextResponse.json(
          {
            error: 'FFMPEG_REQUIRED',
            message: `音频 ${fileSizeMB.toFixed(1)}MB 超出 Whisper 限制（24MB）且無法自动分片（ffmpeg 不可用）。请选择 30 分钟以内的影片，或手动上传音频文件。`,
          },
          { status: 413 }
        );
      }

      const durationSec = await getAudioDuration(ffmpegPath, audioFilePath);
      console.log(
        `[youtube-audio] Duration: ~${Math.round(durationSec / 60)}min, splitting into ${CHUNK_DURATION_SEC / 60}min chunks...`
      );

      const chunkPaths = await splitAudio(ffmpegPath, audioFilePath, chunkDir, CHUNK_DURATION_SEC);
      console.log(`[youtube-audio] Split into ${chunkPaths.length} chunks.`);

      if (chunkPaths.length === 0) {
        return NextResponse.json(
          { error: 'SPLIT_FAILED', message: '音频分片失败，请重试。' },
          { status: 500 }
        );
      }

      // 逐片轉錄並拼接
      const parts: string[] = [];
      for (let i = 0; i < chunkPaths.length; i++) {
        const chunkPath = chunkPaths[i];
        const chunkBytes = statSync(chunkPath).size;
        const chunkMB = chunkBytes / (1024 * 1024);
        console.log(`[youtube-audio] Chunk ${i + 1}/${chunkPaths.length} (${chunkMB.toFixed(1)}MB)...`);

        if (chunkBytes > WHISPER_MAX_BYTES) {
          console.warn(`[youtube-audio] Chunk ${i + 1} still ${chunkMB.toFixed(1)}MB, skipping.`);
          continue;
        }

        const chunkExt = chunkPath.split('.').pop()?.toLowerCase() || ext;
        const part = await transcribeFile(chunkPath, chunkExt);
        if (part.trim()) parts.push(part.trim());
      }

      transcript = parts.join(' ');
    }

    if (!transcript || transcript.trim().length === 0) {
      return NextResponse.json(
        { error: 'EMPTY_TRANSCRIPTION', message: '转录结果为空。影片可能没有包含可识别的语音内容。' },
        { status: 422 }
      );
    }

    const final = transcript.trim();
    console.log('[youtube-audio] Whisper done. Total chars:', final.length, '— formatting...');

    const formatted = await formatTranscript(final);
    console.log('[youtube-audio] Formatted. chars:', formatted.length);

    return NextResponse.json({
      transcript: formatted,
      source: 'whisper',
      videoId,
      charCount: formatted.length,
    });
  } catch (error: any) {
    console.error('[youtube-audio] Error:', error);
    const msg = error?.message || '';

    if (msg.includes('timeout') || msg.includes('TIMEOUT') || msg.includes('ETIMEDOUT')) {
      return NextResponse.json(
        { error: 'TIMEOUT', message: '下载超时。请检查网络连接后重试，或尝试较短的影片。' },
        { status: 504 }
      );
    }
    if (msg.includes('Video unavailable') || msg.includes('Private video')) {
      return NextResponse.json(
        { error: 'VIDEO_UNAVAILABLE', message: '影片无法访问（可能为私人影片或已删除）。' },
        { status: 404 }
      );
    }
    if (error?.status === 413 || msg.includes('Maximum content size')) {
      return NextResponse.json(
        { error: 'FILE_TOO_LARGE', message: '音频超出 Whisper API 大小限制，请选择较短的影片。' },
        { status: 413 }
      );
    }

    return NextResponse.json(
      { error: 'TRANSCRIPTION_FAILED', message: msg || '音频下载或转录过程中发生错误' },
      { status: 500 }
    );
  } finally {
    // 清理整個暫存目錄（含分片）
    try {
      if (existsSync(tmpDir)) {
        const { rmSync } = require('fs');
        rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn('[youtube-audio] Cleanup warning:', e);
    }
  }
}

export const maxDuration = 900; // 15 分鐘（Lambda 最長執行時間）
export const dynamic = 'force-dynamic';
