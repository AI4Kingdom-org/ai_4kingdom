'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface Subscription {
  level: string;
  status: string;
  expiration: string | null;
  api_calls: {
    today: number;
    limit: number;
    remaining: number;
  };
}

interface UserData {
  ID: string;
  user_email: string;
  subscription: Subscription;
}

interface AuthContextType {
  userData: UserData | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  canCallApi: () => boolean;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkSubscription = async () => {
    try {
      const response = await fetch('https://your-wordpress-site.com/wp-json/custom/v1/user-subscription', {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jwt_token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Subscription check failed');
      }

      const data = await response.json();
      setUserData(data);
      
      // 检查订阅是否过期
      if (data.subscription.status === 'expired') {
        setError('您的订阅已过期，请续订以继续使用服务');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取订阅信息失败');
      setUserData(null);
    } finally {
      setLoading(false);
    }
  };

  // 登录函数
  const login = async (username: string, password: string) => {
    try {
      const response = await fetch('https://your-wordpress-site.com/wp-json/jwt-auth/v1/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message);
      }

      localStorage.setItem('jwt_token', data.token);
      await checkSubscription();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    }
  };

  // 检查是否可以调用 API
  const canCallApi = () => {
    if (!userData?.subscription) return false;
    
    const { remaining } = userData.subscription.api_calls;
    return remaining === -1 || remaining > 0;
  };

  useEffect(() => {
    const token = localStorage.getItem('jwt_token');
    if (token) {
      checkSubscription();
    } else {
      setLoading(false);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ 
      userData, 
      loading, 
      error,
      login,
      canCallApi,
      refreshAuth: checkSubscription 
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 