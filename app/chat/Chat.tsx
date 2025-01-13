'use client';

import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect, useRef } from 'react';
import styles from './Chat.module.css';

interface ChatItem {
    Message: string;
    Timestamp: string;
    UserId: string;
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

export default function Chat() {
  const { user, loading, error: authError } = useAuth();
  const [messages, setMessages] = useState<{ sender: string; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [weeklyUsage, setWeeklyUsage] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const parseHistoryMessage = (messageStr: string) => {
    try {
      const parsed = JSON.parse(messageStr);
      if (!parsed.userMessage || !parsed.botReply) {
        console.error('Invalid message format:', messageStr);
        return [];
      }
      return [
        { sender: 'user', text: parsed.userMessage },
        { sender: 'bot', text: parsed.botReply }
      ];
    } catch (e) {
      console.error('Failed to parse message:', e);
      return [];
    }
  };

  useEffect(() => {
    async function fetchHistory() {
      if (!user) return;
      
      try {
        const response = await fetch(`/api/chat?userId=${user.user_id}`, {
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          throw new Error(`获取聊天历史失败: ${response.status}`);
        }
        
        const data = await response.json();
        const allMessages = data.flatMap((item: ChatItem) => 
          parseHistoryMessage(item.Message)
        );
        setMessages(allMessages);
        scrollToBottom();
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      }
    }

    if (user) {
      fetchHistory();
    }
  }, [user]);

  const sendMessage = async () => {
    if (!input.trim() || !user) return;
    
    setIsLoading(true);
    const currentInput = input;
    setInput('');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          userId: user.user_id,
          message: currentInput 
        })
      });

      if (!response.ok) {
        throw new Error(await response.text() || '发送失败');
      }

      const data = await response.json();
      setMessages(prev => [...prev, 
        { sender: 'user', text: currentInput },
        { sender: 'bot', text: data.reply }
      ]);
      
      setWeeklyUsage(prev => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setIsLoading(false);
      scrollToBottom();
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
    <div className={styles.chatWindow}>
      <div className={styles.messages}>
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`${styles.message} ${msg.sender === 'user' ? styles.user : styles.bot}`}
          >
            {msg.sender === 'bot' && (
              <img 
                src="https://logos-world.net/wp-content/uploads/2023/02/ChatGPT-Logo.png"
                alt="AI Avatar" 
                className={styles.avatar}
              />
            )}
            <div className={styles.messageContent}>
              {msg.text}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.inputArea}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !isLoading && sendMessage()}
          placeholder="输入消息..."
          className={styles.inputField}
          disabled={isLoading}
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || isLoading}
          className={styles.sendButton}
        >
          {isLoading ? '发送中...' : '发送'}
        </button>
      </div>
    </div>
  );
}
