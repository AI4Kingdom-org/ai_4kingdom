"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';
import { ChatType } from '../config/chatTypes';
import { useAuth } from '../contexts/AuthContext';

interface ChatConfig {
  type: ChatType;
  assistantId: string;
  vectorStoreId: string;
  userId?: string;
  systemPrompt?: string;
  threadId?: string;
}

// 定義參考來源的型別
interface DocumentReference {
  fileName: string;
  filePath: string;
  pageNumber: number | null;
  text: string;
  fileId: string;
}

interface ChatMessage {
  sender: string;
  text: string;
  references?: DocumentReference[];
}

interface ChatContextType {
  config: {
    type: ChatType;
    assistantId?: string;
    vectorStoreId?: string;
    userId?: string;
    threadId?: string;
  } | null;
  setConfig: (config: ChatContextType['config']) => void;
  messages: Array<ChatMessage>;
  setMessages: React.Dispatch<React.SetStateAction<Array<ChatMessage>>>;
  currentThreadId: string | null;
  setCurrentThreadId: (threadId: string | null) => void;
  sendMessage: (message: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  loadChatHistory: (userId: string) => Promise<void>;
  setIsLoading: (loading: boolean) => void;
}

const ChatContext = createContext<ChatContextType | null>(null);

export function ChatProvider({ 
  children,
  initialConfig = {
    assistantId: ASSISTANT_IDS.GENERAL,
    vectorStoreId: VECTOR_STORE_IDS.GENERAL,
    type: 'general'
  },
  user
}: {
  children: React.ReactNode;
  initialConfig?: ChatConfig;
  user?: any;
}) {
  const { user: authUser } = useAuth();  // 获取认证用户
  const [config, setConfigState] = useState<ChatContextType['config']>(initialConfig || null);
  const [messages, setMessages] = useState<Array<ChatMessage>>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setConfig = useCallback((newConfig: ChatContextType['config']) => {
    setConfigState(newConfig);
  }, []);

  useEffect(() => {
    if (!config || config.type !== initialConfig?.type) {
      console.log('[DEBUG] ChatProvider 初始化配置:', {
        user,
        initialConfig,
        type: initialConfig?.type
      });
      
      setConfig({
        ...config,
        type: initialConfig?.type,
        assistantId: ASSISTANT_IDS[initialConfig?.type.toUpperCase() as keyof typeof ASSISTANT_IDS],
        vectorStoreId: VECTOR_STORE_IDS[initialConfig?.type.toUpperCase() as keyof typeof VECTOR_STORE_IDS],
        userId: user?.user_id || authUser?.user_id
      });
    }
  }, [initialConfig?.type, user, authUser]);

  useEffect(() => {
    setMessages([]);
    setCurrentThreadId(null);
    setError(null);
  }, [config?.assistantId, config?.vectorStoreId, config?.type]);
  const sendMessage = useCallback(async (message: string) => {
    setIsLoading(true);
    setError(null);

    try {
        // 先添加使用者訊息
        setMessages(prev => [...prev, { sender: 'user', text: message }]);
        
        // 創建一個暫時的機器人回應，用於流式更新
        let streamingContent = '';
        let finalThreadId = currentThreadId;
        let currentReferences: DocumentReference[] = [];
        
        // 使用流式 API 發送請求
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message,
                threadId: currentThreadId,
                userId: config?.userId,
                config: {
                    type: config?.type,
                    assistantId: config?.assistantId,
                    vectorStoreId: config?.vectorStoreId,
                    stream: true // 啟用流式輸出
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('[ERROR] 发送消息失败:', {
                status: response.status,
                error: errorData
            });
            throw new Error(errorData.error || '发送失败');
        }

        // 檢查是否為流式回應
        if (response.headers.get('Content-Type')?.includes('text/event-stream')) {
            // 處理流式回應            // 添加一個暫時的機器人回應
            setMessages(prev => [...prev, { sender: 'bot', text: '', references: [] }]);

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('無法讀取響應流');
            }
            
            const decoder = new TextDecoder();
            let isDone = false;
            
            // 讀取並處理流數據
            while (!isDone) {
                const { value, done } = await reader.read();
                if (done) {
                    isDone = true;
                    break;
                }

                // 解碼接收到的數據
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n\n');
                
                for (const line of lines) {
                    if (line.trim() && line.startsWith('data: ')) {
                        try {
                            const jsonStr = line.substring(6);
                            const data = JSON.parse(jsonStr);
                              if (data.content) {
                                // 更新流式內容
                                streamingContent += data.content;
                                
                                // 更新最後一個機器人訊息
                                setMessages(prev => {
                                    const newMessages = [...prev];
                                    if (newMessages.length > 0 && newMessages[newMessages.length - 1].sender === 'bot') {                                        newMessages[newMessages.length - 1].text = streamingContent;
                                        // 保留任何已有的參考來源
                                        newMessages[newMessages.length - 1].references = currentReferences;
                                    }
                                    return newMessages;
                                });
                            }
                            
                            // 處理參考來源資訊
                            if (data.references && Array.isArray(data.references)) {
                                // 更新當前參考來源
                                currentReferences = data.references;
                                
                                // 更新最後一個機器人訊息以包含參考來源
                                setMessages(prev => {
                                    const newMessages = [...prev];
                                    if (newMessages.length > 0 && newMessages[newMessages.length - 1].sender === 'bot') {
                                        newMessages[newMessages.length - 1].references = currentReferences;
                                    }
                                    return newMessages;
                                });
                                
                                console.log('[DEBUG] 收到文档引用:', data.references.length);
                            }
                            
                            if (data.threadId) {
                                finalThreadId = data.threadId;
                                setCurrentThreadId(finalThreadId);
                            }
                            
                            if (data.error) {
                                setError(data.error);
                                break;
                            }
                            
                            if (data.done) {
                                isDone = true;
                                console.log('[DEBUG] 流式響應完成，總token:', data.usage);
                                break;
                            }
                        } catch (e) {
                            console.error('[ERROR] 解析流數據失敗:', e, line.substring(6));
                        }
                    }
                }
            }
            
            return { success: true, threadId: finalThreadId };
        } else {
            // 傳統的非流式回應處理
            const data = await response.json();

            if (data.success) {                setMessages(prev => [
                    ...prev,
                    { sender: 'user', text: message },
                    { 
                      sender: 'bot', 
                      text: data.reply, 
                      references: data.references || [] 
                    }
                ]);
                setCurrentThreadId(data.threadId);
            }

            return data;
        }
    } catch (error) {
        console.error('[ERROR] 发送消息失败:', error);
        setError(error instanceof Error ? error.message : '发送消息失败');
        throw error;
    } finally {
        setIsLoading(false);
    }
}, [currentThreadId, config]);

  const loadChatHistory = useCallback(async (userId: string) => {

    try {
        const response = await fetch(`/api/messages?threadId=${currentThreadId}&userId=${userId}`, {
            credentials: 'include'
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('[ERROR] 加载历史消息失败:', {
                status: response.status,
                error: errorData
            });
            throw new Error(errorData.error || '加载失败');
        }

        const data = await response.json();        if (data.success && Array.isArray(data.messages)) {
            const formattedMessages = data.messages.map((msg: any) => ({
                sender: msg.role === 'user' ? 'user' : 'bot',
                text: msg.content,
                references: msg.references || []
            }));
            
            setMessages(formattedMessages);
        }
    } catch (error) {
        console.error('[ERROR] 加载历史消息失败:', {
            error,
            threadId: currentThreadId,
            errorMessage: error instanceof Error ? error.message : '未知错误'
        });
        setError(error instanceof Error ? error.message : '加载历史消息失败');
    }
}, [currentThreadId, config]);

  const value: ChatContextType = {
    config,
    setConfig,
    messages,
    setMessages,
    currentThreadId,
    setCurrentThreadId,
    sendMessage,
    isLoading,
    error,
    setError,
    loadChatHistory,
    setIsLoading
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}