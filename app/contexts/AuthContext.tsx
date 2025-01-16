'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import type { UserData } from '../types/auth';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { getDynamoDBConfig } from '../utils/dynamodb';

interface AuthContextType {
  user: UserData | null;
  loading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  error: null
});

// 缓存 DynamoDB 客户端
let dynamoDBClient: DynamoDBClient | null = null;

async function getDynamoDBClient() {
  if (!dynamoDBClient) {
    const config = await getDynamoDBConfig();
    dynamoDBClient = new DynamoDBClient(config);
  }
  return dynamoDBClient;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('[DEBUG] AuthContext useEffect 触发');
    
    const validateSession = async () => {
      console.log('[DEBUG] 开始验证会话');
      
      try {
        setLoading(true);
        console.log('[DEBUG] 发送验证请求到:', {
          url: 'https://ai4kingdom.com/wp-json/custom/v1/validate_session',
          method: 'POST',
          hasCredentials: true
        });
        
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
          ok: response.ok,
          statusText: response.statusText
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
          hasNonce: !!data.nonce
        });
        
        if (data.success) {
          console.log('[DEBUG] 设置用户数据');
          setUser(data);
        } else {
          console.warn('[WARN] 验证成功但数据无效:', {
            message: data.message || '未知错误'
          });
          throw new Error(data.message || '验证失败');
        }
      } catch (err) {
        console.error('[ERROR] 验证过程错误:', {
          name: err instanceof Error ? err.name : 'Unknown',
          message: err instanceof Error ? err.message : '未知错误',
          stack: err instanceof Error ? err.stack : undefined
        });
        
        setError(err instanceof Error ? err.message : '认证失败');
        setUser(null);
      } finally {
        console.log('[DEBUG] 验证流程完成:', {
          hasUser: !!user,
          hasError: !!error
        });
        setLoading(false);
      }
    };

    validateSession();

    // 可选：添加定期检查会话有效性的功能
    const sessionCheckInterval = setInterval(() => {
      console.log('[DEBUG] 执行定期会话检查');
      validateSession();
    }, 5 * 60 * 1000); // 每5分钟检查一次

    return () => {
      console.log('[DEBUG] 清理 AuthContext 效果');
      clearInterval(sessionCheckInterval);
    };
  }, []);

  console.log('[DEBUG] AuthProvider 当前状态:', { 
    hasUser: !!user,
    loading,
    hasError: !!error,
    userDetails: user ? {
      userId: user.user_id,
      subscriptionType: user.subscription?.type,
      hasNonce: !!user.nonce
    } : null
  });

  return (
    <AuthContext.Provider value={{ user, loading, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  console.log('[DEBUG] useAuth Hook 调用:', {
    hasUser: !!context.user,
    loading: context.loading,
    hasError: !!context.error
  });
  return context;
} 