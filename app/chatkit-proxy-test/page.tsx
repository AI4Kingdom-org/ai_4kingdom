'use client';

import { useState } from 'react';
import { useAuth } from '@/app/contexts/AuthContext';
import { useCredit } from '@/app/contexts/CreditContext';
import WithChat from '@/app/components/layouts/WithChat';
import { CHAT_TYPE_CONFIGS, CHAT_TYPES } from '@/app/config/chatTypes';
import { ASSISTANT_IDS } from '@/app/config/constants';
import { runWithProxy } from '@/app/lib/assistants/runProxy';

export default function ChatkitProxyTestPage() {
  const { user } = useAuth();
  const { refreshUsage } = useCredit();
  const [text, setText] = useState('請用三點摘要本周講道');
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const typeCfg = CHAT_TYPE_CONFIGS[CHAT_TYPES.SUNDAY_GUIDE];

  async function onSend() {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const data = await runWithProxy({
        assistantId: typeCfg.assistantId || ASSISTANT_IDS.GENERAL,
        userId: user.user_id,
        text,
        threadId,
        vectorStoreIds: typeCfg.vectorStoreId ? [typeCfg.vectorStoreId] : undefined,
        chatType: CHAT_TYPES.SUNDAY_GUIDE,
      });
      setThreadId(data.threadId);
      setOutputs(data.outputs || []);
      // 更新額度
      await refreshUsage();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <WithChat disableChatContext chatType={CHAT_TYPES.SUNDAY_GUIDE}>
      <div style={{ maxWidth: 800, margin: '24px auto', padding: 16 }}>
        <h1>ChatKit Proxy 測試（計費/扣點版）</h1>
        <p style={{ color: '#666' }}>這個頁面直接呼叫 /api/assistants/run-proxy，完成後會更新使用量。</p>

        <div style={{ marginTop: 12 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            style={{ width: '100%', fontFamily: 'inherit' }}
          />
        </div>

        <button onClick={onSend} disabled={loading || !user} style={{ marginTop: 12 }}>
          {loading ? '送出中…' : '送出並計費'}
        </button>

        {error && (
          <div style={{ color: '#c00', marginTop: 12 }}>錯誤：{error}</div>
        )}

        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: '#666' }}>ThreadId：{threadId || '(尚未建立)'}</div>
          {outputs.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h3>回覆</h3>
              {outputs.map((o, i) => (
                <pre key={i} style={{ whiteSpace: 'pre-wrap' }}>{o}</pre>
              ))}
            </div>
          )}
        </div>
      </div>
    </WithChat>
  );
}
