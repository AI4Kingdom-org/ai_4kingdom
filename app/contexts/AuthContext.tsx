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
    const validateSession = async () => {
      try {
        setLoading(true);
        console.log('开始验证会话...');
        
        const response = await fetch('https://ai4kingdom.com/wp-json/custom/v1/validate_session', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'action=validate_session'
        });

        console.log('验证响应状态:', response.status);
        
        if (!response.ok) {
          throw new Error('认证失败');
        }

        const data = await response.json();
        console.log('验证响应数据:', data);
        
        setUser(data);
      } catch (err) {
        console.error('验证错误:', err);
        setError(err instanceof Error ? err.message : '认证失败');
      } finally {
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