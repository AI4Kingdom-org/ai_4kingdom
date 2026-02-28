"use client";

import { useEffect, useState } from 'react';
import { useChat } from '../../contexts/ChatContext';
import { useAuth } from '../../contexts/AuthContext';
import { useCredit } from '../../contexts/CreditContext';
import styles from './Chat.module.css';
import { Rnd } from 'react-rnd';
import ConversationList from '../ConversationList';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import { ChatType } from '../../config/chatTypes';

interface ChatProps {
  type: ChatType;
  assistantId: string;
  vectorStoreId: string;
  userId?: string;
  threadId?: string | null;
}

export default function Chat({ type, assistantId, vectorStoreId, userId, threadId }: ChatProps) {
  const { user, loading: authLoading } = useAuth();
  const { refreshUsage } = useCredit(); // 引入信用點數更新函數
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
    config,
    setMessages,
  } = useChat();

  const [isCreatingThread, setIsCreatingThread] = useState(false);

  // Log props for debugging
  useEffect(() => {
    console.log('[DEBUG] Chat组件初始化:', {
      type,
      assistantId,
      vectorStoreId,
      userId: userId || (user?.user_id || '未登录'),
      threadId: threadId || '无',
      currentThreadId: currentThreadId || '无',
      configStatus: config ? '已配置' : '未配置',
      errorStatus: error || '无错误',
      时间戳: new Date().toISOString()
    });
  }, [type, assistantId, vectorStoreId, userId, user, threadId, currentThreadId, config, error]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(''), 10000);
      return () => clearTimeout(timer);
    }
  }, [error, setError]);

  useEffect(() => {
    if (!authLoading && (userId || user?.user_id)) {
      // 验证assistantId是否有效
      if (!assistantId || typeof assistantId !== 'string') {
        console.error('[ERROR] Chat组件收到无效的assistantId:', {
          assistantId,
          type: typeof assistantId,
          时间戳: new Date().toISOString()
        });
        setError('无效的助手ID');
        return;
      }
      
      console.log('[DEBUG] 设置Chat配置:', {
        type,
        assistantId,
        vectorStoreId: vectorStoreId || '未提供',
        userId: userId || user?.user_id,
        时间戳: new Date().toISOString()
      });
      
      setConfig({ type, assistantId, vectorStoreId, userId: userId || user?.user_id });
    }
  }, [authLoading, user, userId, type, assistantId, vectorStoreId, setConfig]);

  // 🔴 如果 prop 傳入了 threadId，使用它而不是創建新的
  useEffect(() => {
    if (threadId && threadId !== currentThreadId) {
      console.log('[DEBUG] 使用 prop 傳入的 threadId:', threadId);
      setCurrentThreadId(threadId);
    }
  }, [threadId, currentThreadId, setCurrentThreadId]);

  useEffect(() => {
    if (currentThreadId && config?.userId) {
      loadChatHistory(config.userId as string);
    }
  }, [currentThreadId, loadChatHistory, config]);

  // 自動創建新對話（只有在沒有 prop threadId 時才創建）
  useEffect(() => {
    if (!currentThreadId && !isCreatingThread && user && !threadId) {
      console.log('[DEBUG] 沒有 threadId，自動創建新對話');
      handleCreateNewThread();
    }
  }, [currentThreadId, isCreatingThread, user, threadId]);

  const handleCreateNewThread = async () => {
    if (isCreatingThread || !user) return;

    try {
      setIsCreatingThread(true);
      const response = await fetch('/api/threads/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.user_id, type }),
      });

      if (!response.ok) throw new Error('创建对话失败');
      const data = await response.json();

      if (data.success) {
        setCurrentThreadId(data.threadId);
        setMessages([]); // 清空訊息
        window.dispatchEvent(new CustomEvent('refreshConversations'));
      }
    } catch (err) {
      console.error('[ERROR]', err);
    } finally {
      setIsCreatingThread(false);
    }
  };

  const handleSendMessage = async (message: string) => {
    // 验证助手ID是否有效
    if (!config?.assistantId) {
      console.error('[ERROR] 发送消息前缺少assistantId:', {
        config,
        userId: userId || user?.user_id,
        时间戳: new Date().toISOString()
      });
      setError('缺少助手ID配置');
      return;
    }

    // 验证vectorStoreId是否存在
    if (!config?.vectorStoreId) {
      console.warn('[WARN] 发送消息前缺少vectorStoreId', {
        assistantId: config.assistantId,
        时间戳: new Date().toISOString()
      });
      // 仍然可以继续，只是没有知识库
    }

    // 確認 userId 是否存在
    if (!config?.userId) {
      console.error('[ERROR] 发送消息前缺少userId:', {
        config,
        userId: userId || user?.user_id,
        时间戳: new Date().toISOString()
      });
      setError('缺少用户ID配置');
      return;
    }

    try {
      console.log('[DEBUG] 开始发送消息:', {
        message: message.substring(0, 20) + (message.length > 20 ? '...' : ''),
        assistantId: config.assistantId,
        vectorStoreId: config.vectorStoreId,
        userId: config.userId,
        threadId: currentThreadId || '新对话',
        时间戳: new Date().toISOString()
      });
      
      await sendMessage(message);
      // 新增：強制刷新對話列表
      window.dispatchEvent(new CustomEvent('refreshConversations'));
      
      console.log('[DEBUG] 消息发送成功');
      
      try {
        // 消息發送成功后，立即刷新信用點數使用量
        // 1. 通過 refreshUsage 函數直接刷新
        await refreshUsage();
        
        // 2. 同時觸發全局事件，確保所有訂閱該事件的組件都能刷新
        window.dispatchEvent(new CustomEvent('refreshCredits'));
      } catch (creditError) {
        console.warn('[WARN] 刷新信用点数失败，但消息已成功发送:', creditError);
        // 這裡不顯示錯誤給用戶，因為消息已經成功發送
      }
    } catch (error) {
      console.error('[ERROR] 发送消息失败:', {
        error,
        message: error instanceof Error ? error.message : '未知错误',
        assistantId: config.assistantId,
        vectorStoreId: config.vectorStoreId || '未提供',
        userId: config.userId || '未提供',
        时间戳: new Date().toISOString()
      });
      
      // 提供更詳細的錯誤信息
      if (error instanceof Error) {
        if (error.message.includes('token') || error.message.includes('credit')) {
          setError('信用点数不足，发送消息失败');
        } else if (error.message.includes('network') || error.message.includes('timeout')) {
          setError('网络连接问题，发送消息失败');
        } else {
          setError(`发送消息失败: ${error.message}`);
        }
      } else {
        setError('发送消息失败，请稍后重试');
      }
    }
  };

  if (authLoading) {
    return <div className={styles.loadingContainer}>认证中...</div>;
  }

  // 處理點擊 thread 切換對話
  const handleSelectThread = async (threadId: string) => {
    try {
      if (threadId === currentThreadId) return;
      setError('');
      setMessages([]);
      setCurrentThreadId(threadId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '切換對話失敗');
    }
  };

  return (
    <div className={styles.container}>
      {userId || user?.user_id ? (
        <>
          {/* 聊天歷史側邊欄 */}
          <div className={styles.conversationListContainer}>
            <ConversationList
              userId={String(userId || user?.user_id)}
              type={type}
              currentThreadId={currentThreadId}
              onSelectThread={handleSelectThread}
              isCreating={isCreatingThread}
              onCreateNewThread={handleCreateNewThread}
            />
          </div>
          {/* 聊天主視窗 */}
          <div className={styles.chatWindow}>
            {!assistantId || typeof assistantId !== 'string' ? (
              <div className={styles.error}>
                <p>错误: 无效的助手ID</p>
                <p>请尝试刷新页面或联系管理员</p>
              </div>
            ) : (
              <>
                <MessageList messages={messages} isLoading={isLoading} />
                {error && <div className={styles.error}>{error}</div>}
                <ChatInput onSend={handleSendMessage} isLoading={isLoading} />
              </>
            )}
          </div>
        </>
      ) : (
        <div className={styles.loginPrompt}>
          <button className={styles.loginButton} onClick={() => (window.location.href = '/login')}>
            去登录
          </button>
        </div>
      )}
    </div>
  );
}
