'use client';

import { useState, useEffect, useRef } from 'react';
import WithChat from '../components/layouts/WithChat';
import { useAuth } from '../contexts/AuthContext';
import { useChat } from '../contexts/ChatContext';
import ConversationList from '../components/ConversationList';
import MessageList from '../components/Chat/MessageList';
import ChatInput from '../components/Chat/ChatInput';
import styles from './Homeschool.module.css';

function HomeschoolContent() {
  const { user } = useAuth();
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
  const shouldLoadHistory = useRef(false);

  useEffect(() => {
    if (currentThreadId && user && shouldLoadHistory.current) {
      shouldLoadHistory.current = false;
      loadChatHistory(user.user_id);
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

  if (!user) return null;

  return (
    <div className={styles.container}>
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>🏠 家庭教育 AI 助手</span>
        </div>
        <div className={styles.chatWrapper}>
          <div className={`${styles.sidebar}${sidebarOpen ? ' ' + styles.sidebarOpen : ''}`}>
            <button className={styles.sidebarToggle} onClick={() => setSidebarOpen(v => !v)}>
              <span>📋 對話記錄</span><span>{sidebarOpen ? '▲' : '▼'}</span>
            </button>
            <ConversationList
              userId={user.user_id}
              type="homeschool"
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
    </div>
  );
}

export default function HomeschoolPage() {
  return (
    <WithChat chatType="homeschool">
      <HomeschoolContent />
    </WithChat>
  );
}
