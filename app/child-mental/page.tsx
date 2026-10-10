'use client';

import { useState, useEffect, useRef } from 'react';
import WithChat from '@/app/components/layouts/WithChat';
import { useAuth } from '@/app/contexts/AuthContext';
import { useChat } from '@/app/contexts/ChatContext';
import ConversationList from '@/app/components/ConversationList';
import MessageList from '@/app/components/Chat/MessageList';
import ChatInput from '@/app/components/Chat/ChatInput';
import AIFloatingBubble from '@/app/components/Chat/AIFloatingBubble';
import styles from './page.module.css';

// 開場問候：只顯示在畫面上，不寫進對話紀錄
const INTRO =
  '嗨，歡迎你來！🎨🎬🎵\n\n' +
  '我是你的 AI 工具小老師，可以一步一步教你用 AI 做圖片、影片和歌曲，像是用 Suno 寫歌，或用 ChatGPT、Gemini、Claude 發想點子。就算你從來沒用過也沒關係，我們慢慢來！\n\n' +
  '先告訴我：你想試試看做什麼呢？是想輕鬆玩玩看，還是想認真學、做出一個完整的作品？';

function ChildMentalContent() {
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
          <span className={styles.panelTitle}>🎨 兒童 AI 工具小老師</span>
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
                type="children-mental"
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

export default function ChildMentalPage() {
  return (
    <WithChat chatType="children-mental">
      <ChildMentalContent />
    </WithChat>
  );
}
