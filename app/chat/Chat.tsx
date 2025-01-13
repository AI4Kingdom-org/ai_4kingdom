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
    <div>
      {/* Chat UI */}
      <div>欢迎, {user.display_name}</div>
    </div>
  );
}
