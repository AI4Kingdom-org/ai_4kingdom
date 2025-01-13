'use client';

import { useAuth } from '../contexts/AuthContext';
import TestModule from '../components/TestModule';
import styles from './test.module.css';

export default function TestPage() {
  const { user, loading, error } = useAuth();

  console.log('Test页面状态:', { user, loading, error });

  if (loading) {
    return <div>加载中...</div>;
  }

  if (error) {
    console.error('认证错误:', error);
    return <div>认证错误: {error}</div>;
  }

  if (!user) {
    console.log('未登录');
    return (
      <div className={styles.unauthorized}>
        <h1>请先登录</h1>
        <button 
          onClick={() => window.location.href = 'https://ai4kingdom.com/login'}
          className={styles.backButton}
        >
          去登录
        </button>
      </div>
    );
  }

  // 检查用户角色
  const isAdmin = user.roles?.includes('administrator');
  console.log('用户角色检查:', { roles: user.roles, isAdmin });

  if (!isAdmin) {
    return (
      <div className={styles.unauthorized}>
        <h1>访问被拒绝</h1>
        <p>您没有权限访问此页面</p>
        <button 
          onClick={() => window.location.href = '/'}
          className={styles.backButton}
        >
          返回首页
        </button>
      </div>
    );
  }

  return <TestModule />;
} 