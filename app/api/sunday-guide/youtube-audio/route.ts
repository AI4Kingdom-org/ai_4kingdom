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
  '--js-runtimes', 'nodejs',
  '--extractor-args', '"youtube:player_client=ios,mweb"',
  '--user-agent', '"Mozilla/5.0 (iPhone; CPU iPhone OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1"',
  '--no-check-certificates',
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

    const [ytDlp, ffmpegPath] = await Promise.all([ensureYtDlp(), getFfmpegPath()]);

    // ── Amplify 相容：檢查影片時長 ≤ 100 分鐘 ───────────────────────
    try {
      const { stdout: infoJson } = await execAsync(
        `"${ytDlp}" ${YT_DLP_COMMON_ARGS} --dump-json --no-playlist "https://www.youtube.com/watch?v=${videoId}"`,
        { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
      );
      const info = JSON.parse(infoJson);
      const videoDuration: number = info.duration || 0;
      console.log(`[youtube-audio] Video duration: ${Math.round(videoDuration / 60)} min`);
      if (videoDuration > MAX_VIDEO_DURATION_SEC) {
        return NextResponse.json(
          {
            error: 'VIDEO_TOO_LONG',
            message: `影片時長約 ${Math.round(videoDuration / 60)} 分鐘，超出上限（100 分鐘）。請使用「指定轉錄片段」功能擷取部分內容，或選擇較短的影片。`,
          },
          { status: 400 }
        );
      }
    } catch (e: any) {
      // 若取得 metadata 失敗，仍允許繼續（不要因此阻擋合法短影片）
      console.warn('[youtube-audio] Could not pre-check duration:', e?.message?.slice(0, 200));
    }

    await mkdir(tmpDir, { recursive: true });
    await mkdir(chunkDir, { recursive: true });

    // 格式選擇策略：優先 ≤48kbps webm/opus（1小時 ≈ 20.6MB，安全）
    // 逐步放寬到最佳音質（大檔案需分片）
    const formatSelector =
      'bestaudio[abr<=48][ext=webm]/bestaudio[abr<=48]/bestaudio[abr<=64][ext=m4a]/bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio';
    const outputTemplate = join(tmpDir, '%(id)s.%(ext)s');
    const ytDlpCmd = `"${ytDlp}" ${YT_DLP_COMMON_ARGS} -f "${formatSelector}" --no-playlist --no-post-overwrites -o "${outputTemplate}" "https://www.youtube.com/watch?v=${videoId}"`;

    console.log('[youtube-audio] Running yt-dlp...');
    const { stderr } = await execAsync(ytDlpCmd, {
      timeout: 600_000, // 10 分鐘（2 小時影片下載需要足夠時間）
      maxBuffer: 50 * 1024 * 1024,
    });
    if (stderr) console.log('[youtube-audio] yt-dlp stderr:', stderr.slice(0, 300));

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
