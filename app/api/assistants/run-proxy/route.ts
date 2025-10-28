import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
import OpenAI from 'openai';
import { updateMonthlyTokenUsage } from '@/app/utils/monthlyTokenUsage';
import { saveTokenUsage } from '@/app/utils/tokenUsage';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Poll a run until it reaches a terminal state or requires action
async function waitForRunCompletion(threadId: string, runId: string, timeoutMs = 180_000, intervalMs = 1200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = await openai.beta.threads.runs.retrieve(threadId, runId);

    if (
      run.status === 'completed' ||
      run.status === 'failed' ||
      run.status === 'cancelled' ||
      run.status === 'expired'
    ) {
      return run;
    }

    if (run.status === 'requires_action') {
      // 若有工具需求，交由前端或其他 webhook 接手
      return run;
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Run polling timeout');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Lightweight accounting-only mode: recordUsage
    if (body?.mode === 'recordUsage') {
      const startedAt = Date.now();
      const { userId, responseId, threadId, runId } = body as {
        userId?: string;
        responseId?: string;
        threadId?: string;
        runId?: string;
      };

      if (!process.env.OPENAI_API_KEY) {
        return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 });
      }

      // Identify and retrieve usage from either Responses API or Runs API
      let tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; retrieval_tokens: number } | null = null;
      let effectiveUserId = userId;
      let uniqueId: string | null = null;

      // Helper to build headers for REST
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      };
      if (process.env.OPENAI_ORG_ID) headers['OpenAI-Organization'] = process.env.OPENAI_ORG_ID;
      if (process.env.OPENAI_PROJECT) headers['OpenAI-Project'] = process.env.OPENAI_PROJECT;

      if (responseId) {
        uniqueId = String(responseId);
        // Try up to 3 times in case usage lags
        let resp: any = null;
        for (let i = 0; i < 3; i++) {
          try {
            const res = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(String(responseId))}`, {
              method: 'GET',
              headers,
              cache: 'no-store',
            });
            if (res.ok) resp = await res.json();
          } catch {}
          if (resp?.usage) break;
          await new Promise((r) => setTimeout(r, 600));
        }
        if (resp) {
          effectiveUserId = effectiveUserId || resp?.metadata?.userId || resp?.metadata?.user || undefined;
          const u: any = resp?.usage;
          if (u) {
            const prompt = u.input_tokens ?? u.prompt_tokens ?? 0;
            const completion = u.output_tokens ?? u.completion_tokens ?? 0;
            const total = u.total_tokens ?? prompt + completion;
            tokenUsage = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total, retrieval_tokens: 0 };
          }
        }
      } else if (threadId && runId) {
        uniqueId = String(runId);
        let finalRun: any = null;
        for (let i = 0; i < 3; i++) {
          finalRun = await openai.beta.threads.runs
            .retrieve(String(threadId), String(runId))
            .catch(() => null);
          if (finalRun?.usage) break;
          await new Promise((r) => setTimeout(r, 600));
        }
        if (finalRun) {
          effectiveUserId = effectiveUserId || finalRun?.metadata?.userId || finalRun?.user || undefined;
          if (!effectiveUserId && threadId) {
            const thread = await openai.beta.threads.retrieve(String(threadId)).catch(() => null as any);
            effectiveUserId = thread?.metadata?.userId || thread?.user || effectiveUserId;
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
      } else {
        return NextResponse.json({ ok: true, skipped: 'no identifier', tookMs: Date.now() - startedAt });
      }

      if (!effectiveUserId) {
        return NextResponse.json({ ok: true, skipped: 'no userId', tookMs: Date.now() - startedAt });
      }
      if (!tokenUsage || (!tokenUsage.total_tokens && !tokenUsage.prompt_tokens && !tokenUsage.completion_tokens)) {
        return NextResponse.json({ ok: true, skipped: 'no usage', tookMs: Date.now() - startedAt });
      }

      let recorded = false;
      try {
        await updateMonthlyTokenUsage(String(effectiveUserId), tokenUsage);
        try {
          await saveTokenUsage(String(effectiveUserId), String(uniqueId || threadId || runId || 'unknown'), tokenUsage);
        } catch (e) {
          console.error('[run-proxy][recordUsage] saveTokenUsage failed:', e);
        }
        recorded = true;
      } catch (e) {
        console.error('[run-proxy][recordUsage] updateMonthlyTokenUsage failed:', e);
      }

      return NextResponse.json({ ok: true, recorded, tokenUsage, tookMs: Date.now() - startedAt });
    }

    const {
      assistantId,
      threadId: inputThreadId,
      message,
      messages,
      vectorStoreIds,
      userId,
      chatType,
      metadata,
    }: {
      assistantId: string;
      threadId?: string;
      message?: string;
      messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
      vectorStoreIds?: string[];
      userId: string;
      chatType?: string;
      metadata?: Record<string, string>;
    } = body;

    if (!assistantId) {
      return NextResponse.json({ error: 'assistantId is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // TODO: 依你專案的認證機制，從 session/cookie 驗證 userId

    // 1) 建立或重用 thread
    const thread = inputThreadId
      ? { id: inputThreadId }
      : await openai.beta.threads.create({
          metadata: {
            userId,
            chatType: chatType ?? 'general',
            ...(metadata || {}),
          },
        });

    // 2) 寫入訊息
    if (message) {
      await openai.beta.threads.messages.create(thread.id, {
        role: 'user',
        content: message,
      });
    }
    if (Array.isArray(messages) && messages.length > 0) {
      for (const m of messages) {
        // Assistants Messages 僅接受 'user' | 'assistant'
        const role: 'user' | 'assistant' = (m.role === 'system' ? 'user' : m.role);
        await openai.beta.threads.messages.create(thread.id, {
          role,
          content: m.content,
        });
      }
    }

    // 3) 建立 run（可覆寫向量庫）
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId,
      ...(vectorStoreIds?.length
        ? { tool_resources: { file_search: { vector_store_ids: vectorStoreIds } } }
        : {}),
    });

    // 4) 等待完成或需要動作
    const finalRun = await waitForRunCompletion(thread.id, run.id);

    // 5) 記帳：run 完成才記
    if (finalRun.status === 'completed') {
      const usage: any = (finalRun as any)?.usage ?? null;
      const tokenUsage = {
        prompt_tokens: usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.completion_tokens ?? 0,
        total_tokens: usage?.total_tokens ?? 0,
        retrieval_tokens: usage?.retrieval_tokens ?? 0, // 若無則為 0
      };

      // 更新月度彙總（CreditContext 依此計算餘額）
      try {
        await updateMonthlyTokenUsage(userId, tokenUsage);
      } catch (e) {
        console.error('[run-proxy] updateMonthlyTokenUsage failed:', e);
      }

      // 保存逐次使用記錄，供後台明細查詢
      try {
        await saveTokenUsage(userId, thread.id, tokenUsage);
      } catch (e) {
        console.error('[run-proxy] saveTokenUsage failed:', e);
      }
    }

    // 6) 回收本次 run 的訊息
    const msgs = await openai.beta.threads.messages.list(thread.id, {
      run_id: finalRun.id,
      order: 'desc',
      limit: 50,
    });

    const assistantOutputs = msgs.data
      .filter((m) => m.role === 'assistant')
      .map((m) => (m.content || []).map((c: any) => (c.type === 'text' ? c.text.value : '')).join('\n'));

    return NextResponse.json({
      threadId: thread.id,
      runId: finalRun.id,
      status: finalRun.status,
      usage: (finalRun as any)?.usage ?? null,
      outputs: assistantOutputs.reverse(),
      messages: msgs.data.reverse(),
    });
  } catch (err: any) {
    console.error('[run-proxy] error:', err);
    return NextResponse.json(
      { error: err?.message ?? 'Internal Server Error' },
      { status: 500 },
    );
  }
}
