'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { FEATURE_ACCESS } from '../types/auth';
import type { UserData, AuthState, AuthContextType, FeatureKey, MemberRole } from '../types/auth';

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  error: null,
  login: async () => false,
  checkAuth: async () => {},
  logout: () => {},
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

  // 登录方法
  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      console.log('[DEBUG] 开始登录');
      
      const API_BASE = 'https://ai4kingdom.com';
      const response = await fetch(`${API_BASE}/wp-json/jwt-auth/v1/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();
      
      if (data.token) {
        console.log('[DEBUG] 登录成功，获取到 Token');
        localStorage.setItem('jwt_token', data.token);
        await checkAuth(); // 立即验证并获取用户信息
        return true;
      } else {
        console.error('[ERROR] 登录失败:', data);
        setState(prev => ({
          ...prev,
          error: data.message || '登录失败',
          loading: false
        }));
        return false;
      }
    } catch (err) {
      console.error('[ERROR] 登录过程错误:', err);
      setState(prev => ({
        ...prev,
        error: err instanceof Error ? err.message : '登录失败',
        loading: false
      }));
      return false;
    }
  };

  // 登出方法
  const logout = () => {
    localStorage.removeItem('jwt_token');
    setState({
      user: null,
      loading: false,
      error: null
    });
  };

  // 验证会话
  const checkAuth = async () => {
    try {
      console.log('[DEBUG] 开始验证会话');
      
      const token = localStorage.getItem('jwt_token');
      if (!token) {
        console.log('[DEBUG] 未找到 Token');
        setState(prev => ({
          ...prev,
          user: null,
          loading: false
        }));
        return;
      }

      const API_BASE = 'https://ai4kingdom.com';
      const response = await fetch(`${API_BASE}/wp-json/custom/v1/validate_session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json'
        },
        credentials: 'include',
        mode: 'cors',
        body: JSON.stringify({})
      });

      console.log('[DEBUG] 请求详情:', {
        url: response.url,
        method: 'POST',
        status: response.status,
        statusText: response.statusText
      });

      if (response.status === 401) {
        console.log('[DEBUG] Token 已过期或无效');
        localStorage.removeItem('jwt_token');
        setState(prev => ({
          ...prev,
          user: null,
          loading: false,
          error: '请重新登录'
        }));
        return;
      }

      if (!response.ok) {
        throw new Error(`请求失败: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('[DEBUG] 响应数据:', {
        success: data.success,
        hasUserId: !!data.user_id,
        hasSubscription: !!data.subscription,
        subscriptionType: data.subscription?.type
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
        location: window.location.href
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

  // 初始化时检查认证状态
  useEffect(() => {
    checkAuth();
  }, []);

  // 定期检查会话状态
  useEffect(() => {
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
    login,
    logout,
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