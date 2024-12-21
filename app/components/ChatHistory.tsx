'use client';

import { useEffect, useState } from 'react';

interface ChatMessage {
  Message: string;
  Timestamp: string;
  UserId: string;
}

interface ParsedMessage {
  userMessage: string;
  botReply: string;
}

interface ChatHistoryProps {
  userId: string;
}

export default function ChatHistory({ userId }: ChatHistoryProps) {
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchChatHistory() {
      try {
        const response = await fetch(`/api/chat?userId=${userId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch chat history');
        }
        const data = await response.json();
        const sortedData = data.sort((a: ChatMessage, b: ChatMessage) => 
          new Date(b.Timestamp).getTime() - new Date(a.Timestamp).getTime()
        );
        setChatHistory(sortedData);
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取聊天历史失败');
      } finally {
        setLoading(false);
      }
    }

    if (userId) {
      fetchChatHistory();
    }
  }, [userId]);

  function parseMessage(messageStr: string): ParsedMessage {
    try {
      return JSON.parse(messageStr);
    } catch (e) {
      return { userMessage: '无法解析的消息', botReply: '无法解析的回复' };
    }
  }

  if (loading) return <div>加载中...</div>;
  if (error) return <div>错误: {error}</div>;

  return (
    <div className="chat-history">
      <h2>聊天历史</h2>
      <div className="messages">
        {chatHistory.map((chat, index) => {
          const { userMessage, botReply } = parseMessage(chat.Message);
          return (
            <div key={chat.Timestamp + index} className="message-pair">
              <div className="user-message">
                <strong>用户:</strong> {userMessage}
              </div>
              <div className="bot-message">
                <strong>AI:</strong> {botReply}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
} 