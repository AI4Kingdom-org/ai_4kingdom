'use client';

import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect } from 'react';
import styles from './UserIdDisplay.module.css';

export default function UserIdDisplay() {
  const { user } = useAuth();
  const [isExpanded, setIsExpanded] = useState(false);

  if (!user || !user.user_id) {
    return null;
  }
  
  // 確保 user_id 被轉換為字符串
  const userIdString = String(user.user_id);

  return (
    <div 
      className={`${styles.userIdDisplay} ${isExpanded ? styles.expanded : ''}`}
      onClick={() => setIsExpanded(!isExpanded)}
      title="點擊展開/收起"
    >
      <div className={styles.idContent}>
        <span className={styles.label}>用戶:</span> 
        {isExpanded ? (
          <span className={styles.id}>{userIdString}</span>
        ) : (
          <span className={styles.id}>{userIdString.substring(0, 8)}...</span>
        )}
      </div>
    </div>
  );
}