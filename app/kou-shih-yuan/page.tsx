"use client";

import { useState, useEffect, useRef } from 'react';
import WithChat from '../components/layouts/WithChat';
import { useAuth } from '../contexts/AuthContext';
import { useChat } from '../contexts/ChatContext';
import ConversationList from '../components/ConversationList';
import MessageList from '../components/Chat/MessageList';
import ChatInput from '../components/Chat/ChatInput';
import AIFloatingBubble from '../components/Chat/AIFloatingBubble';
import { CHAT_TYPES } from '../config/chatTypes';
import styles from './page.module.css';

// 開場問候：只顯示在畫面上，不寫進對話紀錄
const INTRO =
  '弟兄姊妹平安！歡迎來到寇世遠研經集 🙏\n\n' +
  '我是根據寇世遠牧師《寇世遠研經集》（共 50 冊）回答問題的 AI 助手。寇牧師一生以經解經、忠心教導神的話語，盼望這些研經的亮光，也能幫助你更明白聖經，在生活中經歷神。\n\n' +
  '你可以問我某卷書、某段經文的講解，或研經集中某一冊的重點。今天想從哪一段經文開始呢？';

function KouShihYuanContent() {
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
          <span className={styles.panelTitle}>寇世遠AI助手</span>
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
                type={CHAT_TYPES.KOU_SHIH_YUAN}
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

export default function Page() {
  return (
    <WithChat chatType={CHAT_TYPES.KOU_SHIH_YUAN}>
      <KouShihYuanContent />
    </WithChat>
  );
}
