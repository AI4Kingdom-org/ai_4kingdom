export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';

// 依照 module 切換 workflowId，預設回退到 SUNDAY_GUIDE
const resolveWorkflowId = (module?: string) => {
  const m = (module || '').toLowerCase();
  if (m === 'life-mentor') {
    return process.env.LIFE_MENTOR_WORKFLOW_ID || process.env.NEXT_PUBLIC_LIFE_MENTOR_WORKFLOW_ID || '';
  }
  if (m === 'child-mental' || m === 'children-mental') {
    return process.env.CHILD_MENTAL_WORKFLOW_ID || process.env.NEXT_PUBLIC_CHILD_MENTAL_WORKFLOW_ID || '';
  }
  if (m === 'homeschool') {
    return process.env.HOMESCHOOL_WORKFLOW_ID || process.env.NEXT_PUBLIC_HOMESCHOOL_WORKFLOW_ID || '';
  }
  if (m === 'agape-church-navigator' || m === 'east-christ-home-navigator') {
    return process.env.CHURCH_NAVIGATOR_WORKFLOW_ID || process.env.NEXT_PUBLIC_CHURCH_NAVIGATOR_WORKFLOW_ID || '';
  }
  if (m === 'jian-zhu-navigator') {
    return process.env.JIAN_ZHU_NAVIGATOR_WORKFLOW_ID || process.env.NEXT_PUBLIC_JIAN_ZHU_NAVIGATOR_WORKFLOW_ID || '';
  }
  return process.env.SUNDAY_GUIDE_WORKFLOW_ID || process.env.NEXT_PUBLIC_SUNDAY_GUIDE_WORKFLOW_ID || '';
};

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qModule = url.searchParams.get('module') || undefined;
    const body = await req.json().catch(() => ({} as any));
    const userId = body?.userId as string | undefined;
    const module = (body?.module as string | undefined) ?? qModule;
    const WF_ID = resolveWorkflowId(module);

    // 詳細的環境變數檢查日誌
    if (!process.env.OPENAI_API_KEY) {
      console.error('[ChatKit session] Error: Missing OPENAI_API_KEY');
      return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 });
    }
    if (!WF_ID) {
      console.error('[ChatKit session] Error: Missing workflow id for module:', module);
      console.error('[ChatKit session] Available configs:', {
        SUNDAY_GUIDE: !!process.env.SUNDAY_GUIDE_WORKFLOW_ID || !!process.env.NEXT_PUBLIC_SUNDAY_GUIDE_WORKFLOW_ID,
        LIFE_MENTOR: !!process.env.LIFE_MENTOR_WORKFLOW_ID || !!process.env.NEXT_PUBLIC_LIFE_MENTOR_WORKFLOW_ID,
        CHILD_MENTAL: !!process.env.CHILD_MENTAL_WORKFLOW_ID || !!process.env.NEXT_PUBLIC_CHILD_MENTAL_WORKFLOW_ID,
      });
      return NextResponse.json({ error: `Missing workflow id for module: ${module || 'default'}` }, { status: 500 });
    }
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      console.error('[ChatKit session] Error: Invalid or missing userId');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'chatkit_beta=v1',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    };
    if (process.env.OPENAI_ORG_ID) headers['OpenAI-Organization'] = process.env.OPENAI_ORG_ID!;
    if (process.env.OPENAI_PROJECT) headers['OpenAI-Project'] = process.env.OPENAI_PROJECT!;

  // ChatKit sessions API 不支援 metadata 參數；只帶 workflow 與 user
  // webhook URL 透過 ?uid= 傳遞 userId 作為備援
  const baseBody: any = { workflow: { id: WF_ID }, user: userId };
    const webhookBase = process.env.CHATKIT_WEBHOOK_URL || process.env.NEXT_PUBLIC_CHATKIT_WEBHOOK_URL;
    const webhookUrl = webhookBase && userId ? `${webhookBase}?uid=${encodeURIComponent(userId)}` : webhookBase;
    const tryWebhookBody = webhookUrl ? { ...baseBody, webhook: { url: webhookUrl } } : baseBody;

    console.log('[ChatKit session][create][try]', {
      module: module || 'default',
      workflowId: WF_ID,
      withWebhook: !!webhookUrl,
      userId,
    });

    let resp = await fetch('https://api.openai.com/v1/chatkit/sessions', {
      method: 'POST',
      headers,
      body: JSON.stringify(tryWebhookBody),
      cache: 'no-store',
    });
    
    if (!resp.ok && webhookUrl && resp.status >= 400 && resp.status < 500) {
      console.warn('[ChatKit session][create][retry-no-webhook]', { status: resp.status });
      resp = await fetch('https://api.openai.com/v1/chatkit/sessions', {
        method: 'POST',
        headers,
        body: JSON.stringify(baseBody),
        cache: 'no-store',
      });
    }
    
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error('[ChatKit session] OpenAI API error:', { 
        status: resp.status, 
        statusText: resp.statusText,
        responseText: text.substring(0, 200)
      });
      return NextResponse.json({ error: `OpenAI ChatKit session failed: ${resp.status} ${text.substring(0, 100)}` }, { status: 500 });
    }

    const json = await resp.json() as { client_secret?: string; expires_in?: number; expires_at?: number };
    if (!json?.client_secret) {
      console.error('[ChatKit session] Missing client_secret in response');
      return NextResponse.json({ error: 'Missing client_secret in ChatKit response' }, { status: 500 });
    }

    let expiresIn = 90;
    if (Number.isFinite(json.expires_in)) expiresIn = json.expires_in!;
    else if (Number.isFinite(json.expires_at)) {
      const now = Date.now();
      const expMs = (json.expires_at as number) > 10_000_000_000 ? json.expires_at! : json.expires_at! * 1000;
      expiresIn = Math.max(1, Math.floor((expMs - now) / 1000));
    }

    const res = NextResponse.json({ client_secret: json.client_secret, expires_in: expiresIn, webhookAttached: !!webhookUrl }, { status: 200 });
    res.headers.set('Cache-Control', 'no-store, max-age=0');
    return res;
  } catch (err: any) {
    console.error('[ChatKit session] Caught error:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function GET() {
  const ok = !!process.env.OPENAI_API_KEY && !!(
    process.env.SUNDAY_GUIDE_WORKFLOW_ID ||
    process.env.NEXT_PUBLIC_SUNDAY_GUIDE_WORKFLOW_ID ||
    process.env.LIFE_MENTOR_WORKFLOW_ID ||
    process.env.NEXT_PUBLIC_LIFE_MENTOR_WORKFLOW_ID ||
    process.env.CHILD_MENTAL_WORKFLOW_ID ||
    process.env.NEXT_PUBLIC_CHILD_MENTAL_WORKFLOW_ID ||
    process.env.HOMESCHOOL_WORKFLOW_ID ||
    process.env.NEXT_PUBLIC_HOMESCHOOL_WORKFLOW_ID ||
    process.env.CHURCH_NAVIGATOR_WORKFLOW_ID ||
    process.env.NEXT_PUBLIC_CHURCH_NAVIGATOR_WORKFLOW_ID ||
    process.env.JIAN_ZHU_NAVIGATOR_WORKFLOW_ID ||
    process.env.NEXT_PUBLIC_JIAN_ZHU_NAVIGATOR_WORKFLOW_ID
  );
  const res = NextResponse.json({ ok }, { status: ok ? 200 : 500 });
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}
