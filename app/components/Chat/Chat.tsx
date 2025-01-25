"use client";

import { useEffect, useState } from 'react';
import { useChat } from '../../contexts/ChatContext';
import { useAuth } from '../../contexts/AuthContext';
import styles from './Chat.module.css';
import ConversationList from '../ConversationList';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import { ChatType } from '../../config/chatTypes';

interface ChatProps {
  type: ChatType;
  assistantId: string;
  vectorStoreId: string;
  userId?: string;
}

export default function Chat({ type, assistantId, vectorStoreId, userId }: ChatProps) {
  const { user, loading: authLoading } = useAuth();
  const { 
    setConfig,
    messages,
    currentThreadId,
    setCurrentThreadId,
    sendMessage,
    isLoading,
    error 
  } = useChat();
  const [isCreatingThread, setIsCreatingThread] = useState(false);

  useEffect(() => {
    console.log('[DEBUG] Chat component mounted:', { user, authLoading });
    setConfig({
      assistantId,
      vectorStoreId,
      type
    });
  }, [assistantId, vectorStoreId, type, setConfig]);

  const handleCreateNewThread = async () => {
    if (isCreatingThread || !user) return;
    
    try {
      setIsCreatingThread(true);
      console.log('[DEBUG] 创建新对话:', { type });
      
      const response = await fetch('/api/threads/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: user.user_id,
          type: type
        })
      });

      if (!response.ok) {
        throw new Error('创建对话失败');
      }

      const data = await response.json();
      if (data.success) {
        setCurrentThreadId(data.threadId);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('refreshConversations'));
        }
      }
    } catch (err) {
      console.error('[ERROR] 创建新对话失败:', err);
    } finally {
      setIsCreatingThread(false);
    }
  };

  if (authLoading) {
    console.log('[DEBUG] Auth loading...');
    return <div className={styles.loadingContainer}>
      <div className={styles.loadingText}>认证中...</div>
      <div className={styles.loadingDetails}>
        用户状态: {user ? '已登录' : '未登录'}
      </div>
    </div>;
  }

  if (!user) {
    console.log('[DEBUG] No user found');
    return <div className={styles.loginPrompt}>
      <p>请先登录后使用</p>
      <button 
        className={styles.loginButton}
        onClick={() => window.location.href = 'https://ai4kingdom.com/login'}
      >
        去登录
      </button>
    </div>;
  }

  return (
    <div className={styles.container}>
      <ConversationList
        userId={user.user_id}
        currentThreadId={currentThreadId}
        onSelectThread={setCurrentThreadId}
        type={type}
        isCreating={isCreatingThread}
        onCreateNewThread={handleCreateNewThread}
      />
      <div className={styles.chatWindow}>
        <MessageList messages={messages} isLoading={isLoading} />
        {error && <div className={styles.error}>{error}</div>}
        <ChatInput onSend={sendMessage} isLoading={isLoading} />
      </div>
    </div>
  );
} 