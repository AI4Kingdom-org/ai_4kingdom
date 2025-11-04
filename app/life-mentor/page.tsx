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
        {/* ChatKit 前端 SDK 腳本（必要） */}
        <Script src="https://cdn.platform.openai.com/deployments/chatkit/chatkit.js" strategy="afterInteractive" />
        {/* 外層容器：與 user-sunday-guide 一致的置中與最大寬度 */}
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          {/* 內層內容寬度：90% 並限制最大寬度 900px，與 user-sunday-guide 的 contentWrapper 一致 */}
          <div style={{ width: '90%', maxWidth: 900, margin: '0 auto' }}>
            {/* 聊天區塊寬度 100% 並固定高度，視覺與 user-sunday-guide 的 chatSection 一致 */}
            <div style={{ width: '100%', height: 450, borderRadius: 12, overflow: 'hidden', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>
              <ChatkitEmbed userId={user.user_id} module="life-mentor" />
            </div>
          </div>
        </div>
      </div>
    </WithChat>
  );
}
