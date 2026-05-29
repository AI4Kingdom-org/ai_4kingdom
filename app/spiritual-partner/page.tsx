'use client';

import { useAuth } from '../contexts/AuthContext';
import WithChat from '../components/layouts/WithChat';
import Chat from '../components/Chat/Chat';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';
import styles from './page.module.css';

export default function SpiritualPartnerPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Loading, please wait...</div>;
  }

  if (!user) {
    return <div>請先登錄</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <div className={styles.chatContainer}>
          <WithChat chatType="spiritual-partner">
            <Chat
              type="spiritual-partner"
              assistantId={ASSISTANT_IDS.SPIRITUAL_PARTNER}
              vectorStoreId={VECTOR_STORE_IDS.SPIRITUAL_PARTNER}
              userId={user.user_id}
            />
          </WithChat>
        </div>
      </div>
    </div>
  );
}