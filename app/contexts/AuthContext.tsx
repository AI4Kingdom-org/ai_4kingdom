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
          credentials: 'include'
        });
        
        if (response.ok) {
          const data: WordPressMembership = await response.json();
          
          // 根据会员状态设置用户数据
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