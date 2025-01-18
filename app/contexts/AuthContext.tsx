'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import type { UserData, AuthState, AuthContextType } from '../types/auth';

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  error: null,
  checkAuth: async () => {},
  getSubscriptionStatus: () => 'inactive',
  getSubscriptionType: () => 'free',
  isSubscriptionValid: () => false
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null
  });

  const checkAuth = async () => {
    try {
      console.log('[DEBUG] 开始验证会话');
      
      const response = await fetch('https://ai4kingdom.com/wp-json/custom/v1/validate_session', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });

      console.log('[DEBUG] 验证响应状态:', {
        status: response.status,
        ok: response.ok
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('[DEBUG] 验证响应数据:', {
        success: data.success,
        hasUserId: !!data.user_id,
        hasSubscription: !!data.subscription,
        subscriptionType: data.subscription?.type,
        subscriptionStatus: data.subscription?.status,
        hasNonce: !!data.nonce
      });
      
      if (data.success) {
        setState(prev => ({
          ...prev,
          user: {
            ...data,
            user_id: String(data.user_id)
          },
          loading: false,
          error: null
        }));
      } else {
        throw new Error(data.message || '验证失败');
      }
    } catch (err) {
      console.error('[ERROR] 验证过程错误:', {
        message: err instanceof Error ? err.message : '未知错误'
      });
      
      setState(prev => ({
        ...prev,
        user: null,
        loading: false,
        error: err instanceof Error ? err.message : '认证失败'
      }));
    }
  };

  // 订阅相关的工具方法
  const getSubscriptionStatus = () => {
    return state.user?.subscription?.status || 'inactive';
  };

  const getSubscriptionType = () => {
    return state.user?.subscription?.type || 'free';
  };

  const isSubscriptionValid = () => {
    const subscription = state.user?.subscription;
    if (!subscription) return false;

    if (subscription.status !== 'active') return false;
    
    if (subscription.expiry) {
      const expiryDate = new Date(subscription.expiry);
      if (expiryDate < new Date()) return false;
    }

    return true;
  };

  useEffect(() => {
    checkAuth();

    // 定期检查会话有效性
    const sessionCheckInterval = setInterval(() => {
      console.log('[DEBUG] 执行定期会话检查');
      checkAuth();
    }, 5 * 60 * 1000); // 每5分钟检查一次

    return () => {
      clearInterval(sessionCheckInterval);
    };
  }, []);

  const value = {
    ...state,
    checkAuth,
    getSubscriptionStatus,
    getSubscriptionType,
    isSubscriptionValid
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
} 