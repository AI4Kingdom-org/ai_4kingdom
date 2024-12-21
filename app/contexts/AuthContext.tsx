'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface MembershipStatus {
  ultimate?: {
    id: string;
    is_active: boolean;
    status: string;
    start_date: string;
    expiration_date: string;
  };
}

interface WordPressMembership {
  user_id: string;
  membership_status: MembershipStatus;
  has_active_membership: boolean;
  timestamp: string;
}

interface UserData {
  ID: string;
  membershipType: 'free' | 'pro' | 'ultimate';
  user_email: string;
  display_name: string;
}

interface AuthContextType {
  userData: UserData | null;
  loading: boolean;
  refreshAuth: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 3;
  const [error, setError] = useState<string | null>(null);

  const checkMembership = async (isRetry = false) => {
    try {
      console.log('检查会员状态，重试次数:', retryCount);
      
      // 获取 nonce
      const nonceResponse = await fetch('https://ai4kingdom.com/wp-json/custom/v1/get-nonce', {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        },
        mode: 'cors'
      });

      if (!nonceResponse.ok) {
        throw new Error('获取 nonce 失败');
      }

      const { nonce } = await nonceResponse.json();

      const response = await fetch('https://ai4kingdom.com/wp-json/custom/v1/check-membership', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-WP-Nonce': nonce
        },
        mode: 'cors'
      });

      if (response.status === 401 && !isRetry && retryCount < MAX_RETRIES) {
        console.log('认证失败，尝试重试...');
        setRetryCount(prev => prev + 1);
        // 等待1秒后重试
        await new Promise(resolve => setTimeout(resolve, 1000));
        return checkMembership(true);
      }

      const responseText = await response.text();
      console.log('会员检查原始响���:', responseText);
      
      try {
        const data = JSON.parse(responseText) as WordPressMembership;
        console.log('会员数据:', data);
        
        if (data.has_active_membership && data.membership_status.ultimate?.is_active) {
          setUserData({
            ID: data.user_id,
            membershipType: 'ultimate',
            user_email: '',
            display_name: ''
          });
        } else {
          setUserData({
            ID: data.user_id,
            membershipType: 'free',
            user_email: '',
            display_name: ''
          });
        }
      } catch (parseError) {
        console.error('解析响应数据失败:', parseError);
      }
    } catch (error) {
      console.error('获取会员信息失败:', error);
      
      if (!isRetry && retryCount < MAX_RETRIES) {
        setRetryCount(prev => prev + 1);
        // 等待1秒后重试
        await new Promise(resolve => setTimeout(resolve, 1000));
        return checkMembership(true);
      }
      
      setUserData(null);
    } finally {
      if (isRetry || retryCount >= MAX_RETRIES) {
        setLoading(false);
      }
    }
  };

  // 添加路由变化监听
  useEffect(() => {
    const handleRouteChange = () => {
      setRetryCount(0); // 重置重试次数
      checkMembership();
    };

    // 监听路由变化
    window.addEventListener('popstate', handleRouteChange);
    
    // 初始检查
    checkMembership();

    return () => {
      window.removeEventListener('popstate', handleRouteChange);
    };
  }, []);

  const refreshAuth = async () => {
    setLoading(true);
    setError(null);
    try {
      await checkMembership();
    } catch (err) {
      setError(err instanceof Error ? err.message : '认证刷新失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ userData, loading, refreshAuth, error }}>
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