'use client';

import React from 'react';
import styles from './CreditProgressBar.module.css';
import { useCredit } from '../../contexts/CreditContext';
import { useAuth } from '../../contexts/AuthContext';

// 定義每個用戶類型的 token 額度
const TOKEN_LIMITS = {
  free: 100000,     // 100 credits
  pro: 1000000,     // 1,000 credits
  ultimate: 5000000 // 5,000 credits
};

// Token 轉換為 Credit 的比率
const TOKEN_TO_CREDIT_RATIO = 1000; // 100 tokens = 1 credit

// 警告閾值：當剩餘點數低於此百分比時變為紅色
const WARNING_THRESHOLD = 10; // 10%

interface CreditProgressBarProps {
  // 可選：是否顯示詳細數字
  showDetails?: boolean;
  // 可選：是否展示簡潔模式（只有進度條）
  compact?: boolean;
  // 可選：客製化樣式
  className?: string;
}

const CreditProgressBar: React.FC<CreditProgressBarProps> = ({
  showDetails = true,
  compact = false,
  className = '',
}) => {
  const { usage, loading, remainingCredits } = useCredit();
  const { user } = useAuth();

  // 如果還在載入或沒有使用者資料，顯示載入中或預設值
  if (loading || !user || !usage) {
    return (
      <div className={`${styles.container} ${className}`}>
        {!compact && <div className={styles.label}>信用點數</div>}
        <div className={styles.progressBar}>
          <div className={styles.progress} style={{ width: '0%' }}></div>
        </div>
        {showDetails && !compact && <div className={styles.details}>載入中...</div>}
      </div>
    );
  }

  // 取得使用者訂閱類型
  const subscriptionType = user.subscription?.type || 'free';
  const tokenLimit = TOKEN_LIMITS[subscriptionType];
  const usedTokens = usage.monthlyTokens || 0;
  
  // 計算百分比
  const usedPercentage = Math.min(100, (usedTokens / tokenLimit) * 100);
  const remainingPercentage = 100 - usedPercentage;
  
  // 判斷是否低於警告閾值
  const isLowCredits = remainingPercentage <= WARNING_THRESHOLD;
  
  // 計算總信用點數
  const totalCredits = tokenLimit / TOKEN_TO_CREDIT_RATIO;

  return (
    <div className={`${styles.container} ${className} ${compact ? styles.compact : ''}`}>
      {!compact && <div className={styles.label}>信用點數</div>}
      <div className={styles.progressBar}>
        <div 
          className={`${styles.progress} ${isLowCredits ? styles.progressWarning : ''}`} 
          style={{ width: `${100 - remainingPercentage}%` }}
        ></div>
      </div>
      {showDetails && !compact && (
        <div className={styles.details}>
          剩餘: <strong>{remainingCredits}</strong> / {totalCredits} 點
        </div>
      )}
      {showDetails && compact && (
        <div className={styles.compactDetails}>
          {remainingCredits}/{totalCredits}
        </div>
      )}
    </div>
  );
};

export default CreditProgressBar;