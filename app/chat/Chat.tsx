'use client';

import { useAuth } from '../contexts/AuthContext';
import { useState } from 'react';
import ChatHistory from '../components/ChatHistory';

export default function Chat() {
  const { user, loading, error } = useAuth();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSendMessage() {
    if (!message.trim() || !user) return;
    
    try {
      setSending(true);
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.user_id,
          message: message.trim()
        })
      });

      if (!response.ok) {
        throw new Error('发送失败');
      }

      setMessage(''); // 清空输入
    } catch (err) {
      console.error('发送消息失败:', err);
    } finally {
      setSending(false);
    }
  }

  if (loading) return <div>加载中...</div>;
  if (error) return <div>认证错误: {error}</div>;
  if (!user) return <div>请先登录</div>;

  return (
    <div className="chat-container">
      <div className="chat-header">
        欢迎, {user.display_name}
      </div>
      
      {/* 聊天历史 */}
      <div className="chat-messages" style={{
        height: 'calc(100vh - 160px)',
        overflowY: 'auto',
        padding: '20px',
        backgroundColor: '#f5f5f5'
      }}>
        <ChatHistory userId={String(user.user_id)} />
      </div>

      {/* 输入区域 */}
      <div className="chat-input" style={{
        padding: '20px',
        borderTop: '1px solid #eee',
        backgroundColor: '#fff'
      }}>
        <textarea 
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="输入消息..."
          disabled={sending}
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '4px',
            border: '1px solid #ddd',
            minHeight: '80px'
          }}
        />
        <button 
          onClick={handleSendMessage}
          disabled={sending || !message.trim()}
          style={{
            marginTop: '10px',
            padding: '8px 16px',
            backgroundColor: sending ? '#ccc' : '#007bff',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: sending ? 'not-allowed' : 'pointer'
          }}
        >
          {sending ? '发送中...' : '发送'}
        </button>
      </div>

      {/* 调试信息（可选） */}
      {process.env.NODE_ENV === 'development' && (
        <pre style={{ display: 'none' }}>
          {JSON.stringify({
            user: user,
            timestamp: new Date().toISOString()
          }, null, 2)}
        </pre>
      )}
    </div>
  );
}
