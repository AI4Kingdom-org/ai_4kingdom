'use client';

import { useEffect, useRef, useState } from 'react';
import { useCredit } from '@/app/contexts/CreditContext';
import { ChatKit, useChatKit } from '@openai/chatkit-react';
import { bindRecordUsage } from '@/app/lib/chatkit/recordUsage';

type Props = {
  userId: string;
  unitId?: string;
  // 可選：切換不同 ChatKit workflow 的模組代碼（例如 'life-mentor'）
  module?: string;
  className?: string;
};

export default function ChatkitEmbed({ userId, unitId, module, className }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ status: 'idle' | 'ok' | 'fail'; message?: string }>({ status: 'idle' });
  const { refreshUsage } = useCredit();

  // 保存最新的 ids，避免 effect 依賴變動導致重跑
  const latestIds = useRef({ userId, unitId, module });
  latestIds.current = { userId, unitId, module };

  // 本地快取 client_secret 與到期時間（毫秒）
  const secretCache = useRef<{ value: string | null; exp: number }>({ value: null, exp: 0 });

  // 僅掛載一次做 probe（避免 React 18/HMR 雙掛載）
  useEffect(() => {
    let aborted = false;
    let refreshTimer: any;
    let unbind: (() => void) | undefined;

    (async () => {
      try {
        console.log('[ChatKit] ChatkitEmbed mounted (probe once)');
        const res = await fetch('/api/chatkit/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(latestIds.current),
        });
        if (!res.ok) {
          const text = await res.text();
          console.error('[ChatKit] probe session API error:', res.status, text);
          if (!aborted) setProbe({ status: 'fail', message: `${res.status} ${text}` });
        } else {
          const json = await res.json();
          console.log('[ChatKit] probe session OK, received client_secret length:', (json?.client_secret || '').length);
          if (!aborted) setProbe({ status: 'ok' });
          // 啟動一段短期輪詢，嘗試在使用者互動後刷新餘額（搭配 webhook 寫庫時能即時顯示）
          // 20s 內每 5s 刷一次，避免長時間輪詢
          let polls = 0;
          const MAX_POLLS = 4;
          refreshTimer = setInterval(() => {
            polls += 1;
            if (polls > MAX_POLLS) {
              clearInterval(refreshTimer);
              return;
            }
            try { refreshUsage?.(); } catch {}
          }, 5000);

          // 綁定 ChatKit 完成事件（若 ChatKit 會以 postMessage 通知）
          try {
            unbind = bindRecordUsage({
              userId: latestIds.current.userId,
              onRecorded: (info) => {
                if (info?.recorded) {
                  // 稍等一下後刷新餘額，讓 UI 跟上
                  setTimeout(() => { try { refreshUsage?.(); } catch {} }, 800);
                }
              },
            });
          } catch (e) {
            console.warn('[ChatKit] bindRecordUsage failed:', (e as any)?.message || e);
          }
        }
      } catch (e: any) {
        console.error('[ChatKit] probe session exception:', e?.message || e);
        if (!aborted) setProbe({ status: 'fail', message: e?.message || String(e) });
      }
    })();

    const onUH = (ev: PromiseRejectionEvent) => {
      console.error('[ChatKit] unhandled rejection:', ev.reason);
    };
    window.addEventListener('unhandledrejection', onUH);

    return () => {
      aborted = true;
      if (refreshTimer) clearInterval(refreshTimer);
      window.removeEventListener('unhandledrejection', onUH);
      try { unbind?.(); } catch {}
    };
    // 空依賴 -> 只跑一次
  }, []);

  const { control } = useChatKit({
    api: {
      // ✅ 正確簽名：(currentClientSecret: string | null) => Promise<string>
      async getClientSecret(_current: string | null): Promise<string> {
        try {
          const now = Date.now();
          // 若本地快取仍有效（預留 15 秒緩衝），直接用
          if (secretCache.current.value && secretCache.current.exp > now) {
            return secretCache.current.value!;
          }

          const res = await fetch('/api/chatkit/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(latestIds.current),
            cache: 'no-store',
          });

          if (!res.ok) {
            const text = await res.text();
            console.error('[ChatKit] session API error:', res.status, text);
            setError(`ChatKit session failed: ${res.status} ${text}`);
            throw new Error(`Failed to init ChatKit session: ${res.status} ${text}`);
          }

          // 後端若能回傳 expires_in（秒），就用它計算 TTL；沒有就預設 90 秒
          const payload = (await res.json()) as {
            client_secret: string;
            expires_in?: number; // 秒
          };

          const ttlMs = ((payload.expires_in ?? 90) * 1000) - 15_000; // 預留 15 秒緩衝
          secretCache.current = {
            value: payload.client_secret,
            exp: Date.now() + Math.max(ttlMs, 30_000), // 至少緩存 30 秒，避免 0 或負值
          };

          console.log('[ChatKit] session acquired');
          setError(null);
          return payload.client_secret;
        } catch (e: any) {
          console.error('[ChatKit] getClientSecret exception:', e?.message || e);
          setError(e?.message || 'Unknown error');
          throw e;
        }
      },
    },
  });

  if (error) {
    return (
      <div
        style={{
          border: '1px solid #fdd',
          background: '#fff5f5',
          color: '#b00020',
          padding: 12,
          borderRadius: 8,
          fontSize: 13,
        }}
      >
        ChatKit 初始化失敗：{error}
        <div style={{ marginTop: 8, color: '#444' }}>
          檢查事項：
          <ul style={{ margin: '6px 0 0 16px' }}>
            <li>伺服器端有設定 <code>OPENAI_API_KEY</code>（不可曝露到前端）。</li>
            <li>Agent 已 Published，Allowed Domains 含目前來源（含協定與埠）。</li>
            <li>Network → <code>/api/chatkit/session</code> 的回應與錯誤訊息。</li>
          </ul>
          <div style={{ marginTop: 6, fontFamily: 'monospace' }}>
            probe: {probe.status}
            {probe.message ? ` - ${probe.message}` : ''}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 360 }}>
      {probe.status !== 'ok' && (
        <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
          初始化中… {probe.status === 'fail' ? `(probe: ${probe.message})` : ''}
        </div>
      )}

      {probe.status === 'ok' && (
        <ChatKit
          key={userId} // 使用者切換時強制 remount，避免舊 session 殘留
          control={control}
          className={className}
          style={{ width: '100%', height: '100%' }}
        />
      )}
    </div>
  );
}
