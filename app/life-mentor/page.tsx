"use client";

import { useState, useEffect, useRef } from 'react';
import WithChat from '@/app/components/layouts/WithChat';
import { useAuth } from '@/app/contexts/AuthContext';
import { useChat } from '@/app/contexts/ChatContext';
import ConversationList from '@/app/components/ConversationList';
import MessageList from '@/app/components/Chat/MessageList';
import ChatInput from '@/app/components/Chat/ChatInput';
import AIFloatingBubble from '@/app/components/Chat/AIFloatingBubble';
import { CHAT_TYPES } from '@/app/config/chatTypes';
import styles from './LifeMentor.module.css';

function LifeMentorContent() {
  const { user, identityId } = useAuth();
  // 訪客也能使用：對話紀錄以身分 id（會員 userId／訪客 guest id）為 key
  const chatUserId = user?.user_id || identityId;
  const {
    messages,
    currentThreadId,
    setCurrentThreadId,
    sendMessage,
    isLoading,
    error,
    setError,
    loadChatHistory,
    setMessages,
  } = useChat();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const shouldLoadHistory = useRef(false);

  useEffect(() => {
    if (currentThreadId && chatUserId && shouldLoadHistory.current) {
      shouldLoadHistory.current = false;
      loadChatHistory(chatUserId);
    }
  }, [currentThreadId]);

  const handleCreateNewThread = () => {
    setCurrentThreadId(null);
    setMessages([]);
  };

  const handleSelectThread = (threadId: string) => {
    if (threadId === currentThreadId) return;
    shouldLoadHistory.current = true;
    setError('');
    setMessages([]);
    setCurrentThreadId(threadId);
    setSidebarOpen(false);
  };

  const handleSendMessage = async (message: string) => {
    await sendMessage(message);
    window.dispatchEvent(new CustomEvent('refreshConversations'));
  };

  if (!chatUserId) return null;

  return (
    <div className={styles.pageBackground}>
      <div className={`${styles.floatingPanel}${chatOpen ? ' ' + styles.panelOpen : ''}`}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>人生導師 AI 助手</span>
          <button className={styles.panelClose} onClick={() => setChatOpen(false)}>✕</button>
        </div>
        <div className={styles.chatWrapper}>
          <div className={`${styles.sidebar}${sidebarOpen ? ' ' + styles.sidebarOpen : ''}`}>
            <button className={styles.sidebarToggle} onClick={() => setSidebarOpen(v => !v)}>
              <span>📋 對話記錄</span><span>{sidebarOpen ? '▲' : '▼'}</span>
            </button>
            <ConversationList
              userId={chatUserId}
              type={CHAT_TYPES.LIFE_MENTOR}
              currentThreadId={currentThreadId}
              onSelectThread={handleSelectThread}
              isCreating={false}
              onCreateNewThread={handleCreateNewThread}
              sidebarMode={true}
            />
          </div>
          <div className={styles.main}>
            <MessageList messages={messages} isLoading={isLoading} />
            {error && <div className={styles.errorBanner}>{error}</div>}
            <ChatInput onSend={handleSendMessage} isLoading={isLoading} />
          </div>
        </div>
      </div>
      <AIFloatingBubble
        open={chatOpen}
        onToggle={() => { setChatOpen(v => !v); setSidebarOpen(false); }}
        position="top-right"
      />
    </div>
  );
}

export default function LifeMentorPage() {
  return (
    <WithChat chatType={CHAT_TYPES.LIFE_MENTOR}>
      <LifeMentorContent />
    </WithChat>
  );
}
