'use client';

import { useEffect, useState } from 'react';
import { useAuth, AuthProvider } from '../contexts/AuthContext';
import ChatkitEmbed from '../components/ChatkitEmbed';
import Script from 'next/script';

function HomeschoolContent() {
  const { user, loading } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!loading) setReady(true);
  }, [loading]);

  if (!ready) return <div style={{ padding: 16, textAlign: 'center' }}>載入中...</div>;
  if (!user) return <div style={{ padding: 16, textAlign: 'center' }}>請先登入</div>;

  return (
    <div style={{ padding: 16, color: '#000' }}>
      {/* ChatKit 前端 SDK 腳本（必要） */}
      <Script src="https://cdn.platform.openai.com/deployments/chatkit/chatkit.js" strategy="afterInteractive" />
      {/* 外層容器：與其他 ChatKit 頁面一致的置中與最大寬度 */}
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* 內層內容寬度：90% 並限制最大寬度 900px */}
        <div style={{ width: '90%', maxWidth: 900, margin: '0 auto' }}>
          {/* 標題區塊 */}
          <div style={{ marginBottom: 24, textAlign: 'center' }}>
           
            <p style={{ fontSize: 14, color: '#666' }}>
              請告訴我您孩子的情況，我會據以為您提供建議
            </p>
          </div>
          {/* 聊天區塊寬度 100% 並固定高度 */}
          <div style={{ 
            width: '100%', 
            height: 500, 
            borderRadius: 12, 
            overflow: 'hidden', 
            boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
            backgroundColor: '#fff'
          }}>
            <ChatkitEmbed userId={user.user_id} module="homeschool" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomeschoolPage() {
  return (
    <AuthProvider optional={true}>
      <HomeschoolContent />
    </AuthProvider>
  );
}