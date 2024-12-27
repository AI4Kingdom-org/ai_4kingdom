'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface Subscription {
  id: string;
  name: string;
  start_date: string;
  expiration_date: string;
}

interface MembershipStatus {
  status: string;
  message: string;
  subscription: Subscription;
}

interface LoginResponse {
  success: boolean;
  user_id: number;
  email: string;
  display_name: string;
  membership: MembershipStatus;
}

interface UserData {
  ID: number;
  email: string;
  display_name: string;
  subscription: {
    level: string;
    status: string;
    api_calls: {
      today: number;
      limit: number;
      remaining: number;
    }
  }
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

  const login = async (username: string, password: string) => {
    try {
      const formData = new URLSearchParams();
      formData.append('username', username);
      formData.append('password', password);

      const response = await fetch('https://ai4kingdom.com/wp-json/custom/v1/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData.toString()
      });

      const data: LoginResponse = await response.json();
      
      if (!data.success) {
        throw new Error('登录失败');
      }

      const userData: UserData = {
        ID: data.user_id,
        email: data.email,
        display_name: data.display_name,
        subscription: {
          level: data.membership.subscription.name,
          status: data.membership.status,
          api_calls: {
            today: 0,
            limit: data.membership.subscription.name === 'free' ? 10 : 100,
            remaining: data.membership.subscription.name === 'free' ? 10 : 100
          }
        }
      };

      setUserData(userData);
      setError(null);
      setLoading(false);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
      setUserData(null);
      setLoading(false);
    }
  };

  const canCallApi = () => {
    if (!userData?.subscription) return false;
    
    const { remaining } = userData.subscription.api_calls;
    return remaining === -1 || remaining > 0;
  };

  const refreshAuth = async () => {
    try {
        // 从 cookie 中获取用户名，需要处理 URL 编码的 cookie
        const cookies = decodeURIComponent(document.cookie).split(';');
        console.log('解码后的 cookies:', cookies);
        
        const usernameCookie = cookies.find(c => 
            c.trim().startsWith('wordpress_logged_in_') || 
            c.trim().includes('freeaccount|')
        );
        
        console.log('找到的用户 cookie:', usernameCookie);
        
        if (!usernameCookie) {
            console.log('未找到用户 cookie');
            setUserData(null);
            setError('未找到登录信息');
            return;
        }

        // 提取用户名 - 处理两种可能的格式
        let username;
        if (usernameCookie.includes('=')) {
            username = usernameCookie.split('|')[0].split('=')[1].trim();
        } else {
            username = usernameCookie.split('|')[0].trim();
        }
        
        console.log('提取的用户名:', username);

        // 构建表单数据
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('action', 'validate_session');

        console.log('发送请求的表单数据:', formData.toString());

        const response = await fetch('https://ai4kingdom.com/wp-json/custom/v1/login', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: formData.toString()
        });

        console.log('响应状态:', response.status);
        
        if (!response.ok) {
            throw new Error(`刷新认证状态失败: ${response.status}`);
        }

        const data: LoginResponse = await response.json();
        console.log('响应数据:', data);

        if (data.success) {
            const userData: UserData = {
                ID: data.user_id,
                email: data.email,
                display_name: data.display_name,
                subscription: {
                    level: data.membership.subscription.name,
                    status: data.membership.status,
                    api_calls: {
                        today: 0,
                        limit: data.membership.subscription.name === 'free' ? 10 : 100,
                        remaining: data.membership.subscription.name === 'free' ? 10 : 100
                    }
                }
            };
            setUserData(userData);
            setError(null);
        } else {
            setUserData(null);
            setError('未找到用户信息');
        }
    } catch (err) {
        console.error('认证刷新错误:', err);
        setError(err instanceof Error ? err.message : '刷新认证状态失败');
        setUserData(null);
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    console.log('初始化认证状态检查');
    console.log('原始 cookie:', document.cookie);
    console.log('解码后的 cookie:', decodeURIComponent(document.cookie));
    refreshAuth();
  }, []);

  return (
    <AuthContext.Provider value={{ 
      userData, 
      loading, 
      error,
      login,
      canCallApi,
      refreshAuth
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