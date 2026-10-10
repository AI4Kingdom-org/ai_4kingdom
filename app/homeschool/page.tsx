'use client';

import { useState, useEffect, useRef } from 'react';
import WithChat from '../components/layouts/WithChat';
import { useAuth } from '../contexts/AuthContext';
import { useChat } from '../contexts/ChatContext';
import ConversationList from '../components/ConversationList';
import MessageList from '../components/Chat/MessageList';
import ChatInput from '../components/Chat/ChatInput';
import AIFloatingBubble from '../components/Chat/AIFloatingBubble';
import HomeschoolProfileForm, { HomeschoolProfile } from '../components/HomeschoolProfileForm';
import { getConcernLabel } from '../types/homeschool';
import styles from './Homeschool.module.css';

const SITE = process.env.NEXT_PUBLIC_PRIMARY_DOMAIN || 'https://ai4kingdom.org';

const INTRO =
  '您好！我是家庭教育 AI 助手 🏠\n\n' +
  '我可以陪您一起面對在家教育與親子教養的各種問題：教材與學習資源的選擇、孩子的學習進度與動機、情緒與品格培養等，並以聖經的原則給您建議。';

function describeChild(profile: Partial<HomeschoolProfile> | null) {
  if (!profile) return '';
  const parts: string[] = [];
  if (typeof profile.age === 'number') parts.push(`${profile.age} 歲`);
  if (Array.isArray(profile.concerns) && profile.concerns.length > 0) {
    parts.push(`主要關注：${profile.concerns.map(getConcernLabel).join('、')}`);
  }
  return parts.join('，');
}

// 開場問候：訪客只用預設人設問候；會員依孩子資料與是否接續舊對話調整
function buildGreeting(isMember: boolean, profile: Partial<HomeschoolProfile> | null, resuming: boolean) {
  if (!isMember) {
    return `${INTRO}\n\n請告訴我：您的孩子現在幾歲？最近最讓您掛心的是什麼？\n\n（註冊會員後可填寫孩子資料，讓建議更貼近您的孩子。）`;
  }

  const name = profile?.childName?.trim();
  const detail = describeChild(profile);
  const fillTip = '\n\n您可以點右上角「📝 孩子資料」填寫孩子的基本資訊，讓我提供更個人化的建議。';

  if (resuming) {
    return name
      ? `歡迎回來！我們接續上次的對話，繼續聊聊${name}的情況。上次談到的方向，這段時間試下來如何？有什麼新的進展或困難嗎？`
      : `歡迎回來！我們接續上次的對話。這段時間情況如何？有什麼新的進展或困難嗎？${fillTip}`;
  }

  return name
    ? `${INTRO}\n\n我已經看過您填寫的${name}的資料${detail ? `（${detail}）` : ''}。今天想先從哪個方面聊起呢？`
    : `${INTRO}\n\n請告訴我：您的孩子現在幾歲？最近最讓您掛心的是什麼？${fillTip}`;
}

