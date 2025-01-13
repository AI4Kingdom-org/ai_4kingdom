'use client';

import { useAuth } from '../contexts/AuthContext';
import TestModule from '../components/TestModule';
import styles from './test.module.css';

export default function TestPage() {
  const { user, loading, error } = useAuth();

  if (loading) {
    return <div>加载中...</div>;
  }

  if (error) {
    return <div>认证错误: {error}</div>;
  }

  // 检查用户是否是管理员
  if (!user?.roles?.includes('administrator')) {
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