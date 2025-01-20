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
        <h2 className={styles.title}>对话列表</h2>
        <button
          onClick={handleCreateNewThread}
          className={styles.newChatButton}
          disabled={isCreating}
        >
          {isCreating ? '创建中...' : '新对话'}
        </button>
      </div>
      
      <div className={styles.list}>
        {error ? (
          <div className={styles.error}>{error}</div>
        ) : conversations.length === 0 ? (
          <div className={styles.emptyState}>
            <svg 
              viewBox="0 0 24 24" 
              className={styles.emptyIcon}
            >
              <path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM9 11H7V9h2v2zm4 0h-2V9h2v2zm4 0h-2V9h2v2z"/>
            </svg>
            <h3 className={styles.emptyTitle}>开始您的第一个对话</h3>
            <p className={styles.emptyText}>
              点击上方"新对话"按钮，开始与 AI 助手交流
            </p>
          </div>
        ) : (
          conversations.map((conv) => (
            <div 
              key={conv.threadId}
              className={`${styles.item} ${currentThreadId === conv.threadId ? styles.active : ''}`}
              onClick={() => onSelectThread(conv.threadId)}
            >
              <span className={styles.title}>
                <svg 
                  viewBox="0 0 24 24" 
                  className={styles.chatIcon}
                >
                  <path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                </svg>
                对话 {conv.threadId.substring(0, 8)}
              </span>
              <button
                className={styles.deleteButton}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(conv.threadId);
                }}
              >
                <svg 
                  viewBox="0 0 24 24" 
                  className={styles.deleteIcon}
                >
                  <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
} 