'use client';

import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect, useRef } from 'react';
import styles from './Chat.module.css';
import ConversationList from '../components/ConversationList';
import { updateUserActiveThread } from '../utils/dynamodb';
import OpenAI from 'openai';

export interface ChatMessage {
  Message: string;
  Timestamp: string;
  UserId: string;
}

export interface ParsedMessage {
  userMessage: string;
  botReply: string;
}

interface UsageLimit {
    [key: string]: number;
    free: number;
    pro: number;
    ultimate: number;
}

const WEEKLY_LIMITS: UsageLimit = {
    free: 10,
    pro: 100,
    ultimate: Infinity
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  dangerouslyAllowBrowser: true
});

export default function Chat() {
  const { user, loading, error: authError } = useAuth();
  const [messages, setMessages] = useState<{ sender: string; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [weeklyUsage, setWeeklyUsage] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const parseHistoryMessage = (messageStr: string) => {
    try {
      const parsed = JSON.parse(messageStr);
      const messages = [];
      
      if (parsed.userMessage?.trim()) {
        messages.push({ sender: 'user', text: parsed.userMessage.trim() });
      }
      if (parsed.botReply?.trim()) {
        messages.push({ sender: 'bot', text: parsed.botReply.trim() });
      }
      
      return messages;
    } catch (e) {
      console.error('[ERROR] 解析消息失败:', e);
      return [];
    }
  };

  const fetchHistory = async (threadId?: string) => {
    if (!threadId) {
      setMessages([]);
      return;
    }
    
    setIsFetchingHistory(true);
    setError('');
    
    try {
      console.log('[DEBUG] 开始获取历史记录:', { threadId });
      
      const messages = await openai.beta.threads.messages.list(threadId);
      
      const formattedMessages = messages.data
        .map(message => ({
          sender: message.role === 'user' ? 'user' : 'bot',
          text: message.content
            .filter(content => content.type === 'text')
            .map(content => (content.type === 'text' ? content.text.value : ''))
            .join('\n')
        }))
        .reverse();

      console.log('[DEBUG] 获取到的消息数量:', formattedMessages.length);
      setMessages(formattedMessages);
      scrollToBottom();

    } catch (err) {
      console.error('[ERROR] 获取历史记录失败:', err);
      setError(err instanceof Error ? err.message : '获取历史记录失败');
      setMessages([]);
    } finally {
      setIsFetchingHistory(false);
    }
  };

  useEffect(() => {
    if (user && !currentThreadId) {
      console.log('[DEBUG] 初始化加载');
      setMessages([]);
    }
  }, [user]);

  const sendMessage = async () => {
    if (!input.trim() || !user || isLoading) return;
    
    console.log('[DEBUG] 准备发送消息:', {
      threadId: currentThreadId,
      messageLength: input.length,
      userId: user.user_id
    });
    
    setIsLoading(true);
    const currentInput = input;
    setInput('');
    setError('');

    try {
      if (!currentThreadId) {
        console.log('[DEBUG] 没有当前对话，创建新对话');
        const newThread = await openai.beta.threads.create();
        console.log('[DEBUG] 创建新对话成功:', { threadId: newThread.id });
        setCurrentThreadId(newThread.id);
      }

      // 添加用户消息到界面
      setMessages(prev => [...prev, { sender: 'user', text: currentInput }]);
      scrollToBottom();

      console.log('[DEBUG] 发送消息到API:', {
        threadId: currentThreadId,
        userId: user.user_id
      });

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: user.user_id,
          message: currentInput,
          threadId: currentThreadId
        })
      });

      if (!response.ok) {
        throw new Error(response.status === 504 ? '请求超时' : '发送失败');
      }

      const data = await response.json();
      console.log('[DEBUG] API响应:', {
        success: true,
        threadId: data.threadId,
        hasReply: !!data.reply
      });

      if (data.error) {
        throw new Error(data.error);
      }

      // 获取最新的消息历史
      if (data.threadId) {
        await fetchHistory(data.threadId);
      }

    } catch (err) {
      console.error('[ERROR] 发送消息失败:', {
        error: err instanceof Error ? err.message : '发送失败',
        threadId: currentThreadId
      });
      setInput(currentInput);
      setError(err instanceof Error ? err.message : '发送失败');
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectThread = async (threadId: string) => {
    try {
      if (threadId === currentThreadId) {
        return;
      }

      console.log('[DEBUG] 切换对话:', {
        from: currentThreadId || 'none',
        to: threadId
      });

      setIsLoading(true);
      setMessages([]);
      setError('');
      
      setCurrentThreadId(threadId);
      await fetchHistory(threadId);

    } catch (err) {
      console.error('[ERROR] 切换对话失败:', err);
      setError(err instanceof Error ? err.message : '切换对话失败');
      setCurrentThreadId(currentThreadId);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateNewThread = async () => {
    if (isCreatingThread) return;
    
    try {
      setIsCreatingThread(true);
      setIsLoading(true);
      setError('');
      
      const newThread = await openai.beta.threads.create();
      console.log('[DEBUG] 创建新线程:', { threadId: newThread.id });
      
      setCurrentThreadId(newThread.id);
      setMessages([]);
      
      if (user?.user_id) {
        await updateUserActiveThread(user.user_id, newThread.id);
      }

    } catch (err) {
      console.error('[ERROR] 创建新对话失败:', err);
      setError(err instanceof Error ? err.message : '创建新对话失败');
    } finally {
      setIsCreatingThread(false);
      setIsLoading(false);
    }
  };

  if (loading) return <div>加载中...</div>;
  if (error) return <div>认证错误: {error}</div>;
  if (!user) return (
    <div className={styles.loginPrompt}>
      <p>请先登录后使用</p>
      <button 
        className={styles.loginButton}
        onClick={() => window.open('https://ai4kingdom.com/login', '_blank')}
      >
        去登录
      </button>
    </div>
  );

  return (
    <div className={styles.container}>
      {user && (
        <div className={styles.conversationListContainer}>
          <ConversationList
            userId={user.user_id}
            currentThreadId={currentThreadId}
            onSelectThread={handleSelectThread}
            onCreateNewThread={handleCreateNewThread}
            isCreating={isCreatingThread}
          />
        </div>
      )}
      <div className={styles.chatWindow}>
        {isFetchingHistory ? (
          <div className={styles.loading}>加载历史记录中...</div>
        ) : (
          <div className={styles.messagesWrapper}>
            <div className={styles.messageContainer}>
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`${styles.message} ${
                    message.sender === 'user' ? styles.userMessage : styles.botMessage
                  }`}
                >
                  {message.sender === 'bot' && (
                    <div className={`${styles.avatar} ${styles.botAvatar}`}>
                      AI
                    </div>
                  )}
                  <div className={styles.messageContent}>
                    {message.text}
                  </div>
                  {message.sender === 'user' && (
                    <div className={`${styles.avatar} ${styles.userAvatar}`}>
                      U
                    </div>
                  )}
                </div>
              ))}
              {isLoading && (
                <div className={`${styles.message} ${styles.botMessage}`}>
                  <div className={`${styles.avatar} ${styles.botAvatar}`}>
                    AI
                  </div>
                  <div className={styles.messageContent}>
                    <span className={styles.typing}>AI正在思考...</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.inputArea}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isLoading && sendMessage()}
            placeholder={isLoading ? "发送中..." : "输入消息..."}
            className={styles.inputField}
            disabled={isLoading || isFetchingHistory}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading || isFetchingHistory}
            className={styles.sendButton}
          >
            {isLoading ? '发送中...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
}