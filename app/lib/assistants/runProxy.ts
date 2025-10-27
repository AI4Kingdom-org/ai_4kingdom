export async function runWithProxy(params: {
  assistantId: string;
  userId: string;
  text?: string;
  threadId?: string;
  messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  vectorStoreIds?: string[];
  chatType?: string;
  metadata?: Record<string, string>;
}) {
  const res = await fetch('/api/assistants/run-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assistantId: params.assistantId,
      userId: params.userId,
      threadId: params.threadId,
      message: params.text,
      messages: params.messages,
      vectorStoreIds: params.vectorStoreIds,
      chatType: params.chatType,
      metadata: params.metadata,
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({} as any));
    throw new Error(e.error || 'run-proxy failed');
  }
  return res.json() as Promise<{
    threadId: string;
    runId: string;
    status: string;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
    outputs: string[];
    messages: any[];
  }>;
}
