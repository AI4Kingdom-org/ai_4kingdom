"use client";

import { useAuth } from '@/app/contexts/AuthContext';
import WithChat from '@/app/components/layouts/WithChat';
import Chat from '@/app/components/Chat/Chat';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '@/app/config/constants';
import styles from './page.module.css';

export default function ChildMentalPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Loading, please wait...</div>;
  }

  if (!user) {
    return <div>請先登錄</div>;
  }

  return (
    <div className={styles.container}>
      <WithChat chatType="children-mental">
        <Chat
          type="children-mental"
          assistantId={ASSISTANT_IDS.CHILDREN_MENTAL}
          vectorStoreId={VECTOR_STORE_IDS.CHILDREN_MENTAL}
          userId={user.user_id}
          showSidebar={true}
        />
      </WithChat>
    </div>
  );
}