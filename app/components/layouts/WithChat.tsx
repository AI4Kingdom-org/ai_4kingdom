'use client';

import { ReactNode, useEffect, useState, useMemo } from 'react';
import { AuthProvider } from '../../contexts/AuthContext';
import { ChatProvider } from '../../contexts/ChatContext';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../../config/constants';
import { useAuth } from '../../contexts/AuthContext';
import { ChatType, CHAT_TYPE_CONFIGS } from '../../config/chatTypes';

interface WithChatProps {
  children: ReactNode;
  chatType?: ChatType;
  disableChatContext?: boolean; // skip ChatProvider for pages that don't use the bubble chat (still provides AuthProvider)
}

function ChatWrapper({ children, chatType = 'general', disableChatContext = false }: { children: ReactNode, chatType?: ChatType, disableChatContext?: boolean }) {
  const { user, loading, identityId } = useAuth();
  const [isReady, setIsReady] = useState(false);

  // disableChatContext：不需要 bubble chat 的頁面直接渲染 children，避免等待使用者驗證
  if (disableChatContext) {
    return <>{children}</>;
  }

  // 不再要求登入：會員用 WP userId，訪客用 guest id（伺服器端以簽章 token 判定實際身分與額度）
  const chatUserId = user?.user_id || identityId;

  const config = useMemo(() => {
    if (!chatUserId) return null;

    // 根据聊天类型获取对应的配置
    const typeConfig = CHAT_TYPE_CONFIGS[chatType];

    return {
      type: chatType,
      assistantId: typeConfig.assistantId || ASSISTANT_IDS.GENERAL,
      vectorStoreId: typeConfig.vectorStoreId || VECTOR_STORE_IDS.GENERAL,
      userId: chatUserId
    };
  }, [chatUserId, chatType]);

  useEffect(() => {
    if (!loading && chatUserId) {
      setIsReady(true);
    }
  }, [loading, chatUserId]);

  // 等待身分判定完成
  if (!isReady || !config) {
    return null;
  }

  return (
    <ChatProvider initialConfig={config}>
      {children}
    </ChatProvider>
  );
}

export default function WithChat({ children, chatType = 'general', disableChatContext = false }: WithChatProps) {
  return (
    <AuthProvider optional={disableChatContext}>
      <ChatWrapper chatType={chatType} disableChatContext={disableChatContext}>
        {children}
      </ChatWrapper>
    </AuthProvider>
  );
} 