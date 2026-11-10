'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * App 頁面瀏覽紀錄：路徑變更時以 sendBeacon 送到 /api/analytics/collect（site=app）。
 *
 * 用 sendBeacon 而非 fetch：app/lib/identity/client.ts 會攔截 fetch('/api/...')
 * 並替沒有身分的瀏覽者申請訪客 token，統計不該觸發這件事。
 * 不設 cookie、不寫 localStorage；管理頁不計入。
 */

const SKIP_PATHS = [
  /^\/(management|token-management|site-analytics|user-permissions|file-records|file-upload|admin|creative-studio|usercredit)(\/|$)/,
];

export default function VisitTracker() {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || lastPath.current === pathname) return;
    const isFirstHit = lastPath.current === null;
    lastPath.current = pathname;

    if (SKIP_PATHS.some((re) => re.test(pathname))) return;
    if (typeof navigator === 'undefined' || !navigator.sendBeacon || navigator.webdriver) return;
    // 本機開發與正式環境共用同一張表，不記錄 localhost
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)) return;

    try {
      const body = JSON.stringify({
        site: 'app',
        path: pathname,
        // 站內切換頁面時 document.referrer 不會變，只在第一次送，避免重複計算來源
        ref: isFirstHit ? document.referrer : window.location.href,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      });
      navigator.sendBeacon('/api/analytics/collect', new Blob([body], { type: 'text/plain' }));
    } catch {
      // 統計失敗不影響頁面
    }
  }, [pathname]);

  return null;
}
