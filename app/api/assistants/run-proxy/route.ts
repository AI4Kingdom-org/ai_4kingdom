import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
import { updateMonthlyTokenUsage } from '@/app/utils/monthlyTokenUsage';
import { saveTokenUsage, trySaveTokenUsageOnce } from '@/app/utils/tokenUsage';
import { getOpenAI } from '@/app/lib/openai/client';
import { ensureConversation } from '@/app/lib/openai/conversation';
import { generateResponse, toTokenUsage } from '@/app/lib/openai/responses';

const openai = getOpenAI();

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

      // Identify and retrieve usage from either Responses API or (legacy) Runs API
      let tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; retrieval_tokens: number } | null = null;
      let effectiveUserId = userId;
      let uniqueId: string | null = null;

      if (responseId) {
        uniqueId = String(responseId);
        // Try up to 3 times in case usage lags
        let resp: any = null;
        for (let i = 0; i < 3; i++) {
          resp = await openai.responses.retrieve(String(responseId)).catch(() => null);
          if (resp?.usage) break;
          await new Promise((r) => setTimeout(r, 600));
        }
        if (resp) {
          effectiveUserId = effectiveUserId || resp?.metadata?.userId || resp?.metadata?.user || undefined;
          tokenUsage = toTokenUsage(resp?.usage);
        }
      } else if (threadId && runId) {
        // 舊 Assistants 事件形狀：日落前仍支援
        uniqueId = String(runId);
        let finalRun: any = null;
        for (let i = 0; i < 3; i++) {
          finalRun = await openai.beta.threads.runs
            .retrieve(String(runId), { thread_id: String(threadId) })
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
        const eventId = String(uniqueId || threadId || runId || 'unknown');

        // 去重：若同一 responseId/runId 已記過，避免重複加總
        const dedupe = await trySaveTokenUsageOnce(String(effectiveUserId), eventId, tokenUsage);
        if (!dedupe.saved) {
          return NextResponse.json({ ok: true, recorded: false, duplicate: true, tokenUsage, tookMs: Date.now() - startedAt });
        }

        await updateMonthlyTokenUsage(String(effectiveUserId), tokenUsage);

        // 額外寫入時間序列明細（不影響主流程）
        try {
          await saveTokenUsage(String(effectiveUserId), eventId, tokenUsage);
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

    // 1) 建立或重用 conversation（舊 thread_ ID 會被懶遷移）
    const { conversationId } = await ensureConversation(openai, inputThreadId, {
      userId,
      chatType: chatType ?? 'general',
      ...(metadata || {}),
    });

    // 2) 組合輸入訊息（Responses input 支援 system 角色，不需再降級為 user）
    const input: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
    if (Array.isArray(messages) && messages.length > 0) {
      for (const m of messages) {
        input.push({ role: m.role, content: m.content });
      }
    }
    if (message) {
      input.push({ role: 'user', content: message });
    }
    if (input.length === 0) {
      return NextResponse.json({ error: 'message or messages is required' }, { status: 400 });
    }

    // 3) 單次生成（取代舊的 run 建立 + 輪詢）
    const result = await generateResponse(openai, {
      assistantId,
      conversationId,
      input,
      vectorStoreIds,
    });

    // 4) 記帳：完成才記
    if (result.status === 'completed' && result.usage) {
      // 更新月度彙總（CreditContext 依此計算餘額）
      try {
        await updateMonthlyTokenUsage(userId, result.usage);
      } catch (e) {
        console.error('[run-proxy] updateMonthlyTokenUsage failed:', e);
      }

      // 保存逐次使用記錄，供後台明細查詢
      try {
        await saveTokenUsage(userId, conversationId, result.usage);
      } catch (e) {
        console.error('[run-proxy] saveTokenUsage failed:', e);
      }
    }

    // 5) 回傳（維持舊回應形狀：threadId/runId/status/usage/outputs/messages）
    const outputs = result.text ? [result.text] : [];
    return NextResponse.json({
      threadId: conversationId,
      runId: result.responseId,
      status: result.status,
      usage: result.usage,
      outputs,
      messages: outputs.map((text, i) => ({
        id: `${result.responseId}_${i}`,
        role: 'assistant',
        content: [{ type: 'text', text: { value: text } }],
      })),
    });
  } catch (err: any) {
    console.error('[run-proxy] error:', err);
    return NextResponse.json(
      { error: err?.message ?? 'Internal Server Error' },
      { status: 500 },
    );
  }
}
