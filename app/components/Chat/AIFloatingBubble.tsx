'use client';

import styles from './AIFloatingBubble.module.css';

interface AIFloatingBubbleProps {
  open: boolean;
  onToggle: () => void;
  title?: string;
}

export default function AIFloatingBubble({ open, onToggle, title = 'AI 對話助手' }: AIFloatingBubbleProps) {
  return (
    <button
      className={`${styles.bubble}${open ? ' ' + styles.bubbleOpen : ''}`}
      onClick={onToggle}
      title={title}
      aria-label={title}
    >
      <span className={styles.bubbleLabel}>AI</span>
    </button>
  );
}
