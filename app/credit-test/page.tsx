'use client';

import React from 'react';
import CreditTester from '../components/CreditTest/CreditTester';
import styles from './page.module.css';

export default function CreditTestPage() {
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>AI4Kingdom 信用點數測試</h1>
      <p className={styles.description}>
        此頁面用於本地測試不同會員級別的點數扣減邏輯和信用點數用盡時的系統反應
      </p>
      
      <div className={styles.testContainer}>
        <CreditTester />
      </div>
    </div>
  );
}