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

  const API_BASE = 'https://ai4kingdom.com';

  const makeRequest = async (endpoint: string, options: RequestInit) => {
    const response = await fetch(`${API_BASE}/wp-json/custom/v1/${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(options.headers || {})
      },
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`API请求失败: ${response.statusText}`);
    }

    return response.json();
  };

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      console.log('[DEBUG] 开始登录');
      
      const response = await fetch(`${API_BASE}/wp-json/custom/v1/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ username, password })
      });

      console.log('[DEBUG] 登录响应头:', {
        headers: Object.fromEntries(response.headers.entries()),
        hasCookie: response.headers.get('set-cookie') !== null
      });
      
      const data = await response.json();
      
      if (data.success) {
        console.log('[DEBUG] 登录成功，正在获取用户信息');
        await checkAuth();
        return true;
      }
      
      throw new Error(data.message || '登录失败');
    } catch (err) {
      console.error('[ERROR] 登录失败:', err);
      setState(prev => ({
        ...prev,
        error: err instanceof Error ? err.message : '登录失败',
        loading: false
      }));
      return false;
    }
  };

  const checkAuth = async () => {
    try {
      console.log('[DEBUG] 开始验证会话');
      
      const response = await fetch(`${API_BASE}/wp-json/custom/v1/validate_session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include'
      });

      const data = await response.json();

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
        
        console.log('[DEBUG] 会话验证成功:', {
          userId: data.user_id,
          subscription: data.subscription
        });
      } else {
        throw new Error(data.message || '验证失败');
      }
    } catch (err) {
      console.error('[ERROR] 会话验证失败:', err);
      setState(prev => ({
        ...prev,
        user: null,
        loading: false,
        error: err instanceof Error ? err.message : '认证失败'
      }));
    }
  };

  const logout = async () => {
    try {
      await makeRequest('logout', {
        method: 'POST'
      });
      console.log('[DEBUG] 登出成功');
    } catch (err) {
      console.error('[ERROR] 登出失败:', err);
    } finally {
      setState({
        user: null,
        loading: false,
        error: null
      });
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