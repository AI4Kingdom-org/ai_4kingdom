import { NextResponse } from 'next/server';
import { runProcessDocument } from '@/app/lib/sunday-guide/processDocument';

export const maxDuration = 300;

/**
 * 觸發講章內容生成（summary / devotional / bibleStudy）。
 *
 * 生產環境（有設 YOUTUBE_WORKER_URL）：轉交 Fly.io worker 背景執行後立即回 202。
 * Amplify 會在 28 秒回應逾時後凍結 Lambda，若在此處執行，生成只會在其他請求剛好
 * 打到同一個容器時才前進，常常跑完也寫不回 DynamoDB（2026-09 講章「處理逾時」事件）。
 *
 * 前端一律輪詢 /api/sunday-guide/check-result 取得結果，兩種模式對呼叫端完全相同。
 * 本機開發未設 worker 時，於此同步執行（Next dev 不會凍結）。
 */
export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 });
  }

  const { assistantId, vectorStoreId, fileName, userId, fileId, unitId } = body || {};
  console.log('[DEBUG] 處理文件請求:', { assistantId, vectorStoreId, fileName });

  if (!assistantId || !vectorStoreId || !fileName) {
    return NextResponse.json(
      { error: '缺少必要參數', details: { assistantId, vectorStoreId, fileName } },
      { status: 400 }
    );
  }

  const job = {
    assistantId,
    vectorStoreId,
    fileName,
    fileId: fileId || undefined,
    userId: userId ? String(userId) : undefined,
    unitId: unitId || undefined,
  };

  const workerUrl = process.env.YOUTUBE_WORKER_URL;
  if (workerUrl) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (process.env.YOUTUBE_WORKER_SECRET) headers['x-worker-secret'] = process.env.YOUTUBE_WORKER_SECRET;
      const workerRes = await fetch(`${workerUrl}/api/sunday-guide/process-document`, {
        method: 'POST',
        headers,
        body: JSON.stringify(job),
        // worker 收到即回 202；含 Fly 機器冷啟動仍遠低於 Amplify 的 28 秒上限
        signal: AbortSignal.timeout(20_000),
      });
      if (workerRes.ok) {
        console.log(`[process-document] 已交由 worker 處理: ${fileName} (HTTP ${workerRes.status})`);
        return NextResponse.json({ success: true, queued: true, message: '文件處理已開始' }, { status: 202 });
      }
      const text = await workerRes.text().catch(() => '');
      console.error(`[process-document] worker 拒絕請求 HTTP ${workerRes.status}: ${text.slice(0, 200)}，改在本地執行`);
    } catch (e: any) {
      console.error(`[process-document] 無法連線 worker（${e?.message}），改在本地執行`);
    }
  }

  // 本機開發、或 worker 無法接手時的後備（在 Amplify 上可能被凍結，見上方說明）
  const ok = await runProcessDocument(job);
  return NextResponse.json({ success: ok, message: ok ? '文件處理完成' : '文件處理失敗' });
}
