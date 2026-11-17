import { NextResponse } from 'next/server';
import { requireMember } from '@/app/lib/identity/server';
import {
  INVALID_TIME_RESPONSE,
  getWorkerUrl,
  isValidTrimTime,
  pickYouTubeAudioPayload,
  workerAuthHeaders,
} from '@/app/lib/workerAuth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sunday-guide/youtube-audio/start
 * 代替瀏覽器向 Fly.io Worker 開始 YouTube 轉錄任務（Worker 立即回 jobId，轉錄在背景跑）。
 * 以前瀏覽器直接呼叫 Worker、靠 Origin 標頭通關，任何人偽造 Origin 就能用；
 * 現在改由這裡確認會員身分後，以伺服器端密鑰呼叫 Worker。
 *
 * 回應沿用 Worker 的狀態碼與內容；未設定 Worker 時回 501，前端改走同步路由。
 */
export async function POST(request: Request) {
  const auth = requireMember(request);
  if ('response' in auth) return auth.response;

  const workerUrl = getWorkerUrl();
  if (!workerUrl) {
    return NextResponse.json({ error: 'WORKER_NOT_CONFIGURED', message: '未設定轉錄服務' }, { status: 501 });
  }

  const payload = pickYouTubeAudioPayload(await request.json().catch(() => null));
  if (!payload.url) {
    return NextResponse.json({ error: 'INVALID_URL', message: '请提供有效的 YouTube URL' }, { status: 400 });
  }
  if (!isValidTrimTime(payload.startTime) || !isValidTrimTime(payload.endTime)) {
    return NextResponse.json(INVALID_TIME_RESPONSE, { status: 400 });
  }

  try {
    const workerRes = await fetch(`${workerUrl}/api/youtube-audio/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...workerAuthHeaders() },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await workerRes.text();
    let data: any;
    try {
      data = text.trim() ? JSON.parse(text) : {};
    } catch {
      data = { error: 'INVALID_WORKER_RESPONSE', message: '轉錄服務回應格式錯誤' };
    }
    console.log('[youtube-audio/start]', { userId: auth.identity.userId, status: workerRes.status, jobId: data?.jobId });
    return NextResponse.json(data, { status: workerRes.status });
  } catch (err) {
    console.error('[youtube-audio/start] Worker 連線失敗:', err);
    return NextResponse.json(
      { error: 'WORKER_PROXY_FAILED', message: '轉錄服務暫時無法連線，請稍後再試。' },
      { status: 502 }
    );
  }
}
