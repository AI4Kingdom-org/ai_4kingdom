'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/contexts/AuthContext';
import RoutingAgentChat from './RoutingAgentChat';

const GUEST_ID_STORAGE_KEY = 'routing_agent_guest_user_id';

function getOrCreateGuestUserId(): string {
  if (typeof window === 'undefined') return '';

  const existing = window.localStorage.getItem(GUEST_ID_STORAGE_KEY);
  if (existing && existing.trim()) return existing;

  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : String(Date.now());
  const next = `guest_${uuid}`;
  window.localStorage.setItem(GUEST_ID_STORAGE_KEY, next);
  return next;
}

export default function RoutingAgentPage() {
  const { user, loading } = useAuth();
  const [guestUserId, setGuestUserId] = useState<string>('');

  useEffect(() => {
    // 不要求登入：未登入時使用本機產生的 guest userId
    if (!loading && !user) {
      setGuestUserId(getOrCreateGuestUserId());
    }
  }, [loading, user]);

  const userId = useMemo(() => {
    return user?.user_id || guestUserId;
  }, [user?.user_id, guestUserId]);

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
      <style jsx global>{`
        html,
        body {
          margin: 0;
          padding: 0;
          background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
          height: 100%;
          overflow: hidden;
        }

        #__next {
          height: 100%;
        }
      `}</style>
      <RoutingAgentChat userId={userId} />
    </>
  );
}
