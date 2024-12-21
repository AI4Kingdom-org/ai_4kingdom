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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkMembership = async () => {
      try {
        const response = await fetch('https://ai4kingdom.com/wp-json/custom/v1/check-membership', {
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Origin': 'https://main.d3ts7h8kta7yzt.amplifyapp.com'
          },
          mode: 'cors'
        });
        
        if (response.status === 401) {
          console.error('认证失败:', await response.text());
          // 不要立即重定向，而是先检查 cookie
          const cookies = document.cookie;
          if (!cookies.includes('wordpress_logged_in_')) {
            console.log('WordPress cookie 未找到，需要登录');
            window.location.href = 'https://ai4kingdom.com/login';
            return;
          }
          // 如果有 cookie 但认证失败，可能是其他问题
          console.log('有 WordPress cookie 但认证失败');
          return;
        }
        
        if (response.ok) {
          const data: WordPressMembership = await response.json();
          console.log('会员状态:', data);
          
          if (data.has_active_membership && data.membership_status.ultimate?.is_active) {
            setUserData(prevData => ({
              ...prevData,
              ID: data.user_id,
              membershipType: 'ultimate'
            } as UserData));
          }
        }
      } catch (error) {
        console.error('获取会员信息失败:', error);
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.origin === 'https://ai4kingdom.com') {
        if (event.data.type === 'USER_DATA') {
          setUserData(prev => ({
            ...event.data.data,
            membershipType: 'free' // 默认为免费用户，等待会员检查
          }));
          checkMembership(); // 检查会员状态
          setLoading(false);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <AuthContext.Provider value={{ userData, loading }}>
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