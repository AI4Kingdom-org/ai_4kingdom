'use client';

import { useState, useEffect, useRef } from 'react';
import WithChat from '../../components/layouts/WithChat';
import { useAuth } from '../../contexts/AuthContext';
import { useChat } from '../../contexts/ChatContext';
import ConversationList from '../../components/ConversationList';
import MessageList from '../../components/Chat/MessageList';
import ChatInput from '../../components/Chat/ChatInput';
import AIFloatingBubble from '../../components/Chat/AIFloatingBubble';
import styles from './JianZhuNavigator.module.css';

// 開場問候：只顯示在畫面上，不寫進對話紀錄
const INTRO =
  '平安！欢迎来到「祝健牧师-神的指教」🙏\n\n' +
  '我是根据祝健牧师的讲道与教导来回答问题的 AI 助手。无论是读经时遇到的疑问、生活里的难处，或是想更认识神的心意，都可以在这里和我一起从圣经中寻求神的指教。\n\n' +
  '今天有什么问题或心事，想和我聊聊吗？';

function JianZhuNavigatorContent() {
  const { user, identityId } = useAuth();
  const isMember = !!user;
  // 訪客也能使用：對話紀錄以身分 id（會員 userId／訪客 guest id）為 key
  const chatUserId = user?.user_id || identityId;
  const {
    messages,
    currentThreadId,
    setCurrentThreadId,
    sendMessage,
    isLoading,
    error,
    setError,
    loadChatHistory,
    setMessages,
  } = useChat();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // 桌面版預設開啟；手機版面板會蓋住大半畫面，預設收起（斷點與 CSS 一致）
  const [chatOpen, setChatOpen] = useState(
    () => typeof window === 'undefined' || !window.matchMedia('(max-width: 768px)').matches
  );
  // 新對話：問候語顯示在最上方
  const [intro, setIntro] = useState<string | null>(INTRO);
  const shouldLoadHistory = useRef(false);

  useEffect(() => {
    if (currentThreadId && chatUserId && shouldLoadHistory.current) {
      shouldLoadHistory.current = false;
      loadChatHistory(chatUserId);
    }
  }, [currentThreadId]);

  const handleCreateNewThread = () => {
    setCurrentThreadId(null);
    setMessages([]);
    setIntro(INTRO);
  };

  const handleSelectThread = (threadId: string) => {
    if (threadId === currentThreadId) return;
    shouldLoadHistory.current = true;
    setError('');
    setMessages([]);
    setIntro(null);
    setCurrentThreadId(threadId);
    setSidebarOpen(false);
  };

  const handleSendMessage = async (message: string) => {
    await sendMessage(message);
    window.dispatchEvent(new CustomEvent('refreshConversations'));
  };

  if (!chatUserId) return null;

  const displayMessages = intro ? [{ sender: 'bot', text: intro }, ...messages] : messages;

  return (
    <div className={styles.pageBackground}>
      <div className={`${styles.floatingPanel}${chatOpen ? ' ' + styles.panelOpen : ''}`}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>祝健牧師 AI 助手</span>
          <button className={styles.panelClose} onClick={() => setChatOpen(false)}>✕</button>
        </div>
        <div className={styles.chatWrapper}>
          {/* 對話記錄只給會員；訪客每次都是全新對話 */}
          {isMember && (
            <div className={`${styles.sidebar}${sidebarOpen ? ' ' + styles.sidebarOpen : ''}`}>
              <button className={styles.sidebarToggle} onClick={() => setSidebarOpen(v => !v)}>
                <span>📋 對話記錄</span><span>{sidebarOpen ? '▲' : '▼'}</span>
              </button>
              <ConversationList
                userId={chatUserId}
                type="jian-zhu"
                currentThreadId={currentThreadId}
                onSelectThread={handleSelectThread}
                isCreating={false}
                onCreateNewThread={handleCreateNewThread}
                sidebarMode={true}
              />
            </div>
          )}
          <div className={styles.main}>
            <MessageList messages={displayMessages} isLoading={isLoading} />
            {error && <div className={styles.errorBanner}>{error}</div>}
            <ChatInput onSend={handleSendMessage} isLoading={isLoading} />
          </div>
        </div>
      </div>
      <AIFloatingBubble
        open={chatOpen}
        onToggle={() => { setChatOpen(v => !v); setSidebarOpen(false); }}
        position="top-right"
      />
    </div>
  );
}

export default function JianZhuNavigatorPage() {
  return (
    <WithChat chatType="jian-zhu">
      <JianZhuNavigatorContent />
    </WithChat>
  );
}
