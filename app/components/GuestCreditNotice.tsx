'use client';

import { useAuth } from '../contexts/AuthContext';
import { useCredit } from '../contexts/CreditContext';
import styles from './GuestCreditNotice.module.css';

const SITE = process.env.NEXT_PUBLIC_PRIMARY_DOMAIN || 'https://ai4kingdom.org';

/**
 * 訪客試用額度提示。頁面嵌在 WordPress 的 sandbox iframe 裡（未允許 allow-top-navigation），
 * 註冊／登入連結無法導向上層視窗，改用新分頁開啟（sandbox 有 allow-popups）。
 * 會員不顯示（會員額度在 /usercredit 查看）。
 */
export default function GuestCreditNotice() {
  const { user, loading: authLoading } = useAuth();
  const { isGuest, remainingCredits, totalCredits, loading } = useCredit();

  if (authLoading || user || !isGuest || (loading && !totalCredits)) return null;

  const exhausted = remainingCredits <= 0;

  return (
    <div className={`${styles.notice} ${exhausted ? styles.exhausted : ''}`}>
      <span>
        {exhausted
          ? '訪客試用額度已用完'
          : <>訪客試用：剩餘 <strong>{remainingCredits}</strong> / {totalCredits} 點</>}
        {' — 免費註冊即得每月 300 點'}
      </span>
      <span className={styles.links}>
        <a href={`${SITE}/register/`} target="_blank" rel="noopener">註冊</a>
        <a href={`${SITE}/login/`} target="_blank" rel="noopener">登入</a>
      </span>
    </div>
  );
}
