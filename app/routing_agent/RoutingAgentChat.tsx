'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRoutingAgent } from './hooks/useRoutingAgent';
import styles from './RoutingAgentChat.module.css';

interface RoutingAgentChatProps {
  userId: string;
}

/** 將訊息內容中的 URL 轉成可點擊連結 */
function renderWithLinks(text: string): React.ReactNode[] {
  const URL_REGEX = /(https?:\/\/[^\s\u3000\uff0c\uff01\u3002\uff1f\u300a\u300b\u300c\u300d\u300e\u300f\u3010\u3011\u3014\u3015\u3016\u3017]+)/g;
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) => {
    if (URL_REGEX.test(part)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#4f8ef7', textDecoration: 'underline', wordBreak: 'break-all' }}
        >
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default function RoutingAgentChat({ userId }: RoutingAgentChatProps) {
  const [input, setInput] = useState('');
  const [hasStarted, setHasStarted] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const { messages, isLoading, error, sendMessage } = useRoutingAgent({ userId });

  // 初始化 SpeechRecognition
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SpeechRecognitionAPI = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;
    setSpeechSupported(true);

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results as unknown[])
        .map((r: any) => r[0].transcript as string)
        .join('');
      setInput(transcript);
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognitionRef.current = recognition;
    return () => recognition.abort();
  }, []);

  const toggleListening = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (isListening) {
      recognition.stop();
      setIsListening(false);
    } else {
      setInput('');
      recognition.start();
      setIsListening(true);
    }
  };

  // 當訊息更新時自動滾動到最新
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // 自動調整 textarea 高度
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const newHeight = Math.min(textarea.scrollHeight, 100);
      textarea.style.height = `${newHeight}px`;
    }
  }, [input]);

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    // 第一次發送訊息時標記為已開始
    if (!hasStarted) {
      setHasStarted(true);
    }

    const content = input;
    setInput('');

    // 重置 textarea 高度
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    await sendMessage(content);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift + Enter 換行，Enter 發送
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className={styles.pageWrapper}>
      {/* ── Left sidebar ── */}
      <aside className={styles.sidebar}>
        {/* Hamburger — opens article-links menu */}
        <button
          className={styles.hamburgerBtn}
          onClick={() => setIsMenuOpen((o) => !o)}
          aria-label="開啟選單"
        >
          <span className={styles.hamburgerLine} />
          <span className={styles.hamburgerLine} />
          <span className={styles.hamburgerLine} />
        </button>

        {/* 关于我们 */}
        <a
          href="https://ai4kingdom.org/elementor-799/"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.sidebarBox}
          title="同性恋是罪吗？"
          style={{ backgroundImage: 'url(https://ai4kingdom.org/wp-content/uploads/2025/01/rsw_1280-1-1.webp)' }}
        >
          同性恋是罪吗？
        </a>

        <a
          href="https://ai4kingdom.org/%e9%97%ae%e9%a2%98%ef%bc%9a%e8%af%b7%e9%97%ae%e5%a0%95%e8%83%8e%e6%98%af%e5%8f%af%e4%bb%a5%e7%9a%84%e5%90%97%ef%bc%9f/"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.sidebarBox}
          title="请问堕胎是可以的吗？"
          style={{ backgroundImage: 'url(https://ai4kingdom.org/wp-content/uploads/2025/01/rsw_1280-4.webp)' }}
        >
          请问堕胎是可以的吗？
        </a>
      </aside>

      {/* Slide-out menu drawer */}
      {isMenuOpen && (
        <>
          <div
            className={styles.menuOverlay}
            onClick={() => setIsMenuOpen(false)}
          />
          <nav className={styles.menuDrawer}>
            <div className={styles.menuHeader}>
              <button
                className={styles.menuCloseBtn}
                onClick={() => setIsMenuOpen(false)}
                aria-label="關閉選單"
              >
                ✕
              </button>
            </div>
            <ul className={styles.menuList}>
              <li>
                <a
                  href="https://ai4kingdom.org/%e4%bd%bf%e7%94%a8%e5%9c%8b%e5%ba%a6ai%e6%9c%80%e6%96%b0gpt/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.menuItemLink}
                >
                  <img
                    src="https://ai4kingdom.org/wp-content/uploads/2025/01/image25-scaled.jpg"
                    alt=""
                    className={styles.menuItemThumb}
                  />
                  国度AI GPT
                </a>
              </li>
            </ul>
          </nav>
        </>
      )}

      {/* ── Main chat area ── */}
    <div
      className={`${styles.routingAgentContainer} ${
        hasStarted ? styles.routingAgentContainerFull : ''
      }`}
    >
      {/* 歡迎詞區域 - 對話開始後隱藏 */}
      {!hasStarted && (
        <div
          className={`${styles.welcomeSection} ${styles.welcomeSectionCompact}`}
        >
          <Image
            src="/ai4kingdom-logo.png"
            alt="Ai4Kingdom"
            width={294}
            height={92}
            style={{ objectFit: 'contain' }}
            priority
          />
        </div>
      )}

      {/* 對話區域 - 開始後才顯示 */}
      {hasStarted && (
        <div className={styles.messagesContainer}>
          {messages.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                color: '#9ca3af',
                padding: '20px',
                fontSize: '14px',
              }}
            >
              開始對話...
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`${styles.message} ${styles[message.role]}`}
              >
                {message.role === 'assistant' ? (
                  <div className={styles.assistantWrapper}>
                    <div className={styles.assistantLabel}>Ai4Kingdom</div>
                    <div
                      className={`${styles.messageBubble} ${
                        isLoading && message.role === 'assistant'
                          ? styles.typing
                          : ''
                      }`}
                    >
                      {message.content ? (
                        <div style={{ whiteSpace: 'pre-wrap' }}>
                          {renderWithLinks(message.content)}
                        </div>
                      ) : (
                        <div className={styles.loadingDots}>
                          <div className={styles.loadingDot}></div>
                          <div className={styles.loadingDot}></div>
                          <div className={styles.loadingDot}></div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className={styles.messageBubble}>
                    <div style={{ whiteSpace: 'pre-wrap' }}>
                      {renderWithLinks(message.content)}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

          {isLoading && messages[messages.length - 1]?.role === 'user' && (
            <div className={`${styles.message} ${styles.assistant}`}>
              <div className={styles.assistantWrapper}>
                <div className={styles.assistantLabel}>Ai4Kingdom</div>
                <div className={styles.messageBubble}>
                  <div className={styles.loadingDots}>
                    <div className={styles.loadingDot}></div>
                    <div className={styles.loadingDot}></div>
                    <div className={styles.loadingDot}></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && <div className={styles.errorMessage}>{error}</div>}

          <div ref={messagesEndRef} />
        </div>
      )}

      {/* 輸入區域 - 預設顯示 */}
      <div className={styles.inputSection}>
        <div className={styles.inputWrapper}>
          <div className={styles.inputField}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isListening ? '正在聆听...' : '平安！您想问什么？'}
              disabled={isLoading}
              rows={1}
            />
            {speechSupported && (
              <button
                type="button"
                className={`${styles.micButton} ${isListening ? styles.micButtonActive : ''}`}
                onClick={toggleListening}
                disabled={isLoading}
                title={isListening ? '停止錄音' : '語音輸入'}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  width="27"
                  height="27"
                  fill="#000000"
                >
                  <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2zm-1 14.93V20H9v2h6v-2h-2v-2.07A7.001 7.001 0 0 0 19 11h-2a5 5 0 0 1-10 0H5a7.001 7.001 0 0 0 6 6.93z"/>
                </svg>
              </button>
            )}
          </div>
          <button
            className={styles.sendButton}
            onClick={handleSendMessage}
            disabled={isLoading || !input.trim()}
            title="發送 (Enter)"
          >
            ➤
          </button>
        </div>
      </div>

      {/* 對話前引導說明區域 */}
      {!hasStarted && (
        <div className={styles.guideSection} />
      )}
    </div>
    </div>
  );
}
