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

  const checkMembership = async () => {
    try {
      console.log('开始获取nonce...');
      const nonceResponse = await fetch('https://ai4kingdom.com/wp-json/custom/v1/get-nonce', {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        }
      });

      console.log('nonce响应状态:', nonceResponse.status);
      console.log('nonce响应头:', Object.fromEntries(nonceResponse.headers));

      if (!nonceResponse.ok) {
        console.error('获取nonce失败');
        const errorText = await nonceResponse.text();
        console.error('nonce错误详情:', errorText);
        setUserData(null);
        setLoading(false);
        return;
      }

      const nonceData = await nonceResponse.json();
      console.log('nonce响应数据:', nonceData);
      const { nonce } = nonceData;

      console.log('开始检查会员状态...');
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
      
      console.log('会员检查响应状态:', response.status);
      console.log('会员检查响应头:', Object.fromEntries(response.headers));
      
      const responseText = await response.text();
      console.log('会员检查原始响应:', responseText);
      
      if (response.status === 401) {
        console.log('认证失败:', responseText);
        setUserData(null);
        setLoading(false);
        return;
      }
      
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
      setUserData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkMembership();
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