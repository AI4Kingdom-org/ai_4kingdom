'use client';

import { useState, useEffect } from 'react';
import styles from './ConversationList.module.css';
import { ChatType, CHAT_TYPE_CONFIGS } from '../config/chatTypes';

interface Conversation {
  threadId: string;
  createdAt: string;
  UserId: string;
  type: string;
}

interface ConversationListProps {
  userId: string;
  currentThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  type: ChatType;
  isCreating?: boolean;
  onCreateNewThread?: () => Promise<void>;
}

export default function ConversationList({ 
  userId, 
  currentThreadId,
  onSelectThread,
  type,
  isCreating = false,
  onCreateNewThread
}: ConversationListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 获取对话列表
  const fetchConversations = async () => {
    try {
      console.log('[DEBUG] 开始获取对话列表:', { 
        userId, 
        type,
        url: `/api/threads?userId=${userId}&type=${type}`
      });

      const response = await fetch(`/api/threads?userId=${userId}&type=${type}`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || '获取对话列表失败');
      }
      
      const data = await response.json();
      console.log('[DEBUG] 原始数据:', data);

      // 确保数据格式正确
      const validConversations = data.filter((conv: any) => {
        // 检查 Type 或 type 字段
        const convType = conv.Type || conv.type;
        const isValid = conv.threadId && convType === type;
        if (!isValid) {
          console.log('[DEBUG] 过滤掉无效对话:', {
            conv,
            expectedType: type,
            actualType: convType
          });
        }
        return isValid;
      });

      console.log('[DEBUG] 过滤后的对话:', {
        type,
        before: data.length,
        after: validConversations.length,
        conversations: validConversations
      });

      setConversations(validConversations.map((conv: any) => ({
        threadId: conv.threadId,
        createdAt: conv.createdAt || conv.Timestamp,
        UserId: conv.UserId,
        type: conv.Type || conv.type
      })));
      
      setError(null);
    } catch (err) {
      console.error('[ERROR] 获取对话列表失败:', err);
      setError(err instanceof Error ? err.message : '加载失败');
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  // 删除对话
  const handleDelete = async (threadId: string) => {
    try {
      const response = await fetch(`/api/threads/${threadId}`, {
        method: 'DELETE',
        headers: {
          'user-id': userId // 添加用户ID到请求头
        }
      });

      if (!response.ok) {
        throw new Error('删除对话失败');
      }

      // 刷新对话列表
      await fetchConversations();
      
    } catch (error) {
      console.error('[ERROR] 删除对话失败:', error);
      setError(error instanceof Error ? error.message : '删除失败');
    }
  };

  // 创建新对话并刷新列表
  const handleCreateNewThread = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (isCreating || !onCreateNewThread) return;
    await onCreateNewThread();
    await fetchConversations();
  };

  // 添加监听器来处理刷新事件
  useEffect(() => {
    const handleRefresh = () => {
      console.log('[DEBUG] 收到刷新对话列表事件:', { type });
      fetchConversations();
    };

    window.addEventListener('refreshConversations', handleRefresh);
    return () => window.removeEventListener('refreshConversations', handleRefresh);
  }, [type]);

  // 初始加载和依赖变化时获取对话列表
  useEffect(() => {
    if (userId && type) {
      console.log('[DEBUG] 触发获取对话列表:', { 
        userId, 
        type,
        trigger: 'dependency change' 
      });
      fetchConversations();
    }
  }, [userId, type]);

  // 在组件中可以使用配置信息
  const config = CHAT_TYPE_CONFIGS[type];

  if (loading) return <div className={styles.loading}>加载中...</div>;
  
  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.errorContainer}>
          <div className={styles.error}>{error}</div>
          <button 
            className={styles.createFirstThreadButton}
            onClick={onCreateNewThread}
          >
            <svg 
              viewBox="0 0 24 24" 
              className={styles.plusIcon}
            >
              <path fill="currentColor" d="M12 4v16m-8-8h16"/>
            </svg>
            创建第一个对话
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button
          onClick={handleCreateNewThread}
          className={styles.newChatButton}
          disabled={isCreating}
        >
          {isCreating ? '创建中...' : `+ 新建${config.title}`}
        </button>
      </div>
      
      <div className={styles.list}>
        {error ? (
          <div className={styles.error}>{error}</div>
        ) : conversations.length === 0 ? (
          <div className={styles.emptyState}>
            <p>还没有对话，开始创建一个吧！</p>
          </div>
        ) : (
          conversations.map((conv) => (
            <div 
              key={conv.threadId}
              className={`${styles.item} ${currentThreadId === conv.threadId ? styles.active : ''}`}
              onClick={() => onSelectThread(conv.threadId)}
            >
              <div className={styles.itemContent}>
                <svg 
                  className={styles.chatIcon}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                  />
                </svg>
                <span className={styles.title}>
                  对话 {new Date(conv.createdAt).toLocaleDateString()}
                </span>
              </div>
              <button
                className={styles.deleteButton}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(conv.threadId);
                }}
              >
                <svg 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  className={styles.deleteIcon}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
} 