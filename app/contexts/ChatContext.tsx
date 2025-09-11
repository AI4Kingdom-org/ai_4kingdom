"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';
import { ChatType } from '../config/chatTypes';
import { useAuth } from '../contexts/AuthContext';

// 自訂事件總線，用於跨組件通信
export const ChatEvents = {
  HOMESCHOOL_DATA_UPDATED: 'homeschool_data_updated'
};

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
  refreshHomeschoolData: () => Promise<void>; // 新增的方法來刷新 homeschool 資料
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

  // 刷新 homeschool 數據的函數
  const refreshHomeschoolData = useCallback(async () => {
    if (config?.type !== 'homeschool' || !config?.userId) return;
    
    try {
      setIsLoading(true);
      console.log('[DEBUG] 刷新家校数据:', { userId: config.userId });
      
      // 獲取最新的 homeschool 數據
      const response = await fetch(`/api/homeschool-prompt?userId=${config.userId}`);
      if (response.ok) {
        const data = await response.json();
        console.log('[DEBUG] 获取到新的家校数据:', data);
        // 如果 recentChanges 有變化，清空對話並更新 config（將 recentChanges 放進 assistantId 以外的自訂欄位，如 extraPrompt）
        if ((config as any).extraPrompt !== data.recentChanges) {
          setMessages([]);
          setConfig({
            ...config,
            threadId: data.threadId,
            extraPrompt: data.recentChanges // 新增自訂欄位
          } as any);
        } else if (data.threadId && data.threadId !== currentThreadId) {
          setCurrentThreadId(data.threadId);
          setConfig({
            ...config,
            threadId: data.threadId,
            extraPrompt: data.recentChanges
          } as any);
        }
        return data;
      }
    } catch (error) {
      console.error('[ERROR] 刷新家校数据失败:', error);
      setError(error instanceof Error ? error.message : '刷新数据失败');
    } finally {
      setIsLoading(false);
    }
  }, [config, currentThreadId, setConfig]);

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
  
  // 監聽 homeschool 數據更新事件
  useEffect(() => {
    // 只有在 homeschool 聊天類型下才需要監聽
    if (config?.type !== 'homeschool') return;
    
    const handleHomeschoolDataUpdated = () => {
      console.log('[DEBUG] 收到家校数据更新事件');
      refreshHomeschoolData();
    };
    
    // 添加事件監聽器
    window.addEventListener(ChatEvents.HOMESCHOOL_DATA_UPDATED, handleHomeschoolDataUpdated);
    
    // 清理函數
    return () => {
      window.removeEventListener(ChatEvents.HOMESCHOOL_DATA_UPDATED, handleHomeschoolDataUpdated);
    };
  }, [config?.type, refreshHomeschoolData]);

  const sendMessage = useCallback(async (message: string) => {
    setIsLoading(true);
    setError(null);

    // 打字機效果的變數
    let typewriterTimer: NodeJS.Timeout | null = null;
    let typewriterCurrent = '';
    let typewriterIndex = 0;
    let typewriterTarget = '';
    let isTypewriterRunning = false;
    
    // 開始打字機效果
    const startTypewriterEffect = (initialText: string) => {
      if (isTypewriterRunning) return;
      
      typewriterCurrent = '';
      typewriterIndex = 0;
      typewriterTarget = initialText;
      isTypewriterRunning = true;
      
      const typeNextChar = () => {
        if (typewriterIndex < typewriterTarget.length) {
          typewriterCurrent += typewriterTarget[typewriterIndex];
          typewriterIndex++;
          
          // 更新UI
          setMessages(prev => {
            const newMessages = [...prev];
            const lastMessage = newMessages[newMessages.length - 1];
            if (lastMessage && lastMessage.sender === 'bot') {
              lastMessage.text = typewriterCurrent;
            }
            return newMessages;
          });
          
          // 設置下一個字符的延遲（可調整速度）
          typewriterTimer = setTimeout(typeNextChar, 20); // 20ms 每個字符，更快
        } else if (typewriterIndex < typewriterTarget.length) {
          // 如果目標文字變長了，繼續打字
          typewriterTimer = setTimeout(typeNextChar, 20);
        }
      };
      
      typeNextChar();
    };
    
    // 更新打字機目標文字
    const updateTypewriterTarget = (newText: string) => {
      typewriterTarget = newText;
      
      // 如果打字機還沒開始，現在開始
      if (!isTypewriterRunning && newText.length > 0) {
        startTypewriterEffect(newText);
      }
      // 如果打字機已經追上當前目標，繼續打字
      else if (typewriterIndex >= typewriterCurrent.length && typewriterIndex < typewriterTarget.length) {
        if (typewriterTimer) clearTimeout(typewriterTimer);
        const typeNextChar = () => {
          if (typewriterIndex < typewriterTarget.length) {
            typewriterCurrent += typewriterTarget[typewriterIndex];
            typewriterIndex++;
            
            setMessages(prev => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              if (lastMessage && lastMessage.sender === 'bot') {
                lastMessage.text = typewriterCurrent;
              }
              return newMessages;
            });
            
            typewriterTimer = setTimeout(typeNextChar, 20);
          }
        };
        typewriterTimer = setTimeout(typeNextChar, 20);
      }
    };

    try {
        // 先添加使用者訊息
        setMessages(prev => [...prev, { sender: 'user', text: message }]);
        
        // 創建一個暫時的機器人回應，用於流式更新
        let finalThreadId = currentThreadId;
        let currentReferences: DocumentReference[] = [];
        
        // 使用流式 API 發送請求
        // 判斷是否為 agape 單位（以 localStorage 選檔案時可能保存 unitId 或直接依賴 URL）
    let unitId: string | undefined;
        try {
          if (typeof window !== 'undefined') {
    if (window.location.pathname.includes('agape-church')) unitId = 'agape';
  else if (window.location.pathname.includes('east-christ-home')) unitId = 'eastChristHome';
  else if (window.location.pathname.includes('jian-zhu')) unitId = 'jianZhu';
      else {
              // 可擴充：從 localStorage 或 config 取得
              const storedUnit = localStorage.getItem('currentUnitId');
              if (storedUnit) unitId = storedUnit;
            }
          }
        } catch {}

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
                },
                unitId
            })
        });

        if (!response.ok) {
            let errorData: any = {};
            try {
                const responseText = await response.text();
                if (responseText.trim()) {
                    errorData = JSON.parse(responseText);
                } else {
                    errorData = { error: `HTTP ${response.status}: ${response.statusText}` };
                }
            } catch (parseError) {
                // 如果無法解析 JSON，使用響應狀態作為錯誤信息
                errorData = { 
                    error: `HTTP ${response.status}: ${response.statusText}`,
                    details: '響應格式無效'
                };
            }
            
            console.error('[ERROR] 发送消息失败:', {
                status: response.status,
                statusText: response.statusText,
                error: errorData
            });
            throw new Error(errorData.error || `发送失败 (${response.status})`);
        }

        // 檢查是否為流式回應
        if (response.headers.get('Content-Type')?.includes('text/event-stream')) {
            // 處理流式回應：先顯示「思考中」訊息
            setMessages(prev => [...prev, { sender: 'bot', text: 'AI正在思考中，請稍候...', references: [] }]);

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('無法讀取響應流');
            }
            
            const decoder = new TextDecoder();
            let isDone = false;
            let accumulatedText = ''; // 累積所有接收到的文字
            let isFirstChunk = true;
            
            // 讀取並處理流數據，即時開始打字機效果
            while (!isDone) {
                const { value, done } = await reader.read();
                if (done) {
                    isDone = true;
                    break;
                }
                
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n\n').filter(line => line.trim() !== '');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const eventData = JSON.parse(line.substring(6));
                            const event = eventData.event;
                            const data = eventData.data;

                            // 處理完成和錯誤事件
                            if (event === 'done' || event === 'thread.run.completed') {
                                isDone = true;
                                break;
                            }
                            
                            // 處理錯誤事件
                            if (event === 'error') {
                                throw new Error(eventData.error || '流式處理錯誤');
                            }

                            if (event === 'thread.message.delta') {
                                const delta = data.delta.content?.[0];
                                if (delta?.type === 'text' && delta.text?.value) {
                                    let textValue = delta.text.value;
                                    
                                    // 高品質模式：精準清洗，保留重要引用資訊
                                    textValue = textValue
                                        .replace(/【\d+†】/g, '')         // 特定格式：【1†】、【2†】
                                        .replace(/\*\*\d+\*\*/g, '')      // **1**、**2** 等粗體數字
                                        .replace(/†\d*(?!\w)/g, '')       // †1、†2 等符號（但保留單詞內的）
                                        .replace(/‡\d*(?!\w)/g, '')       // ‡1、‡2 等符號
                                        .replace(/§\d*(?!\w)/g, '');      // §1、§2 等符號
                                    
                                    // 保留重要資訊：
                                    // - 保留一般括號 () [] 內的經文引用
                                    // - 保留章節編號如 "第1章"、"1:1-5" 等
                                    // - 保留書卷名稱和經文座標
                                    // - 只移除明確的 AI 生成引用標記
                                    
                                    // 累積文字並更新打字機
                                    accumulatedText += textValue;
                                    
                                    if (isFirstChunk && accumulatedText.length > 0) {
                                        // 第一次收到內容時，開始打字機效果
                                        startTypewriterEffect(accumulatedText);
                                        isFirstChunk = false;
                                    } else {
                                        // 更新打字機目標
                                        updateTypewriterTarget(accumulatedText);
                                    }
                                }
                            } else if (event === 'thread.run.completed') {
                                finalThreadId = data.thread_id;
                            }
                        } catch (e) {
                            console.error('[ERROR] 解析流數據失敗:', e, line.substring(6));
                        }
                    }
                }
            }
            
            // 確保最終文字完全顯示
            if (accumulatedText && typewriterCurrent !== accumulatedText) {
                // 等待一段時間讓打字機完成，然後強制顯示完整內容
                setTimeout(() => {
                    setMessages(prev => {
                        const newMessages = [...prev];
                        const lastMessage = newMessages[newMessages.length - 1];
                        if (lastMessage && lastMessage.sender === 'bot') {
                            lastMessage.text = accumulatedText;
                        }
                        return newMessages;
                    });
                }, Math.max(0, (accumulatedText.length - typewriterCurrent.length) * 20 + 100));
            }
            
            return { success: true, threadId: finalThreadId };
        } else {
            // 傳統的非流式回應處理
            let data: any = {};
            try {
                const responseText = await response.text();
                if (responseText.trim()) {
                    data = JSON.parse(responseText);
                } else {
                    throw new Error('空響應內容');
                }
            } catch (parseError) {
                console.error('[ERROR] 解析非流式響應失敗:', parseError);
                throw new Error('響應格式無效');
            }

            if (data.success) {
                // 高品質模式：精準清洗回覆，保留重要引用資訊
                const cleanReply = data.reply ? data.reply
                    .replace(/【\d+†】/g, '')         // 特定格式：【1†】、【2†】
                    .replace(/\*\*\d+\*\*/g, '')      // **1**、**2** 等粗體數字
                    .replace(/†\d*(?!\w)/g, '')       // †1、†2 等符號（但保留單詞內的）
                    .replace(/‡\d*(?!\w)/g, '')       // ‡1、‡2 等符號
                    .replace(/§\d*(?!\w)/g, '') : '';  // §1、§2 等符號
                
                // 保留重要資訊：經文引用 (馬太福音 5:3-12)、章節 [第1章] 等
                
                setMessages(prev => [
                    ...prev,
                    { sender: 'user', text: message },
                    { 
                      sender: 'bot', 
                      text: cleanReply, 
                      references: data.references || [] 
                    }
                ]);
                setCurrentThreadId(data.threadId);
            }

            return data;
        }
    } catch (error) {
        // 清理打字機定時器
        if (typewriterTimer) {
          clearTimeout(typewriterTimer);
        }
        
        console.error('[ERROR] 发送消息失败:', error);
        
        // 提供更詳細的錯誤信息
        if (error instanceof Error) {
            if (error.message.includes('Final run has not been received') || 
                error.message.includes('AssistantStream')) {
                setError('串流連接中斷，請重新發送訊息');
            } else if (error.message.includes('token') || error.message.includes('credit')) {
                setError('信用点数不足，发送消息失败');
            } else if (error.message.includes('network') || error.message.includes('timeout')) {
                setError('网络连接问题，发送消息失败');
            } else {
                setError(`发送消息失败: ${error.message}`);
            }
        } else {
            setError('发送消息失败，请稍后重试');
        }
        
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
    setIsLoading,
    refreshHomeschoolData
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