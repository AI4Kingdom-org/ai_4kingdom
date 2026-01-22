"use client";

import Script from 'next/script';
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ChatkitEmbed from '../components/ChatkitEmbed';
import WithChat from '../components/layouts/WithChat';
import styles from './page.module.css';

function KouShihYuanContent() {
  const { user } = useAuth();
  const [chatkitScriptReady, setChatkitScriptReady] = useState(false);
  const [chatkitScriptError, setChatkitScriptError] = useState<string | null>(null);
  const [guestId, setGuestId] = useState<string>('');

  useEffect(() => {
    // Generate or retrieve guest ID for non-logged-in users
    const key = 'kou_shih_yuan_guest_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = `guest_${Math.random().toString(36).slice(2, 11)}`;
      localStorage.setItem(key, id);
    }
    setGuestId(id);
  }, []);

  const effectiveUserId = user?.user_id || guestId;

  return (
    <div style={{ padding: 16, color: '#000' }}>
      <Script
        src="https://cdn.platform.openai.com/deployments/chatkit/chatkit.js"
        strategy="afterInteractive"
        onLoad={() => {
          setChatkitScriptReady(true);
          setChatkitScriptError(null);
        }}
        onError={() => {
          setChatkitScriptReady(false);
          setChatkitScriptError('ChatKit 腳本載入失敗');
        }}
      />

      {/* 外層容器：與其他 ChatKit 頁面一致的置中與最大寬度 */}
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* 內層內容寬度：90% 並限制最大寬度 900px */}
        <div style={{ width: '90%', maxWidth: 900, margin: '0 auto' }}>
          {/* 聊天區塊：固定高度，避免透明背景看起來像空白 */}
          <div
            style={{
              width: '100%',
              height: '80vh',
              minHeight: '600px',
              borderRadius: 12,
              overflow: 'hidden',
              boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
              backgroundColor: '#fff',
            }}
          >
            {effectiveUserId ? (
              chatkitScriptError ? (
                <div style={{ textAlign: 'center', padding: '20px' }}>{chatkitScriptError}</div>
              ) : chatkitScriptReady ? (
                <ChatkitEmbed userId={effectiveUserId} unitId="kou-shih-yuan" module="kou-shih-yuan" />
              ) : (
                <div style={{ textAlign: 'center', padding: '20px' }}>ChatKit 載入中…</div>
              )
            ) : (
              <div style={{ textAlign: 'center', padding: '20px' }}>初始化中…</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <WithChat disableChatContext>
      <KouShihYuanContent />
    </WithChat>
  );
}
