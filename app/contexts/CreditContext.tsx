'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAuth } from './AuthContext';

interface UsageData {
  monthlyTokens: number;
  dailyTokens?: number;
}

interface CreditContextType {
  usage: UsageData | null;
  loading: boolean;
  error: string | null;
  refreshUsage: () => Promise<void>;
  remainingCredits: number;
  totalCredits: number;
  isGuest: boolean;
  isUnlimited: boolean;
  lastRefreshTime: Date | null;
  hasInsufficientTokens: boolean; // 新增檢查 token 是否不足的屬性
}

const CreditContext = createContext<CreditContextType | null>(null);

export const UNLIMITED_CREDITS = 999999;

/**
 * 額度一律以伺服器 /api/credits/me 為準（會員依方案的每月額度；訪客為一次性 50 點試用）。
 * 以前在這裡用前端寫死的上限自行計算，與伺服器端實際扣點的判斷可能不一致。
 */
export function CreditProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, identityId } = useAuth();
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [remainingCredits, setRemainingCredits] = useState(0);
  const [totalCredits, setTotalCredits] = useState(0);
  const [isGuest, setIsGuest] = useState(true);
  const [isUnlimited, setIsUnlimited] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);

  const fetchUsage = useCallback(async () => {
    if (!identityId) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/credits/me?_=${Date.now()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || '無法獲取額度');
      }

      setUsage({ monthlyTokens: data.usedTokens || 0 });
      // 管理員不限額度：給一個不會觸發「額度不足／余额较低」的值，各頁面不必個別判斷
      setRemainingCredits(data.unlimited ? UNLIMITED_CREDITS : (data.remainingCredits || 0));
      setIsUnlimited(!!data.unlimited);
      setTotalCredits(data.totalCredits || 0);
      setIsGuest(data.kind === 'guest');
      setLastRefreshTime(new Date());
    } catch (err) {
      console.error('[ERROR] 獲取額度失敗:', err);
      setError(err instanceof Error ? err.message : '獲取數據時發生錯誤');
    } finally {
      setLoading(false);
    }
  }, [identityId]);

  // 初始加載及定期刷新（身分切換時，例如登入後，也會重新載入）
  useEffect(() => {
    if (authLoading) return;
    if (!identityId) {
      setLoading(false);
      return;
    }
    fetchUsage();
    const intervalId = setInterval(fetchUsage, 5 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [authLoading, identityId, user?.user_id, fetchUsage]);

  // 訂閱全局事件，用於從任何組件觸發刷新
  useEffect(() => {
    const handleGlobalRefresh = () => fetchUsage();
    window.addEventListener('refreshCredits', handleGlobalRefresh);
    return () => window.removeEventListener('refreshCredits', handleGlobalRefresh);
  }, [fetchUsage]);

  const contextValue: CreditContextType = {
    usage,
    loading,
    error,
    refreshUsage: fetchUsage,
    remainingCredits,
    totalCredits,
    isGuest,
    isUnlimited,
    lastRefreshTime,
    hasInsufficientTokens: !!usage && remainingCredits <= 0,
  };

  return (
    <CreditContext.Provider value={contextValue}>
      {children}
    </CreditContext.Provider>
  );
}

export const useCredit = () => {
  const context = useContext(CreditContext);
  if (!context) {
    throw new Error('useCredit must be used within a CreditProvider');
  }
  return context;
};
