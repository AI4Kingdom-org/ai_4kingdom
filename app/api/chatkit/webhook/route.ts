import { NextRequest, NextResponse } from 'next/server';
// Ensure dynamic behavior on Amplify/Next
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
import OpenAI from 'openai';
import { updateMonthlyTokenUsage } from '@/app/utils/monthlyTokenUsage';
import { saveTokenUsage } from '@/app/utils/tokenUsage';

function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// 健康檢查（避免手動 GET 時 405 噪音）
export async function GET() {
  return json({ ok: true, message: 'ChatKit webhook ready. Use POST from OpenAI.' }, 200);
}

// CORS/預檢（雖是伺服器對伺服器，保留以利測試）
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// Webhook for ChatKit (if configured in OpenAI) to notify run completion.
// This endpoint is defensive: it tries to extract thread/run/user from payload,
// then retrieves the run to get usage and records monthly usage.
export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    if (!process.env.OPENAI_API_KEY) return json({ error: 'Missing OPENAI_API_KEY' }, 500);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Webhook URL may carry a fallback uid (added by /api/chatkit/session)
    const url = new URL(req.url);
    const uidFromQuery =
      url.searchParams.get('uid') ||
      url.searchParams.get('userId') ||
      url.searchParams.get('user_id') ||
      null;

    const payload = await req.json().catch(() => ({}));
    const type = payload?.type || payload?.event || payload?.name || payload?.data?.type || '';

    // 嘗試抓所有可能的識別資訊（包含常見的 data.response.id 結構）
    const responseObj =
      payload?.response ||
      payload?.data?.response ||
      payload?.data?.object?.response ||
      null;

    let responseId =
      payload?.response_id ||
      payload?.responseId ||
      payload?.data?.response_id ||
      responseObj?.id ||
      (type === 'response.completed' ? payload?.data?.id : null) ||
      null;

    let threadId =
      payload?.thread_id ||
      payload?.threadId ||
      payload?.data?.thread_id ||
      payload?.data?.threadId ||
      payload?.data?.object?.thread_id ||
      responseObj?.thread_id ||
      null;

    let runId =
      payload?.run_id ||
      payload?.runId ||
      payload?.data?.run_id ||
      payload?.data?.id ||
      payload?.data?.object?.id ||
      null;

    let userId =
      payload?.user ||
      payload?.user_id ||
      payload?.userId ||
      payload?.data?.user ||
      payload?.data?.user_id ||
      payload?.metadata?.userId ||
      payload?.data?.metadata?.userId ||
      responseObj?.metadata?.userId ||
      uidFromQuery ||
      null;

    console.log('[ChatKit webhook][recv]', {
      type,
      hasResponseObj: !!responseObj,
      responseId,
      threadId,
      runId,
      hasUserInEvent: !!userId,
      uidFromQuery,
      keys: Object.keys(payload || {}),
      dataKeys: payload?.data ? Object.keys(payload.data) : [],
      t: new Date().toISOString(),
    });

    // 僅處理「完成類」事件
    const isCompleted =
      type?.includes('completed') ||
      type === 'response.completed' ||
      type === 'run.completed' ||
      type === 'thread.run.completed';

    if (!isCompleted) {
      console.log('[ChatKit webhook][ignored]', { reason: 'not completed', type });
      return json({ ok: true, ignored: true, type });
    }

    // 先嘗試 Responses（ChatKit 常見）
    let tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; retrieval_tokens: number } | null = null;

    if (type === 'response.completed' || responseId) {
      if (!responseId) return json({ ok: true, skipped: 'no responseId' });

      // 有些時候 usage 需要等一小會才可取到，做最多 3 次輕重試
      let resp: any = null;
      // 直接呼叫 REST API 以避免 SDK 版本差異
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      };
      if (process.env.OPENAI_ORG_ID) headers['OpenAI-Organization'] = process.env.OPENAI_ORG_ID;
      if (process.env.OPENAI_PROJECT) headers['OpenAI-Project'] = process.env.OPENAI_PROJECT;

      for (let i = 0; i < 3; i++) {
        try {
          const res = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(String(responseId))}` , {
            method: 'GET',
            headers,
            cache: 'no-store',
          });
          if (res.ok) {
            resp = await res.json();
          }
        } catch {}
        if (resp?.usage) break;
        await new Promise(r => setTimeout(r, 600));
      }
      if (!resp) return json({ ok: true, skipped: 'responses.retrieve failed', responseId });

      // 回補 userId
      userId =
        userId ||
        resp?.metadata?.userId ||
        resp?.metadata?.user ||
        null;

      const u: any = resp?.usage;
      if (u) {
        const prompt = u.input_tokens ?? u.prompt_tokens ?? 0;
        const completion = u.output_tokens ?? u.completion_tokens ?? 0;
        const total = u.total_tokens ?? prompt + completion;
        tokenUsage = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total, retrieval_tokens: 0 };
      }
    } else {
      // 傳統 Threads/Runs
      if (!threadId || !runId) return json({ ok: true, skipped: 'no threadId/runId', type });

      let finalRun: any = null;
      for (let i = 0; i < 3; i++) {
        finalRun = await openai.beta.threads.runs.retrieve(String(threadId), String(runId)).catch(() => null);
        if (finalRun?.usage) break;
        await new Promise(r => setTimeout(r, 600));
      }
      if (!finalRun) return json({ ok: true, skipped: 'runs.retrieve failed', threadId, runId });

      userId =
        userId ||
        finalRun?.metadata?.userId ||
        finalRun?.user ||
        null;

      if (!userId && threadId) {
        const thread = await openai.beta.threads.retrieve(String(threadId)).catch(() => null as any);
        userId = thread?.metadata?.userId || thread?.user || userId;
      }

      const u: any = finalRun?.usage;
      if (u) {
        tokenUsage = {
          prompt_tokens: u.prompt_tokens ?? 0,
          completion_tokens: u.completion_tokens ?? 0,
          total_tokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
          retrieval_tokens: u.retrieval_tokens ?? 0,
        };
      }
    }

    if (!userId) {
      console.warn('[ChatKit webhook][skipped] no userId', { type, responseId, threadId, runId });
      return json({ ok: true, skipped: 'no userId', type, responseId, threadId, runId });
    }
    if (!tokenUsage || (!tokenUsage.total_tokens && !tokenUsage.prompt_tokens && !tokenUsage.completion_tokens)) {
      console.warn('[ChatKit webhook][skipped] no usage', { type, responseId, threadId, runId, userId });
      return json({ ok: true, skipped: 'no usage', type, responseId, threadId, runId, userId });
    }

    // 入帳（月度彙總 + 明細；以 responseId/runId 去重）
    let recorded = false;
    try {
      await updateMonthlyTokenUsage(String(userId), tokenUsage);
      const uniqueId = String(responseId || runId || threadId || 'unknown');
      try { await saveTokenUsage(String(userId), uniqueId, tokenUsage); } catch (e: any) {
        console.error('[ChatKit webhook][detail.save][err]', e?.message);
      }
      recorded = true;
    } catch (e: any) {
      console.error('[ChatKit webhook][monthly.save][err]', e?.message);
    }

    const ms = Date.now() - startedAt;
    console.log('[ChatKit webhook][done]', { type, userId, responseId, threadId, runId, tokenUsage, recorded, ms });
    return json({ ok: true, recorded, type, userId, responseId, threadId, runId, tokenUsage, tookMs: ms });
  } catch (err: any) {
    console.error('[ChatKit webhook][fatal]', err?.message || err);
    return json({ error: err?.message ?? 'Unknown error' }, 500);
  }
}
