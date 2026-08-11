"use client";

import { useEffect, useRef } from "react";
import styles from './MessageList.module.css';

interface Message {
  sender: string;
  text: string;
  timestamp?: string;
}

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
}

export default function MessageList({ messages }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className={styles.messageList} ref={containerRef}>
      {messages.map((message, index) => (
        <div
          key={index}
          className={`${styles.message} ${
            message.sender === 'user' ? styles.userMessage : styles.botMessage
          }`}
        >
          {message.sender === 'bot' && (
            <div className={styles.avatar}>AI</div>
          )}
          <div className={styles.messageContent} style={{ whiteSpace: 'pre-wrap' }}>
            {message.text}
          </div>
          {message.sender === 'user' && (
            <div className={styles.avatar}>U</div>
          )}
        </div>
      ))}
    </div>
  );
}
