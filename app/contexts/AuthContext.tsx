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
      try {
        setLoading(true);
        console.log('开始验证会话...');
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch('https://ai4kingdom.com/wp-json/custom/v1/validate_session', {
          method: 'POST',
          credentials: 'include',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            'Origin': 'https://ai4kingdom.com'
          },
          body: 'action=validate_session'
        });

        clearTimeout(timeoutId);

        console.log('验证请求完成:', {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          url: response.url
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('验证响应数据:', data);
        
        setUser(data);
        setLoading(false);
      } catch (err: unknown) {
        console.error('验证错误:', {
          name: err instanceof Error ? err.name : 'UnknownError',
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : 'No stack trace'
        });
        setError(err instanceof Error ? err.message : '认证失败');
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