'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { FEATURE_ACCESS } from '../types/auth';
import type { UserData, AuthState, AuthContextType, FeatureKey, MemberRole } from '../types/auth';

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  error: null,
  checkAuth: async () => {},
  getSubscriptionStatus: () => 'inactive',
  getSubscriptionType: () => 'free',
  isSubscriptionValid: () => false,
  hasRole: () => false,
  canAccessFeature: () => false
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
      
      const API_BASE = 'https://ai4kingdom.com';
      const response = await fetch(`${API_BASE}/wp-json/custom/v1/validate_session`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json',
          'Origin': window.location.origin
        },
        mode: 'cors'
      });

      console.log('[DEBUG] 请求Cookie:', document.cookie);
      console.log('[DEBUG] 响应头:', Object.fromEntries(response.headers.entries()));

      if (response.status === 401) {
        console.log('[DEBUG] 会话已过期或未登录');
        setState(prev => ({
          ...prev,
          user: null,
          loading: false,
          error: '请重新登录'
        }));
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[DEBUG] 验证失败详情:', errorData);
        throw new Error(`认证失败: ${errorData.message || response.statusText}`);
      }

      const data = await response.json();
      console.log('[DEBUG] 验证响应数据:', {
        success: data.success,
        hasUserId: !!data.user_id,
        hasSubscription: !!data.subscription,
        subscriptionType: data.subscription?.type,
        subscriptionStatus: data.subscription?.status,
        roles: data.subscription?.roles,
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
        message: err instanceof Error ? err.message : '未知错误',
        cookies: document.cookie,
        location: window.location.href,
        origin: window.location.origin
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

  // 新增：角色检查方法
  const hasRole = (role: MemberRole) => {
    return state.user?.subscription?.roles?.includes(role) || false;
  };

  // 新增：功能访问检查方法
  const canAccessFeature = (feature: FeatureKey) => {
    const userRoles = state.user?.subscription?.roles || [];
    const requiredRoles = FEATURE_ACCESS[feature];
    return userRoles.some(role => requiredRoles.includes(role));
  };

  useEffect(() => {
    checkAuth();

    const sessionCheckInterval = setInterval(() => {
      console.log('[DEBUG] 执行定期会话检查');
      checkAuth();
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(sessionCheckInterval);
    };
  }, []);

  const value = {
    ...state,
    checkAuth,
    getSubscriptionStatus,
    getSubscriptionType,
    isSubscriptionValid,
    hasRole,
    canAccessFeature
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