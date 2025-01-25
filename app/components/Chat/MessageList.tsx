"use client";

import styles from './MessageList.module.css';

interface Message {
  sender: string;
  text: string;
}

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
}

export default function MessageList({ messages, isLoading }: MessageListProps) {
  return (
    <div className={styles.messageList}>
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
          <div className={styles.messageContent}>{message.text}</div>
          {message.sender === 'user' && (
            <div className={styles.avatar}>U</div>
          )}
        </div>
      ))}
      {isLoading && (
        <div className={`${styles.message} ${styles.botMessage}`}>
          <div className={styles.avatar}>AI</div>
          <div className={styles.messageContent}>
            <span className={styles.typing}>AI正在思考...</span>
          </div>
        </div>
      )}
    </div>
  );
} 