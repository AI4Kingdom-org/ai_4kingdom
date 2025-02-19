"use client";

import { useEffect, useState } from 'react';
import { useChat } from '../../contexts/ChatContext';
import { useAuth } from '../../contexts/AuthContext';
import styles from './Chat.module.css';
import ConversationList from '../ConversationList';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import { ChatType } from '../../config/chatTypes';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../../config/constants';

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
    error,
    setError,
    loadChatHistory,
    config
  } = useChat();
  const [isCreatingThread, setIsCreatingThread] = useState(false);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError('');
      }, 10000); // 3秒后自动清除错误消息

      return () => clearTimeout(timer);
    }
  }, [error, setError]);

  useEffect(() => {
    if (!authLoading && (userId || user?.user_id)) {
      setConfig({
        type,
        assistantId,
        vectorStoreId,
        userId: userId || user?.user_id
      });
    }
  }, [authLoading, user, userId, type, assistantId, vectorStoreId]);

  useEffect(() => {
    if (currentThreadId && config?.userId) {
      loadChatHistory(config.userId as string);
    }
  }, [currentThreadId, loadChatHistory, config]);

  const handleCreateNewThread = async () => {
    if (isCreatingThread || !user) return;
    
    try {
      setIsCreatingThread(true);
      
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

  const handleSendMessage = async (message: string) => {

    if (!config?.assistantId) {
      console.error('[ERROR] 缺少助手ID配置');
      setError('配置错误：缺少助手ID');
      return;
    }

    try {
      setIsCreatingThread(true);
      await sendMessage(message);
    } catch (error) {
      console.error('[ERROR] 发送消息失败:', error);
      setError(error instanceof Error ? error.message : '发送消息失败');
    } finally {
      setIsCreatingThread(false);
    }
  };

  if (authLoading) {
    return <div className={styles.loadingContainer}>
      <div className={styles.loadingText}>认证中...</div>
      <div className={styles.loadingDetails}>
        用户状态: {user ? '已登录' : '未登录'}
      </div>
    </div>;
  }

  if (!userId && !user?.user_id) {
    return <div className={styles.loginPrompt}>
      <p>请先登录</p>
      <button 
        className={styles.loginButton}
        onClick={() => window.location.href = '/login'}
      >
        去登录
      </button>
    </div>;
  }

  return (
    <div className={styles.container}>
      <ConversationList
        userId={userId || user?.user_id || ''}
        currentThreadId={currentThreadId}
        onSelectThread={setCurrentThreadId}
        type={type}
        isCreating={isCreatingThread}
        onCreateNewThread={handleCreateNewThread}
      />
      <div className={styles.chatWindow}>
        <MessageList messages={messages} isLoading={isLoading} />
        {error && <div className={styles.error}>{error}</div>}
        <ChatInput onSend={handleSendMessage} isLoading={isLoading} />
      </div>
    </div>
  );
} 