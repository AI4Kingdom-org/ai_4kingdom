'use client';

import { useAuth } from '../contexts/AuthContext';
import WithChat from '../components/layouts/WithChat';
import Chat from '../components/Chat/Chat';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';
import styles from './Homeschool.module.css';

export default function HomeschoolPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Loading, please wait...</div>;
  }

  if (!user) {
    return <div>請先登錄</div>;
  }

  return (
    <div className={styles.container}>
      <WithChat chatType="homeschool">
        <Chat
          type="homeschool"
          assistantId={ASSISTANT_IDS.HOMESCHOOL}
          vectorStoreId={VECTOR_STORE_IDS.HOMESCHOOL}
          userId={user.user_id}
          showSidebar={true}
        />
      </WithChat>
    </div>
  );
}