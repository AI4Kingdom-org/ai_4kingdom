'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import type { UserData } from '../types/auth';

interface AuthContextType {
  user: UserData | null;
  loading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  error: null
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function validateSession() {
      try {
        console.log('开始验证会话...');
        setLoading(true);
        setError(null);
        
        const response = await fetch('https://ai4kingdom.com/wp-json/custom/v1/validate_session', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'action=validate_session'
        });

        console.log('Response status:', response.status);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('Response data:', data);
        
        // 添加数据验证
        if (!data) {
          throw new Error('响应数据为空');
        }

        if (typeof data.success === 'undefined') {
          throw new Error('响应数据格式错误');
        }

        if (!data.success) {
          throw new Error(data.message || '认证失败');
        }

        // 确保subscription存在且格式正确
        if (!data.subscription || typeof data.subscription !== 'object') {
          data.subscription = {
            status: 'active',
            type: 'free',
            expiry: null
          };
        }

        // 验证subscription type
        if (!['free', 'ultimate', 'pro'].includes(data.subscription.type)) {
          data.subscription.type = 'free';
        }

        setUser(data);
        setError(null);
      } catch (err) {
        console.error('认证详细错误:', err);
        setUser(null);
        setError(err instanceof Error ? err.message : '认证失败');
      } finally {
        setLoading(false);
        console.log('验证流程结束');
      }
    }

    validateSession();

    // 设置定期刷新
    const interval = setInterval(validateSession, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  console.log('AuthProvider 渲染状态:', { user, loading, error });
  return (
    <AuthContext.Provider value={{ user, loading, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
} 