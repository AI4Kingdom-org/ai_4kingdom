import { createHmac } from 'crypto';

/**
 * 與 Fly.io 轉錄 Worker 之間的身分驗證（僅限伺服器端）。
 *
 * - 伺服器呼叫 Worker：帶 x-worker-secret（YOUTUBE_WORKER_SECRET），這把密鑰永遠不送到瀏覽器。
 * - 瀏覽器直傳大檔案到 Worker（繞過 Amplify 10MB 限制）：改發短效「上傳通行證」，
 *   只能用於 /api/audio-transcribe、15 分鐘後失效。Worker 端以同一把衍生金鑰驗章
 *   （services/youtube-audio-worker/src/index.ts verifyUploadToken）。
 */

const UPLOAD_TOKEN_TTL_SEC = 15 * 60;
const UPLOAD_TOKEN_PURPOSE = 'audio-transcribe';

export function getWorkerUrl(): string | null {
  const url = (process.env.YOUTUBE_WORKER_URL || '').trim().replace(/\/+$/, '');
  return url || null;
}

function getWorkerSecret(): string | null {
  return (process.env.YOUTUBE_WORKER_SECRET || '').trim() || null;
}

export function workerAuthHeaders(): Record<string, string> {
  const secret = getWorkerSecret();
  return secret ? { 'x-worker-secret': secret } : {};
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 發給登入會員的單次上傳通行證；未設定 Worker 密鑰時回傳 null。 */
export function issueUploadToken(userId: string): string | null {
  const secret = getWorkerSecret();
  if (!secret) return null;
  const key = createHmac('sha256', secret).update('a4k-worker-upload-v1').digest();
  const payload = b64url(JSON.stringify({
    p: UPLOAD_TOKEN_PURPOSE,
    uid: userId,
    exp: Math.floor(Date.now() / 1000) + UPLOAD_TOKEN_TTL_SEC,
  }));
  return `${payload}.${b64url(createHmac('sha256', key).update(payload).digest())}`;
}

/** 轉錄片段時間：只接受頁面輸入遮罩會產生的 HH、HH:MM、HH:MM:SS。 */
const TRIM_TIME_RE = /^\d{1,2}(:\d{2}){0,2}$/;

export function isValidTrimTime(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (typeof v === 'string' && TRIM_TIME_RE.test(v.trim()));
}

export const INVALID_TIME_RESPONSE = {
  error: 'INVALID_TIME',
  message: '時間格式錯誤，請使用 HH:MM:SS 格式，例如 00:10:30',
};

/** 只轉送 Worker 認得的欄位，避免把任意 body 原封不動丟過去。 */
export function pickYouTubeAudioPayload(body: any) {
  const trim = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return {
    url: typeof body?.url === 'string' ? body.url.trim() : '',
    startTime: trim(body?.startTime),
    endTime: trim(body?.endTime),
    ...(typeof body?.format === 'boolean' ? { format: body.format } : {}),
    ...(typeof body?.forceAudioTranscription === 'boolean'
      ? { forceAudioTranscription: body.forceAudioTranscription }
      : {}),
  };
}