function HomeschoolContent() {
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
  const [view, setView] = useState<'chat' | 'profile'>('chat');
  const [showMemberNotice, setShowMemberNotice] = useState(false);
  const [profile, setProfile] = useState<Partial<HomeschoolProfile> | null>(null);
  // 新對話：問候語顯示在最上方（不寫進對話紀錄）
  const [intro, setIntro] = useState<string | null>(null);
  const shouldLoadHistory = useRef(false);
  // 接續舊對話時，歷史載入完後補上的問候
  const pendingResumeGreeting = useRef<string | null>(null);
  const initialized = useRef(false);

  // 初次載入：訪客只顯示預設問候、不帶紀錄；會員帶入孩子資料並接續最近一次對話
  useEffect(() => {
    if (!chatUserId || initialized.current) return;
    initialized.current = true;

    if (!isMember) {
      setIntro(buildGreeting(false, null, false));
      return;
    }

    (async () => {
      let childProfile: Partial<HomeschoolProfile> | null = null;
      let latestThreadId: string | null = null;
      try {
        const [profileRes, threadsRes] = await Promise.all([
          fetch(`/api/homeschool-prompt?userId=${chatUserId}`),
          fetch(`/api/threads?userId=${chatUserId}&type=homeschool`, { credentials: 'include' }),
        ]);
        if (profileRes.ok) childProfile = await profileRes.json();
        if (threadsRes.ok) {
          const threads = await threadsRes.json();
          // /api/threads 已依時間新到舊排序
          const latest = Array.isArray(threads)
            ? threads.find((t: any) => t.threadId && String(t.Type || t.type || '').toLowerCase() === 'homeschool')
            : null;
          latestThreadId = latest?.threadId || null;
        }
      } catch (e) {
        console.warn('[WARN] 載入家庭教育會員資料失敗:', e);
      }

      setProfile(childProfile);
      if (latestThreadId) {
        pendingResumeGreeting.current = buildGreeting(true, childProfile, true);
        shouldLoadHistory.current = true;
        setCurrentThreadId(latestThreadId);
      } else {
        setIntro(buildGreeting(true, childProfile, false));
      }
    })();
  }, [chatUserId, isMember]);

  useEffect(() => {
    if (currentThreadId && chatUserId && shouldLoadHistory.current) {
      shouldLoadHistory.current = false;
      loadChatHistory(chatUserId).then(() => {
        const greeting = pendingResumeGreeting.current;
        if (!greeting) return;
        pendingResumeGreeting.current = null;
        setMessages(prev => [...prev, { sender: 'bot', text: greeting }]);
      });
    }
  }, [currentThreadId]);

  const handleCreateNewThread = () => {
    setCurrentThreadId(null);
    setMessages([]);
    setIntro(buildGreeting(isMember, profile, false));
  };

  const handleSelectThread = (threadId: string) => {
    if (threadId === currentThreadId) return;
    shouldLoadHistory.current = true;
    pendingResumeGreeting.current = null;
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

  const handleProfileClick = () => {
    if (!isMember) {
      setShowMemberNotice(v => !v);
      return;
    }
    setSidebarOpen(false);
    setView(v => (v === 'profile' ? 'chat' : 'profile'));
  };

  const handleProfileSaved = (saved: HomeschoolProfile) => {
    setProfile(saved);
    setView('chat');
    setMessages(prev => [...prev, { sender: 'bot', text: '✅ 已更新孩子資料，接下來的建議會依照最新的資料。' }]);
  };

  if (!chatUserId) return null;

  const displayMessages = intro ? [{ sender: 'bot', text: intro }, ...messages] : messages;

  return (
    <div className={styles.pageBackground}>
      <div className={`${styles.floatingPanel}${chatOpen ? ' ' + styles.panelOpen : ''}`}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>🏠 家庭教育 AI 助手</span>
          <div className={styles.headerActions}>
            <button
              className={`${styles.profileBtn}${view === 'profile' ? ' ' + styles.profileBtnActive : ''}`}
              onClick={handleProfileClick}
            >
              📝 孩子資料
            </button>
            <button className={styles.panelClose} onClick={() => setChatOpen(false)}>✕</button>
          </div>
        </div>
        {showMemberNotice && !isMember && (
          <div className={styles.memberNotice}>
            <span>填寫孩子資料是會員功能，免費註冊即可使用，讓 AI 依孩子的狀況提供建議。</span>
            <span className={styles.memberNoticeLinks}>
              <a href={`${SITE}/register/`} target="_blank" rel="noopener">註冊</a>
              <a href={`${SITE}/login/`} target="_blank" rel="noopener">登入</a>
              <button onClick={() => setShowMemberNotice(false)} aria-label="關閉">✕</button>
            </span>
          </div>
        )}
        {view === 'profile' ? (
          <div className={styles.profileView}>
            <HomeschoolProfileForm embedded onSaved={handleProfileSaved} onCancel={() => setView('chat')} />
          </div>
        ) : (
          <div className={styles.chatWrapper}>
            {isMember && (
              <div className={`${styles.sidebar}${sidebarOpen ? ' ' + styles.sidebarOpen : ''}`}>
                <button className={styles.sidebarToggle} onClick={() => setSidebarOpen(v => !v)}>
                  <span>📋 對話記錄</span><span>{sidebarOpen ? '▲' : '▼'}</span>
                </button>
                <ConversationList
                  userId={chatUserId}
                  type="homeschool"
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
        )}
      </div>
      <AIFloatingBubble
        open={chatOpen}
        onToggle={() => { setChatOpen(v => !v); setSidebarOpen(false); }}
        position="top-right"
      />
    </div>
  );
}

export default function HomeschoolPage() {
  return (
    <WithChat chatType="homeschool">
      <HomeschoolContent />
    </WithChat>
  );
}
