"use client";

import { useState } from 'react';
import styles from './ChatInput.module.css';

interface ChatInputProps {
  onSend: (message: string) => Promise<void>;
  isLoading: boolean;
}

export default function ChatInput({ onSend, isLoading }: ChatInputProps) {
  const [input, setInput] = useState('');

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    await onSend(input);
    setInput('');
  };

  return (
    <div className={styles.inputContainer}>
      <textarea
        className={styles.textArea}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        placeholder={isLoading ? "发送中..." : "输入消息..."}
        disabled={isLoading}
        rows={2}
      />
      <button
        className={styles.button}
        onClick={handleSend}
        disabled={!input.trim() || isLoading}
      >
        {isLoading ? "发送中..." : "发送"}
      </button>
    </div>
  );
} 