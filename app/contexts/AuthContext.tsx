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
  subscription: {
    id: string;
    name: string;
    start_date: string;
    expiration_date: string;
  }
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
        const response = await fetch('https://ai4kingdom.com/wp-json/custom/v1/login', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                'action': 'validate_session'
            }).toString()
        });

        const data = await response.json();
        
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
            setError('会话验证失败');
        }
    } catch (err) {
        console.error('认证刷新失败:', err);
        setUserData(null);
        setError(err instanceof Error ? err.message : '认证刷新失败');
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