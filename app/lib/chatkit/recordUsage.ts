// Client-side helpers to record ChatKit usage via our backend run-proxy (mode=recordUsage)
// Safe to import from client components.

export async function recordChatkitUsage(params: {
  userId: string;
  responseId?: string;
  threadId?: string;
  runId?: string;
}) {
  try {
    const res = await fetch('/api/assistants/run-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'recordUsage', ...params }),
    });
    const json = await res.json().catch(() => ({} as any));
    if (!res.ok) throw new Error(json?.error || 'recordUsage failed');
    return json as { ok: boolean; recorded?: boolean; tokenUsage?: any };
  } catch (e) {
    console.error('[recordChatkitUsage] error:', e);
    return { ok: false } as any;
  }
}

// Bind a window message listener to capture ChatKit completion events, if any.
// This is defensive: it only reacts when payload carries recognizable identifiers.
export function bindRecordUsage(options: {
  userId: string;
  onRecorded?: (info: { recorded?: boolean; tokenUsage?: any }) => void;
}) {
  if (typeof window === 'undefined') return () => {};
  const handler = async (ev: MessageEvent) => {
    const data: any = ev?.data;
    if (!data || typeof data !== 'object') return;

    // Accept several common shapes
    const type: string | undefined = data?.type || data?.event || data?.name;
    const responseId: string | undefined = data?.responseId || data?.response_id || data?.data?.response_id || (type === 'response.completed' ? data?.data?.id : undefined);
    const threadId: string | undefined = data?.threadId || data?.thread_id || data?.data?.thread_id;
    const runId: string | undefined = data?.runId || data?.run_id || data?.data?.run_id || data?.data?.id;

    const looksCompleted = !!type && (type.includes('completed') || type === 'response.completed' || type === 'thread.run.completed');

    if (!looksCompleted) return;
    if (!responseId && !(threadId && runId)) return;

    // Try to record usage
    const result = await recordChatkitUsage({ userId: options.userId, responseId, threadId, runId });
    options.onRecorded?.(result || {});
  };

  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
