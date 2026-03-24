import { useState, useCallback, useRef } from 'react';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface UseRoutingAgentOptions {
  userId: string;
}

export function useRoutingAgent({ userId }: UseRoutingAgentOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* 保留 ref 供未來擴展（如 sessionId），目前未使用 */
  const _sessionRef = useRef<string | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) {
      setError('訊息不能為空');
      return;
    }

    if (isLoading) return;

    /* 讀取當前 messages 的快照，作為對話歷史傳給 API */
    let currentMessages: Message[] = [];
    setMessages((prev) => {
      currentMessages = prev;
      return prev;
    });

    try {
      setIsLoading(true);
      setError(null);

      // 新建用戶訊息
      const userMessage: Message = {
        id: `msg_${Date.now()}_user`,
        role: 'user',
        content: content.trim(),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);

      // 組合對話歷史（不含剛加入的用戶訊息，以免重複）
      const history = currentMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // 發送到路由助手專屬端點
      const response = await fetch('/api/routing-agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: content.trim(),
          userId,
          history,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData?.error || 
          errorData?.details?.message ||
          `API 錯誤: ${response.status}`
        );
      }

      // 處理流式回應
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('無法讀取回應流');
      }

      let assistantContent = '';
      const assistantMessage: Message = {
        id: `msg_${Date.now()}_assistant`,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = new TextDecoder().decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const data = JSON.parse(line);
              if (data?.content) {
                assistantContent += data.content;
              }
            } catch {
              // 忽略解析失敗的行
            }
          }

          // 即時更新訊息
          assistantMessage.content = assistantContent;
          setMessages((prev) => {
            const existing = prev.find((m) => m.id === assistantMessage.id);
            if (existing) {
              return prev.map((m) =>
                m.id === assistantMessage.id ? assistantMessage : m
              );
            }
            return [...prev, assistantMessage];
          });
        }
      } finally {
        reader.releaseLock();
      }

      if (!assistantContent) {
        setError('未收到有效的回應');
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : '發送訊息失敗，請稍後重試';
      setError(errorMsg);
      console.error('[useRoutingAgent] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId, isLoading]);

  const resetConversation = useCallback(() => {
    setMessages([]);
    setError(null);
    _sessionRef.current = null;
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    resetConversation,
  };
}
