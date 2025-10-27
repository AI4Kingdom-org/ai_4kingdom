export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';

const getWorkflowId = () =>
  process.env.SUNDAY_GUIDE_WORKFLOW_ID ||
  process.env.NEXT_PUBLIC_SUNDAY_GUIDE_WORKFLOW_ID ||
  '';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json().catch(() => ({ userId: undefined }));
    const WF_ID = getWorkflowId();

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 });
    }
    if (!WF_ID) {
      return NextResponse.json({ error: 'Missing SUNDAY_GUIDE_WORKFLOW_ID' }, { status: 500 });
    }
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'chatkit_beta=v1',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    };
    if (process.env.OPENAI_ORG_ID) headers['OpenAI-Organization'] = process.env.OPENAI_ORG_ID!;
    if (process.env.OPENAI_PROJECT) headers['OpenAI-Project'] = process.env.OPENAI_PROJECT!;

    const baseBody: any = { workflow: { id: WF_ID }, user: userId };
    const webhookUrl = process.env.CHATKIT_WEBHOOK_URL || process.env.NEXT_PUBLIC_CHATKIT_WEBHOOK_URL;
    const tryWebhookBody = webhookUrl ? { ...baseBody, webhook: { url: webhookUrl } } : baseBody;

    let resp = await fetch('https://api.openai.com/v1/chatkit/sessions', {
      method: 'POST',
      headers,
      body: JSON.stringify(tryWebhookBody),
      cache: 'no-store',
    });
    if (!resp.ok && webhookUrl && resp.status >= 400 && resp.status < 500) {
      resp = await fetch('https://api.openai.com/v1/chatkit/sessions', {
        method: 'POST',
        headers,
        body: JSON.stringify(baseBody),
        cache: 'no-store',
      });
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return NextResponse.json({ error: `OpenAI ChatKit session failed: ${resp.status} ${text}` }, { status: 500 });
    }

    const json = await resp.json() as { client_secret?: string; expires_in?: number; expires_at?: number };
    if (!json?.client_secret) return NextResponse.json({ error: 'Missing client_secret in ChatKit response' }, { status: 500 });

    let expiresIn = 90;
    if (Number.isFinite(json.expires_in)) expiresIn = json.expires_in!;
    else if (Number.isFinite(json.expires_at)) {
      const now = Date.now();
      const expMs = (json.expires_at as number) > 10_000_000_000 ? json.expires_at! : json.expires_at! * 1000;
      expiresIn = Math.max(1, Math.floor((expMs - now) / 1000));
    }

    const res = NextResponse.json({ client_secret: json.client_secret, expires_in: expiresIn }, { status: 200 });
    res.headers.set('Cache-Control', 'no-store, max-age=0');
    return res;
  } catch (err: any) {
    console.error('[ChatKit session] error:', err);
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function GET() {
  const ok = !!process.env.OPENAI_API_KEY && !!getWorkflowId();
  const res = NextResponse.json({ ok }, { status: ok ? 200 : 500 });
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}
