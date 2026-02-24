"use client";

import Script from 'next/script';
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ChatkitEmbed from '../components/ChatkitEmbed';
import WithChat from '../components/layouts/WithChat';
import styles from './page.module.css';

function ZhimingYuanContent() {
  const { user } = useAuth();
  const [chatkitScriptReady, setChatkitScriptReady] = useState(false);
  const [chatkitScriptError, setChatkitScriptError] = useState<string | null>(null);
  const [guestId, setGuestId] = useState<string>('');

  useEffect(() => {
    // Generate or retrieve guest ID for non-logged-in users
    const key = 'zhiming_yuan_guest_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = `guest_${Math.random().toString(36).slice(2, 11)}`;
      localStorage.setItem(key, id);
    }
    setGuestId(id);
  }, []);

  const effectiveUserId = user?.user_id || guestId;

  return (
    <div className={styles.pageWrapper}>
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

      <div className={styles.outerContainer}>
        <div className={styles.innerContainer}>
          <div className={styles.chatBox}>
            {effectiveUserId ? (
              chatkitScriptError ? (
                <div className={styles.statusMessage}>{chatkitScriptError}</div>
              ) : chatkitScriptReady ? (
                <ChatkitEmbed userId={effectiveUserId} unitId="zhiming-yuan" module="zhiming-yuan" />
              ) : (
                <div className={styles.statusMessage}>ChatKit 載入中…</div>
              )
            ) : (
              <div className={styles.statusMessage}>初始化中…</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ZhimingYuanPage() {
  return (
    <WithChat disableChatContext>
      <ZhimingYuanContent />
    </WithChat>
  );
}
