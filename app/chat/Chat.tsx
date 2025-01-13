'use client';

import { useAuth } from '../contexts/AuthContext';

export default function Chat() {
  const { user, loading, error } = useAuth();

  console.log('Chat 组件状态:', {
    isLoading: loading,
    hasError: !!error,
    hasUser: !!user,
    error: error
  });

  if (loading) {
    return <div>加载中...</div>;
  }

  if (error) {
    return <div>认证错误: {error}</div>;
  }

  if (!user) {
    return <div>请先登录</div>;
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        欢迎, {user.display_name}
      </div>
      
      {/* 聊天界面 */}
      <div className="chat-messages" style={{
        height: 'calc(100vh - 160px)',
        overflowY: 'auto',
        padding: '20px',
        backgroundColor: '#f5f5f5'
      }}>
        {/* 消息列表将在这里 */}
      </div>

      {/* 输入区域 */}
      <div className="chat-input" style={{
        padding: '20px',
        borderTop: '1px solid #eee',
        backgroundColor: '#fff'
      }}>
        <textarea 
          placeholder="输入消息..."
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '4px',
            border: '1px solid #ddd',
            minHeight: '80px'
          }}
        />
        <button style={{
          marginTop: '10px',
          padding: '8px 16px',
          backgroundColor: '#007bff',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer'
        }}>
          发送
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
