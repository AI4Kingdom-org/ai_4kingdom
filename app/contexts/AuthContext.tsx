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
    console.log('AuthContext useEffect 触发');
    const validateSession = async () => {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('请求超时')), 10000);
      });

      try {
        setLoading(true);
        console.log('开始验证会话...');
        
        const response = await Promise.race([
          fetch('https://ai4kingdom.com/wp-json/custom/v1/validate_session', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest',
              'Origin': 'https://ai4kingdom.com',
              'Referer': 'https://ai4kingdom.com'
            },
            body: 'action=validate_session'
          }),
          timeoutPromise
        ]) as Response;

        console.log('验证响应状态:', response.status);
        console.log('验证响应头:', Object.fromEntries(response.headers.entries()));
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('验证响应数据:', data);
        
        setUser(data);
      } catch (err) {
        console.error('验证错误:', {
          message: err instanceof Error ? err.message : '未知错误',
          type: err instanceof Error ? err.name : typeof err,
          stack: err instanceof Error ? err.stack : undefined
        });
        setError(err instanceof Error ? err.message : '认证失败');
      } finally {
        console.log('验证流程结束');
        setLoading(false);
      }
    };

    validateSession();
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