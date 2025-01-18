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
  onCreateNewThread: () => void;
}

export default function ConversationList({ 
  userId, 
  currentThreadId,
  onSelectThread,
  onCreateNewThread 
}: ConversationListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 获取所有对话
  const fetchConversations = async () => {
    try {
      const response = await fetch(`/api/threads?userId=${userId}`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('获取对话列表失败');
      }
      
      const data = await response.json();
      setConversations(data || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  // 删除对话
  const handleDeleteThread = async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // 防止触发选择事件
    
    try {
      const response = await fetch(`/api/threads/${threadId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId })
      });

      if (!response.ok) {
        throw new Error('删除对话失败');
      }

      // 刷新对话列表
      fetchConversations();
      
      // 如果删除的是当前对话，创建新对话
      if (threadId === currentThreadId) {
        onCreateNewThread();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  useEffect(() => {
    if (userId) {
      fetchConversations();
    }
  }, [userId]);

  if (loading) return <div className={styles.loading}>加载中...</div>;
  if (error) return <div className={styles.error}>{error}</div>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button 
          className={styles.newChatButton}
          onClick={onCreateNewThread}
        >
          <svg 
            viewBox="0 0 24 24" 
            className={styles.plusIcon}
          >
            <path fill="currentColor" d="M12 4v16m-8-8h16"/>
          </svg>
          新对话
        </button>
      </div>
      
      <div className={styles.list}>
        {conversations.length === 0 ? (
          <div className={styles.emptyState}>
            还没有对话记录，点击上方按钮开始新对话
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
                onClick={(e) => handleDeleteThread(conv.threadId, e)}
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