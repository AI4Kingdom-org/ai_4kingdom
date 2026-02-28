import { redirect } from 'next/navigation';

/**
 * /user-sunday-guide-v2 已合併至 /sunday-guide-v2。
 * 此頁面僅保留重定向，避免舊連結失效。
 */
export default function UserSundayGuideV2Redirect() {
  redirect('/sunday-guide-v2');
}
