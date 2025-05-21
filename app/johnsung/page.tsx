'use client';

import { useAuth } from '../contexts/AuthContext';
import WithChat from '../components/layouts/WithChat';
import Chat from '../components/Chat/Chat';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';
import styles from './page.module.css';  // 导入样式

export default function NewChatPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Loading, please wait...</div>;
  }

  if (!user) {
    return <div>请先登录</div>;
  }
  
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <div className={styles.chatContainer}>
          <WithChat chatType="johnsung">
            <Chat
              type="johnsung"
              assistantId={ASSISTANT_IDS.JOHNSUNG}
              vectorStoreId={VECTOR_STORE_IDS.JOHNSUNG}
              userId={user.user_id}
            />
          </WithChat>
        </div>
      </div>
    </div>
  );
}