// app/api/chatkit/session/route.ts
import { NextRequest, NextResponse } from 'next/server';

// Ensure this route is always dynamic on Amplify/Next.js App Router
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

// POST /api/chatkit/session
// Issues a short-lived ChatKit client_secret for the frontend.
export async function POST(req: NextRequest) {
  try {
  const { userId } = await req.json().catch(() => ({ userId: undefined }));

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 });
    }
    if (!process.env.SUNDAY_GUIDE_WORKFLOW_ID) {
      return NextResponse.json({ error: 'Missing SUNDAY_GUIDE_WORKFLOW_ID' }, { status: 500 });
    }

    // Basic auth gate: require a valid userId from your auth system.
    if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ---- Call OpenAI ChatKit Sessions API ----
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'chatkit_beta=v1',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    };
    if (process.env.OPENAI_ORG_ID) headers['OpenAI-Organization'] = process.env.OPENAI_ORG_ID;
    if (process.env.OPENAI_PROJECT) headers['OpenAI-Project'] = process.env.OPENAI_PROJECT;

    // 嘗試帶上 webhook（若 API 版本不支援，將在下方 fallback）
    const baseBody: any = {
      workflow: { id: process.env.SUNDAY_GUIDE_WORKFLOW_ID },
      user: userId,
      // expires_in: 90,
    };
    const webhookUrl = process.env.CHATKIT_WEBHOOK_URL || process.env.NEXT_PUBLIC_CHATKIT_WEBHOOK_URL;
    const tryWebhookBody = webhookUrl ? { ...baseBody, webhook: { url: webhookUrl } } : baseBody;

    // 嘗試帶 webhook 建立 session；若 4xx 則回退不帶 webhook
    let resp = await fetch('https://api.openai.com/v1/chatkit/sessions', {
      method: 'POST',
      headers,
      body: JSON.stringify(tryWebhookBody),
      cache: 'no-store',
    });
    if (!resp.ok && webhookUrl && resp.status >= 400 && resp.status < 500) {
      // 可能 API 版本不支援 webhook 欄位，回退重試
      console.warn('[ChatKit session] webhook not accepted, retrying without webhook. status=', resp.status);
      resp = await fetch('https://api.openai.com/v1/chatkit/sessions', {
        method: 'POST',
        headers,
        body: JSON.stringify(baseBody),
        cache: 'no-store',
      });
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return NextResponse.json(
        { error: `OpenAI ChatKit session failed: ${resp.status} ${text}` },
        { status: 500 }
      );
    }

    // 可能的回傳格式（依版本不同）：{ client_secret, expires_in?, expires_at? }
    const json = (await resp.json()) as {
      client_secret?: string;
      expires_in?: number;     // seconds
      expires_at?: number;     // epoch millis or seconds（依版本而定）
    };

    if (!json?.client_secret) {
      return NextResponse.json({ error: 'Missing client_secret in ChatKit response' }, { status: 500 });
    }

    // 盡量推導 expires_in；若沒有就給預設 90 秒
    let expiresIn = 90;
    if (typeof json.expires_in === 'number' && Number.isFinite(json.expires_in)) {
      expiresIn = json.expires_in;
    } else if (typeof json.expires_at === 'number' && Number.isFinite(json.expires_at)) {
      const nowMs = Date.now();
      // 有些 API 回傳秒，有些回傳毫秒；兩種都處理
      const expMs = json.expires_at > 10_000_000_000 ? json.expires_at : json.expires_at * 1000;
      const diffSec = Math.max(1, Math.floor((expMs - nowMs) / 1000));
      expiresIn = diffSec;
    }

    const res = NextResponse.json(
      { client_secret: json.client_secret, expires_in: expiresIn },
      { status: 200 }
    );
    // 禁止快取，避免舊 secret 被瀏覽器或代理留存
    res.headers.set('Cache-Control', 'no-store, max-age=0');

    return res;
  } catch (err: any) {
    console.error('[ChatKit session] error:', err);
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 });
  }
}

// Lightweight GET probe to help verify env wiring without issuing a client_secret
export async function GET(_req: NextRequest) {
  try {
    const workflowId = process.env.SUNDAY_GUIDE_WORKFLOW_ID || process.env.NEXT_PUBLIC_SUNDAY_GUIDE_WORKFLOW_ID;
    if (!workflowId) {
      return NextResponse.json(
        { ok: false, error: 'Missing SUNDAY_GUIDE_WORKFLOW_ID (or NEXT_PUBLIC_SUNDAY_GUIDE_WORKFLOW_ID)' },
        { status: 400 }
      );
    }
    const res = NextResponse.json({ ok: true, workflowId });
    res.headers.set('Cache-Control', 'no-store, max-age=0');
    return res;
  } catch (err: any) {
    console.error('[ChatKit session][GET] error:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
