'use client';

import { useState, useEffect } from 'react';
import styles from './ConversationList.module.css';

interface Conversation {
  threadId: string;
  createdAt: string;
  UserId: string;
}

interface ConversationListProps {
  userId: string;
  currentThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onCreateNewThread: () => Promise<void>;
  isCreating: boolean;
}

export default function ConversationList({ 
  userId, 
  currentThreadId,
  onSelectThread,
  onCreateNewThread,
  isCreating
}: ConversationListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 获取对话列表
  const fetchConversations = async () => {
    try {
      console.log('[DEBUG] 开始获取对话列表');
      const response = await fetch(`/api/threads?userId=${userId}`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('获取对话列表失败');
      }
      
      const data = await response.json();
      console.log('[DEBUG] 获取到的对话列表:', data);
      setConversations(data || []);
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
          'Content-Type': 'application/json',
          'user-id': userId  // 添加用户ID到请求头
        }
      });

      if (!response.ok) {
        throw new Error('删除对话失败');
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || '删除对话失败');
      }

      // 删除成功后刷新对话列表
      fetchConversations();
      
      // 如果删除的是当前对话，创建新对话
      if (threadId === currentThreadId) {
        await onCreateNewThread();
      }
    } catch (error) {
      console.error('[ERROR] 删除对话失败:', error);
      setError(error instanceof Error ? error.message : '删除失败');
    }
  };

  // 创建新对话并刷新列表
  const handleCreateNewThread = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (isCreating) return;
    await onCreateNewThread();
    await fetchConversations(); // 创建完成后刷新列表
  };

  // 初始加载和用户ID变化时获取对话列表
  useEffect(() => {
    if (userId) {
      fetchConversations();
    }
  }, [userId]);

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
          {isCreating ? '创建中...' : '+ 新对话'}
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