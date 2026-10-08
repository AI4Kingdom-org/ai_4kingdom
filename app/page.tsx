"use client";

import { AuthProvider, useAuth } from './contexts/AuthContext';
import WithChat from './components/layouts/WithChat';
import Chat from './components/Chat/Chat';
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CHAT_TYPES } from './config/chatTypes';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from './config/constants';
import { ChatProvider } from './contexts/ChatContext';

export default function Home() {
  const { user, loading, identityId } = useAuth();
  // 訪客也能使用：會員用 WP userId，訪客用 guest id
  const chatUserId = user?.user_id || identityId;

  console.log('[DEBUG] General页面初始化:', {
    userId: chatUserId,
    loading,
    assistantId: ASSISTANT_IDS.GENERAL,
    vectorStoreId: VECTOR_STORE_IDS.GENERAL
  });

  if (loading || !chatUserId) {
    return <div>加载中...</div>;
  }

  return (
    <ErrorBoundary>
      <AuthProvider>
        <WithChat>
          <main style={{ 
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{ flex: 1, display: 'flex' }}>
              <ChatProvider initialConfig={{
                type: CHAT_TYPES.GENERAL,
                assistantId: ASSISTANT_IDS.GENERAL,
                vectorStoreId: VECTOR_STORE_IDS.GENERAL,
                userId: chatUserId
              }}>
                <Chat
                  type={CHAT_TYPES.GENERAL}
                  assistantId={ASSISTANT_IDS.GENERAL}
                  vectorStoreId={VECTOR_STORE_IDS.GENERAL}
                  userId={chatUserId}
                />
              </ChatProvider>
            </div>
          </main>
        </WithChat>
      </AuthProvider>
    </ErrorBoundary>
  );
}