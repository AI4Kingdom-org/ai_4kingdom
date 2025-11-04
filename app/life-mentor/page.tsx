"use client";

import { useEffect, useState } from 'react';
import { useAuth } from '@/app/contexts/AuthContext';
import WithChat from '@/app/components/layouts/WithChat';
import ChatkitEmbed from '@/app/components/ChatkitEmbed';
import { CHAT_TYPES } from '@/app/config/chatTypes';
import Script from 'next/script';

export default function LifeMentorPage() {
  const { user, loading } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!loading) setReady(true);
  }, [loading]);

  if (!ready) return <div>Loading…</div>;
  if (!user) return <div>請先登入</div>;

  return (
    <WithChat chatType={CHAT_TYPES.SUNDAY_GUIDE} disableChatContext>
      <div style={{ padding: 16, color: '#000' }}>
        <h1 style={{ margin: '8px 0 16px', color: '#000' }}>信仰生活助手</h1>
        {/* ChatKit 前端 SDK 腳本（必要） */}
        <Script src="https://cdn.platform.openai.com/deployments/chatkit/chatkit.js" strategy="afterInteractive" />
        <div style={{ height: '70vh' }}>
          <ChatkitEmbed userId={user.user_id} module="life-mentor" />
        </div>
      </div>
    </WithChat>
  );
}
