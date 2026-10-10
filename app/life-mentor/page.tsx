"use client";

import { useState, useEffect, useRef } from 'react';
import WithChat from '@/app/components/layouts/WithChat';
import { useAuth } from '@/app/contexts/AuthContext';
import { useChat } from '@/app/contexts/ChatContext';
import ConversationList from '@/app/components/ConversationList';
import MessageList from '@/app/components/Chat/MessageList';
import ChatInput from '@/app/components/Chat/ChatInput';
import AIFloatingBubble from '@/app/components/Chat/AIFloatingBubble';
import { CHAT_TYPES } from '@/app/config/chatTypes';
import styles from './LifeMentor.module.css';

// 開場問候：只顯示在畫面上，不寫進對話紀錄
const INTRO =
  '您好，很高興在這裡遇見您 🌱\n\n' +
  '我是人生導師 AI 助手。無論是工作與學業的抉擇、家庭與人際關係，或是信仰路上的疑問與掙扎，都可以放心地跟我說。我會用心聆聽，並從聖經的智慧陪您一起思考。\n\n' +
  '最近有什麼事情放在您心裡，想找人聊聊嗎？';

function LifeMentorContent() {
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
          <span className={styles.panelTitle}>人生導師 AI 助手</span>
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
                type={CHAT_TYPES.LIFE_MENTOR}
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

export default function LifeMentorPage() {
  return (
    <WithChat chatType={CHAT_TYPES.LIFE_MENTOR}>
      <LifeMentorContent />
    </WithChat>
  );
}
