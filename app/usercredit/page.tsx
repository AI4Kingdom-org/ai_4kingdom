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

  // 處理到期日期顯示
  const formatExpiryDate = () => {
    if (user?.subscription?.type === 'free') {
      return '永久有效 (Forever)';
    } else if (user?.subscription?.expiry) {
      const date = new Date(user.subscription.expiry);
      return isNaN(date.getTime()) ? '未知' : date.toLocaleDateString();
    }
    return '未知';
  };

  if (authLoading || loading) {
    return <div className={styles.loading}>載入中...</div>;
  }

  if (!user) {
    return <div className={styles.loginPrompt}>請先登入以查看您的信用額度。</div>;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Credit额度</h1>

      <div className={styles.creditBlock}>
        <div className={styles.userInfo}>
          <div>
            <span className={styles.label}>用户名:</span> 
            <span className={styles.value}>{user.display_name}</span>
          </div>
          <div>
            <span className={styles.label}>用户 ID:</span> 
            <span className={styles.value}>{user.user_id}</span>
          </div>
          <div>
            <span className={styles.label}>会员等级:</span> 
            <span className={styles.value}>
              {user.subscription?.type === 'free' && '免费会员 (100 Credits/月)'}
              {user.subscription?.type === 'pro' && 'Pro 会员 (1,000 Credits/月)'}
              {user.subscription?.type === 'ultimate' && 'Ultimate 会员 (5,000 Credits/月)'}
            </span>
          </div>
          <div>
            <span className={styles.label}>到期日期:</span> 
            <span className={styles.value}>{formatExpiryDate()}</span>
          </div>
          
          {/* 剩余点数显示 */}
          <div className={styles.creditInfoSection}>
            <div className={styles.creditInfo}>
              <span className={styles.label}>剩余 Credits: </span>
              <span className={styles.value}>{remainingCredits}</span>
            </div>
          </div>
          
          <div className={styles.resetReminder}>
          每月额度将在每月1日重置，未使用的额度不会累计到下个月。
          </div>
        </div>
      </div>
    </div>
  );
}