import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { formatTranscript } from '../../../lib/formatTranscript';

/**
 * GET /api/sunday-guide/transcription
 * 回傳大檔案直接上傳到 Fly.io Worker 所需的 config。
 * 前端在檔案 > 10MB 時呼叫此端點，取得 uploadUrl 後直接上傳，繞過 Amplify 10MB 限制。
 */
export async function GET() {
  const workerUrl = process.env.YOUTUBE_WORKER_URL;
  const workerSecret = process.env.YOUTUBE_WORKER_SECRET;
  if (!workerUrl) {
    return NextResponse.json({ directUpload: false });
  }
  return NextResponse.json({
    directUpload: true,
    uploadUrl: `${workerUrl}/api/audio-transcribe`,
    workerSecret: workerSecret || '',
  });
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 允許的音頻 MIME 類型
const ALLOWED_TYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
  'audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/webm', 'audio/ogg',
  'video/mp4', 'video/webm',
]);

// Amplify Lambda 直接處理上限（API Gateway payload 限制）
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB（大於此限制請走 GET /config 後直送 Worker）

/**
 * POST /api/sunday-guide/transcription
 * Amplify 相容版：最大 10MB（API Gateway 限制）。
 * 10MB < 24MB Whisper 上限，因此直接送出轉錄，無需 ffmpeg 分片。
 *
 * Body: FormData { file: File }
 * Response: { transcript: string, source: 'whisper', fileName: string, charCount: number }
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: '请上传一个音频文件' }, { status: 400 });
    }

    const mimeType = file.type.toLowerCase();
    const fileName = file.name || 'audio';
    const ext = fileName.split('.').pop()?.toLowerCase() || 'mp3';

    const allowedExtensions = ['mp3', 'wav', 'm4a', 'mp4', 'webm', 'ogg', 'mpeg', 'mpga'];
    if (!ALLOWED_TYPES.has(mimeType) && !allowedExtensions.includes(ext)) {
      return NextResponse.json(
        { error: 'INVALID_FORMAT', message: `不支持的文件格式（${mimeType || ext}）。支持：mp3、wav、m4a、mp4、webm、ogg` },
        { status: 400 }
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      return NextResponse.json(
        { error: 'FILE_TOO_LARGE', message: `文件大小 ${sizeMB}MB 超出限制（最大 10MB）。较长的音频请改用 YouTube 链接方式上传。` },
        { status: 400 }
      );
    }

    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
    console.log(`[transcription] ${fileName} (${fileSizeMB}MB, ${mimeType})`);

    // 直接從記憶體送 Whisper API（10MB < 24MB 限制）
    const arrayBuffer = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const whisperFile = new File([ab], fileName, { type: mimeType });

    console.log('[transcription] Sending to Whisper API...');
    const result = await openai.audio.transcriptions.create({
      file: whisperFile,
      model: 'whisper-1',
      response_format: 'text',
      language: 'zh',
    });

    const transcript = typeof result === 'string' ? result : (result as any).text || String(result);

    if (!transcript || transcript.trim().length === 0) {
      return NextResponse.json(
        { error: 'EMPTY_TRANSCRIPTION', message: '转录结果为空。文件可能没有包含可识别的语音内容。' },
        { status: 422 }
      );
    }

    console.log(`[transcription] Whisper done. chars: ${transcript.length} — formatting...`);
    const formatted = await formatTranscript(transcript);
    console.log(`[transcription] Formatted. chars: ${formatted.length}`);

    return NextResponse.json({
      transcript: formatted,
      source: 'whisper',
      fileName,
      charCount: formatted.length,
    });
  } catch (error: any) {
    console.error('[transcription] Error:', error);
    if (error?.status === 413 || error?.message?.includes('Maximum content size')) {
      return NextResponse.json(
        { error: 'FILE_TOO_LARGE', message: '文件超出 Whisper API 大小限制，请使用较小的文件。' },
        { status: 413 }
      );
    }
    return NextResponse.json(
      { error: 'TRANSCRIPTION_FAILED', message: error?.message || '转录过程中发生错误' },
      { status: 500 }
    );
  }
}

export const maxDuration = 300; // 5 分鐘（10MB 直傳 Whisper 綽綽有餘）
export const dynamic = 'force-dynamic';
