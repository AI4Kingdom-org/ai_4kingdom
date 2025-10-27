import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { updateMonthlyTokenUsage } from '@/app/utils/monthlyTokenUsage';
import { saveTokenUsage } from '@/app/utils/tokenUsage';

// Webhook for ChatKit (if configured in OpenAI) to notify run completion.
// This endpoint is defensive: it tries to extract thread/run/user from payload,
// then retrieves the run to get usage and records monthly usage.
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json().catch(() => ({}));

    // Common fields we try to detect from various event shapes
    const type = payload?.type || payload?.event || payload?.name;
  const threadId = payload?.thread_id || payload?.threadId || payload?.data?.thread_id || payload?.data?.threadId;
    const runId = payload?.run_id || payload?.runId || payload?.data?.id || payload?.data?.run_id;
    const userId = payload?.user || payload?.user_id || payload?.userId || payload?.data?.user || payload?.data?.user_id;

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 });
    }

    // Only handle completed run events; ignore pings
    const isCompleted = type?.includes('completed') || type === 'run.completed' || type === 'thread.run.completed';
    if (!isCompleted || !threadId || !runId || !userId) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const finalRun = await openai.beta.threads.runs.retrieve(String(threadId), String(runId));
    const u: any = (finalRun as any)?.usage;
  const ensuredThreadId = (finalRun as any)?.thread_id || threadId;

    if (u && userId) {
      const tokenUsage = {
        prompt_tokens: u.prompt_tokens || 0,
        completion_tokens: u.completion_tokens || 0,
        total_tokens: u.total_tokens || 0,
        retrieval_tokens: 0,
      };
      await updateMonthlyTokenUsage(String(userId), tokenUsage);
      // 同時寫入詳細使用記錄，便於後台檢視
      try { await saveTokenUsage(String(userId), String(ensuredThreadId || 'unknown'), tokenUsage); } catch {}
      return NextResponse.json({ ok: true, recorded: true });
    }

    return NextResponse.json({ ok: true, recorded: false });
  } catch (err: any) {
    console.error('[ChatKit webhook] error:', err);
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 });
  }
}
