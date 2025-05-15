'use client';

import Link from 'next/link';
import styles from './BackToPortalLink.module.css';

export default function BackToPortalLink() {
  return (
    <Link href="/management" className={styles.backLink}>
      <span className={styles.backIcon}>←</span>
      返回後台管理
    </Link>
  );
}
