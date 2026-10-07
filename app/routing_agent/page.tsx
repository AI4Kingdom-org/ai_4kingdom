'use client';

import { useAuth } from '@/app/contexts/AuthContext';
import RoutingAgentChat from './RoutingAgentChat';

export default function RoutingAgentPage() {
  // 不要求登入：未登入時使用共用的訪客身分（伺服器端以簽章 token 判定並計入試用額度）
  const { user, identityId } = useAuth();
  const userId = user?.user_id || identityId || '';

  // 在客戶端準備好前先顯示 Loading
  if (!userId) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: '#666' }}>
        載入中…
      </div>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        html, body {
          margin: 0;
          padding: 0;
          background: #ffffff !important;
          height: 100%;
          overflow: hidden;
        }
        main {
          background: #ffffff !important;
          min-height: unset !important;
          height: 100%;
          overflow: hidden !important;
        }
      `}} />
      <RoutingAgentChat userId={userId} />
    </>
  );
}
