import React from 'react';
import { useAuth } from './contexts/AuthContext';

function App() {
  const { isAuthenticated, membershipStatus, loading } = useAuth();

  if (loading) {
    return <div>加载中...</div>;
  }

  return (
    <div>
      {isAuthenticated ? (
        <div>
          <h1>欢迎回来！</h1>
          {membershipStatus?.membership_status?.ultimate?.is_active ? (
            <div>
              <h2>Ultimate会员专享内容</h2>
              {/* Ultimate会员可见的内容 */}
            </div>
          ) : (
            <div>
              <h2>普通会员内容</h2>
              {/* 普通会员可见的内容 */}
            </div>
          )}
        </div>
      ) : (
        <div>
          <h2>请登录查看内容</h2>
          {/* 未登录用户可见的内容 */}
        </div>
      )}
    </div>
  );
}

export default App; 