'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import styles from './UserCredit.module.css';

// 定義每個用戶類型的 token 額度
const TOKEN_LIMITS = {
  free: 100000,     // 100 credits
  pro: 1000000,     // 1,000 credits
  ultimate: 5000000 // 5,000 credits
};

// Token 轉換為 Credit 的比率
const TOKEN_TO_CREDIT_RATIO = 1000; // 100 tokens = 1 credit

interface UsageData {
  monthlyTokens: number;
  dailyTokens?: number;
}

export default function UserCreditPage() {
  const { user, loading: authLoading } = useAuth();
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = async () => {
    if (!user?.user_id) return;

    setLoading(true);
    setError(null);
    try {
      // 獲取當前年份
      const currentYear = new Date().getFullYear();
      // 獲取當前月份
      const currentMonth = new Date().getMonth() + 1;
      // 建構查詢月份字串，例如 "2025-05"
      const monthStr = `${currentYear}-${currentMonth.toString().padStart(2, '0')}`;

      // 添加隨機參數防止緩存
      const cacheBuster = new Date().getTime();
      // 呼叫 API 獲取用戶使用量
      const response = await fetch(`/api/usage/monthly?userId=${user.user_id}&year=${currentYear}&_=${cacheBuster}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '無法獲取使用量數據');
      }

      const data = await response.json();
      
      if (data.success && Array.isArray(data.usage)) {
        // 查找當前月份的使用量
        const currentMonthUsage = data.usage.find((item: any) => 
          item.YearMonth === monthStr
        );
        
        // 注意這裡的欄位名稱使用與數據庫一致的命名
        setUsage({
          monthlyTokens: currentMonthUsage?.totalTokens || 0,
          dailyTokens: currentMonthUsage?.dailyTokens || 0
        });
      } else {
        // 如果沒有數據，設置為 0
        setUsage({ monthlyTokens: 0, dailyTokens: 0 });
      }
    } catch (err) {
      console.error('[ERROR] 獲取 Token 使用量失敗:', err);
      setError(err instanceof Error ? err.message : '獲取數據時發生錯誤');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) {
      fetchUsage();
      // 每 5 分鐘刷新一次數據
      const intervalId = setInterval(fetchUsage, 5 * 60 * 1000);
      return () => clearInterval(intervalId);
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [user, authLoading]);

  // 計算剩餘 Credits
  const calculateRemainingCredits = () => {
    if (!user || !usage) return 0;

    const subscriptionType = user.subscription?.type || 'free';
    const limit = TOKEN_LIMITS[subscriptionType];
    const used = usage.monthlyTokens || 0;
    const remaining = Math.max(0, limit - used);
    return Math.floor(remaining / TOKEN_TO_CREDIT_RATIO);
  };

  const remainingCredits = calculateRemainingCredits();

  // 檢查是否有不足的 tokens
  const hasInsufficientTokens = () => {
    if (!user || !usage) return false;
    
    const subscriptionType = user.subscription?.type || 'free';
    const limit = TOKEN_LIMITS[subscriptionType];
    const used = usage.monthlyTokens || 0;
    
    return limit - used <= 0;
  };

  // 處理到期日期顯示
  const formatExpiryDate = () => {
    // Assert the type of user.subscription to include expiresAt and access it safely
    const expiresAtFromSubscription = (user?.subscription as { type: 'free' | 'pro' | 'ultimate'; expiresAt?: string | Date })?.expiresAt;

    if (!expiresAtFromSubscription) {
      return '永久有效';
    }

    try {
      const expiryDate = new Date(expiresAtFromSubscription);
      return expiryDate.toLocaleDateString('zh-TW', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch (err) {
      console.error('日期格式錯誤:', err);
      return '未知';
    }
  };

  if (loading || authLoading) {
    return <div className={styles.loading}>載入中，請稍候...</div>;
  }

  if (!user) {
    return <div className={styles.error}>請先登入</div>;
  }

  if (error) {
    return <div className={styles.error}>錯誤: {error}</div>;
  }

  const subscriptionType = user.subscription?.type || 'free';
  const subscriptionName = 
    subscriptionType === 'ultimate' ? 'Ultimate' :
    subscriptionType === 'pro' ? 'Pro' : 'Free';

  const tokenLimit = TOKEN_LIMITS[subscriptionType];
  const usedTokens = usage?.monthlyTokens || 0;
  const percentUsed = Math.min(100, Math.round((usedTokens / tokenLimit) * 100));

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>用户额度管理</h1>
      
      <div className={styles.infoCard}>
        <div className={styles.infoRow}>
          <span>用户ID:</span>
          <span>{user.user_id}</span>
        </div>
        <div className={styles.infoRow}>
          <span>方案:</span>
          <span className={styles.plan}>{subscriptionName}</span>
        </div>
        <div className={styles.infoRow}>
          <span>到期时间:</span>
          <span>{formatExpiryDate()}</span>
        </div>
        <div className={styles.infoRow}>
          <span>剩余Credits:</span>
          <span className={styles.credits}>{remainingCredits}</span>
        </div>
      </div>
      
      {hasInsufficientTokens() && (
        <div className={styles.upgradeWarning}>
          <p>您的 Token 额度不足！</p>
          <p>请升级会员以获取更多 Credits，享有更多功能。</p>
        </div>
      )}

      <div className={styles.usageCard}>
        <h3>Token Monthly Usage</h3>
        <div className={styles.progressContainer}>
          <div 
            className={`${styles.progressBar} ${percentUsed >= 80 ? styles.warning : ''} ${percentUsed >= 95 ? styles.danger : ''}`} 
            style={{ width: `${percentUsed}%` }}
          ></div>
          <span className={styles.progressText}>{percentUsed}%</span>
        </div>
        <div className={styles.tokenInfo}>
          <span>{usedTokens.toLocaleString()} / {tokenLimit.toLocaleString()} tokens</span>
        </div>
        <div className={styles.lastUpdated}>
          Update Date: {new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}
        </div>
      </div>
      
      <div className={styles.creditsExplanation}>  
        <p>每月额度将在每月1日重置，未使用的额度不会累计到下个月。</p>
      </div>
    </div>
  );
}