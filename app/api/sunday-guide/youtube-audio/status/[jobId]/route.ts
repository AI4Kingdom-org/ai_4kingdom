import { NextResponse } from 'next/server';
import { requireMember } from '@/app/lib/identity/server';
import { getWorkerUrl, workerAuthHeaders } from '@/app/lib/workerAuth';

export const dynamic = 'force-dynamic';

// Worker 的 jobId 格式：<machine id>.<uuid>
const JOB_ID_RE = /^[A-Za-z0-9_-]{1,64}\.[0-9a-fA-F-]{36}$/;

/**
 * GET /api/sunday-guide/youtube-audio/status/:jobId
 * 代替瀏覽器查詢 Worker 轉錄任務進度。任務若在另一台 Worker 機器上，
 * Fly 的 proxy 會依 fly-replay 自動轉送，這裡不需特別處理。
 * 回應沿用 Worker 的狀態碼與內容（前端把 4xx 視為任務遺失、要求重新提交）。
 */
export async function GET(request: Request, { params }: { params: { jobId: string } }) {
  const auth = requireMember(request);
  if ('response' in auth) return auth.response;

  const workerUrl = getWorkerUrl();
  if (!workerUrl) {
    return NextResponse.json({ error: 'WORKER_NOT_CONFIGURED', message: '未設定轉錄服務' }, { status: 501 });
  }

  const jobId = String(params.jobId || '');
  if (!JOB_ID_RE.test(jobId)) {
    return NextResponse.json({ error: 'JOB_NOT_FOUND', message: '找不到此轉錄任務' }, { status: 404 });
  }

  try {
    const workerRes = await fetch(`${workerUrl}/api/youtube-audio/status/${encodeURIComponent(jobId)}`, {
      headers: workerAuthHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    const text = await workerRes.text();
    let data: any;
    try {
      data = text.trim() ? JSON.parse(text) : {};
    } catch {
      data = { error: 'INVALID_WORKER_RESPONSE', message: '轉錄服務回應格式錯誤' };
    }
    return NextResponse.json(data, {
      status: workerRes.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    // 暫時性網路問題：回 502，前端會繼續輪詢
    console.error('[youtube-audio/status] Worker 連線失敗:', err);
    return NextResponse.json(
      { error: 'WORKER_PROXY_FAILED', message: '轉錄服務暫時無法連線' },
      { status: 502 }
    );
  }
}
