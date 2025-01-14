'use client';

import { useAuth } from '../contexts/AuthContext';
import TestModule from '../components/TestModule';
import styles from './test.module.css';
import { useState, useEffect } from 'react';

export default function TestPage() {
  const { user, loading, error } = useAuth();
  console.log('TestPage 渲染状态:', { user, loading, error });

  useEffect(() => {
    console.log('TestPage mounted');
    return () => console.log('TestPage unmounted');
  }, []);

  const [timeoutError, setTimeoutError] = useState<string | null>(null);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (loading) {
        setTimeoutError('加载超时，请刷新页面重试');
      }
    }, 15000);

    return () => clearTimeout(timeoutId);
  }, [loading]);

  if (timeoutError) {
    return (
      <div className={styles.error}>
        <h1>{timeoutError}</h1>
        <button 
          onClick={() => window.location.reload()}
          className={styles.backButton}
        >
          刷新页面
        </button>
      </div>
    );
  }

  // 移除登录检查，直接渲染 TestModule
  return <TestModule />;
} 