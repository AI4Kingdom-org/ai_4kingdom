"use client";

import { useState, useEffect, useRef } from 'react';
import styles from './ChatInput.module.css';
import { useChat } from '../../contexts/ChatContext';

interface ChatInputProps {
  onSend: (message: string) => Promise<void>;
  isLoading: boolean;
}

export default function ChatInput({ onSend, isLoading }: ChatInputProps) {
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const { currentThreadId } = useChat();

  const toggleMic = () => {
    if (isListening) { recognitionRef.current?.stop(); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('此瀏覽器不支援語音輸入（請使用 Chrome 或 Edge）'); return; }
    const rec = new SR();
    rec.lang = 'zh-TW';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onstart = () => setIsListening(true);
    rec.onend   = () => setIsListening(false);
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results as any[])
        .map((r: any) => r[0].transcript).join('');
      setInput(prev => prev ? prev + ' ' + transcript : transcript);
    };
    recognitionRef.current = rec;
    rec.start();
  };

  // Clear input when thread changes
  useEffect(() => {
    setInput('');
  }, [currentThreadId]);
  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const messageToSend = input.trim();
    setInput(''); // 立即清空輸入框，不等待 API 調用完成
    await onSend(messageToSend);
  };

  return (
    <div className={styles.inputContainer}>
      <div className={styles.inputField}>
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
          placeholder={isLoading ? '發送中...' : '輸入消息...'}
          disabled={isLoading}
          rows={2}
        />
        <button
          onClick={toggleMic}
          className={`${styles.micButton}${isListening ? ` ${styles.micListening}` : ''}`}
          disabled={isLoading}
          title={isListening ? '停止錄音' : '語音輸入'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2zm-1 14.93V20H9v2h6v-2h-2v-2.07A7.001 7.001 0 0 0 19 11h-2a5 5 0 0 1-10 0H5a7.001 7.001 0 0 0 6 6.93z"/>
          </svg>
        </button>
      </div>
      <button
        className={styles.sendButton}
        onClick={handleSend}
        disabled={!input.trim() || isLoading}
        title="發送 (Enter)"
      >
        發送
      </button>
    </div>
  );
} 