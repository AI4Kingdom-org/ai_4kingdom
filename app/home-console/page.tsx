'use client';

import { useAuth } from '../contexts/AuthContext';
import WithChat from '../components/layouts/WithChat';
import Chat from '../components/Chat/Chat';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';
import styles from './page.module.css';

export default function HomeConsolePage() {
  const { user, loading, identityId } = useAuth();
  // 訪客也能使用：會員用 WP userId，訪客用 guest id
  const chatUserId = user?.user_id || identityId;

  if (loading || !chatUserId) {
    return <div>Loading, please wait...</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <div className={styles.chatContainer}>
          <WithChat chatType="home-console">
            <Chat
              type="home-console"
              assistantId={ASSISTANT_IDS.HOME_CONSOLE}
              vectorStoreId={VECTOR_STORE_IDS.HOME_CONSOLE}
              userId={chatUserId}
            />
          </WithChat>
        </div>
      </div>
    </div>
  );
}
