"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';
import { ChatType } from '../config/chatTypes';
import { useAuth } from '../contexts/AuthContext';
import { getConcernLabel } from '../types/homeschool';

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
  id?: string;
  isThinking?: boolean;
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

// 串流控制配置
const SHOW_THINKING_ONLY = true;   // 改為 true 等待完整回復後顯示
const SMART_FILTERING = false;     // 關閉智能過濾，使用 thinking only 模式

// 智能過濾配置參數 - 極速優化版
const STREAM_CONFIG = {
  MIN_BUFFER_LENGTH: 1,           // 最小緩衝長度減至 1
  MIN_VALID_CHARS: 1,             // 最少連續有效字符減至 1  
  SHOW_THINKING_DELAY: 0,         // 移除延遲，立即顯示 (原 25ms)
  ENABLE_DEBUG_LOG: false         // 關閉調試日誌
};

// 智能過濾函數
const smartFilter = {
  // 過濾無效內容 - 加強版
  isValidChunk: (text: string): boolean => {
    // 基本類型檢查
    if (!text || typeof text !== 'string') return false;
    
    // 明確的無效值檢查（不區分大小寫）
    const normalizedText = text.toLowerCase().trim();
    const invalidValues = ['undefined', 'null', 'nan', 'false', 'true'];
    if (invalidValues.includes(normalizedText)) return false;
    
    // 檢查是否只有空白字符
    if (/^[\s\n\r\t]*$/.test(text)) return false;
    
    // 檢查字串長度（太短可能是誤讀）
    if (text.trim().length === 0) return false;
    
    return true;
  },

  // 檢查是否為贅字模式 - 加強版
  isGarbagePattern: (text: string): boolean => {
    if (!text) return true;
    
    const cleanText = text.trim().toLowerCase();
    
    // 空字串或太短
    if (cleanText.length === 0 || cleanText.length === 1) return true;
    
    // 常見贅字模式
    const garbagePatterns = [
      /^[\{\[\(\)\]\}]*$/,                    // 只有括號
      /^[,.\-_\s]*$/,                         // 只有標點和空白
      /^(undefined|null|nan|false|true)$/i,   // 明確無效值
      /^[\d\s]*$/,                            // 只有數字和空白
      /^\s*[\[\{].*[\}\]]\s*$/,              // JSON 片段
      /^[^a-zA-Z\u4e00-\u9fff]*$/,           // 沒有任何字母或中文
      /^[\s\n\r\t]+$/,                       // 只有各種空白符
      /^[^\w\u4e00-\u9fff]+$/,               // 沒有字母數字中文，只有符號
      /^(\.{3,}|\-{3,}|_{3,})$/,             // 重複符號
    ];
    
    return garbagePatterns.some(pattern => pattern.test(cleanText));
  },

  // 清理文本內容 - 修復版本，保留格式
  cleanText: (text: string): string => {
    if (!text) return '';
    
    return text
      // 移除引用標記
      .replace(/【\d+†】/g, '')
      .replace(/\*\*\d+\*\*/g, '')
      .replace(/†\d*(?!\w)/g, '')
      .replace(/‡\d*(?!\w)/g, '')
      .replace(/§\d*(?!\w)/g, '')
      // 移除 undefined 等無效值（即使夾在其他文字中）
      .replace(/\bundefined\b/gi, '')
      .replace(/\bnull\b/gi, '')
      .replace(/\bNaN\b/gi, '')
      // 保留換行符，只清理連續的空格（不影響換行）
      .replace(/[^\S\n]+/g, ' ')  // 只替換非換行的空白字符
      .replace(/( *\n *)/g, '\n') // 清理換行前後的空格但保留換行
      .trim();
  },

  // 累積緩衝區判斷是否開始輸出 - 加強版
  shouldStartShowing: (buffer: string): boolean => {
    if (!buffer || buffer.length < STREAM_CONFIG.MIN_BUFFER_LENGTH) return false;
    
    // 清理後再檢查
    const cleaned = smartFilter.cleanText(buffer);
    if (cleaned.length < STREAM_CONFIG.MIN_BUFFER_LENGTH) return false;
    
    // 檢查是否包含有意義內容
    const hasValidContent = new RegExp(`[a-zA-Z\\u4e00-\\u9fff]{${STREAM_CONFIG.MIN_VALID_CHARS},}`).test(cleaned);
    const isNotGarbage = !smartFilter.isGarbagePattern(cleaned.slice(0, 30));
    
    // 確保不是以無效值開頭
    const startsWithInvalid = /^(undefined|null|nan|false|true)/i.test(cleaned);
    
    return hasValidContent && isNotGarbage && !startsWithInvalid;
  }
};

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
          typewriterTimer = setTimeout(typeNextChar, 5); // 5ms 每個字符，極快
        } else if (typewriterIndex < typewriterTarget.length) {
          // 如果目標文字變長了，繼續打字
          typewriterTimer = setTimeout(typeNextChar, 5);
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
            
            typewriterTimer = setTimeout(typeNextChar, 5);
          }
        };
        typewriterTimer = setTimeout(typeNextChar, 5);
      }
    };

    try {
        // 先添加使用者訊息 (暫存) 並記錄索引，若 409 將回滾
        let insertedUserIndex: number | null = null;
        setMessages(prev => {
          const next = [...prev, { sender: 'user', text: message }];
          insertedUserIndex = next.length - 1;
          return next;
        });
        
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

        // 若為 homeschool，在建立回應前構建標頭摘要
        let replyHeader = '';
        try {
          if (config?.type === 'homeschool' && config?.userId) {
            const hsRes = await fetch(`/api/homeschool-prompt?userId=${config.userId}`);
            if (hsRes.ok) {
              const hs = await hsRes.json();
              const parts: string[] = [];
              if (typeof hs.age === 'number') parts.push(`年齡：${hs.age} 歲`);
              if (hs.gender) parts.push(`性別：${hs.gender === 'male' ? '男孩' : '女孩'}`);
              if (Array.isArray(hs.concerns) && hs.concerns.length > 0) {
                const labels = hs.concerns.map((c: string) => getConcernLabel(c));
                const extra = hs.concerns.includes('other') && hs.otherConcern ? `（${hs.otherConcern}）` : '';
                parts.push(`主要關注：${labels.join('、')}${extra}`);
              }
              if (parts.length) replyHeader = `學生資料：${parts.join('；')}\n\n`;
            }
          }
        } catch {}

        // 確保 userId 存在並記錄請求資訊
        const requestUserId = config?.userId;
        console.log('[DEBUG] 準備發送聊天請求到 API:', {
          hasUserId: !!requestUserId,
          userId: requestUserId || 'NO_USER_ID',
          threadId: currentThreadId || 'NO_THREAD',
          assistantId: config?.assistantId,
          timestamp: new Date().toISOString()
        });
        
        if (!requestUserId) {
          console.error('[ERROR] ❌ userId 缺失！無法記錄 token 使用量');
        }
        
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message,
                threadId: currentThreadId,
                userId: requestUserId,
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
      if (response.status === 409) {
        // Busy / Locked：不視為紅色錯誤，提示稍後再試
        let info: any = {};
        try { info = await response.json(); } catch {}
        const readable = info.message || '上一輪回覆尚未完成，請稍候…';
        // 回滾剛剛的 user 訊息（避免累積）
        if (insertedUserIndex !== null) {
          setMessages(prev => prev.filter((_, i) => i !== insertedUserIndex));
        }
        setError(readable); // 使用既有錯誤區塊顯示，但語義是資訊
        setIsLoading(false);
        return; // 結束本次 send
      }
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
            // 建立占位訊息
            const assistantTempId = `assistant_${Date.now()}`;
            
            // 智能過濾狀態
            let textBuffer = '';           // 累積緩衝
            let hasStartedShowing = false; // 是否已開始顯示
            let displayedText = '';        // 已顯示的文字
            
            if (SHOW_THINKING_ONLY) {
              // 思考模式：先顯示學生資料摘要（如果有）
              const initialText = replyHeader ? `${replyHeader}AI 正在思考中...` : 'AI 正在思考中...';
              setMessages(prev => [...prev, { sender: 'bot', text: initialText, id: assistantTempId, isThinking: true }]);
            } else if (SMART_FILTERING) {
              // 智能過濾模式：先顯示學生資料摘要（如果有）
              const initialText = replyHeader ? `${replyHeader}AI 正在思考中...` : 'AI 正在思考中...';
              setMessages(prev => [...prev, { sender: 'bot', text: initialText, id: assistantTempId, isThinking: true }]);
            } else {
              // 在原始即時模式下，先放入學生資料摘要作為回覆開頭
              const initialText = replyHeader || 'AI正在思考中，請稍候...';
              setMessages(prev => [...prev, { sender: 'bot', text: initialText, id: assistantTempId, references: [] }]);
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error('無法讀取響應流');
            const decoder = new TextDecoder();
            let buffer = '';

            try {
              while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                const chunks = buffer.split('\n\n');
                buffer = chunks.pop() || '';

                for (const chunk of chunks) {
                  const lines = chunk.split('\n').filter(l => l.startsWith('data:'));
                  for (const line of lines) {
                    const jsonStr = line.replace(/^data:\s*/, '').trim();
                    if (!jsonStr || jsonStr === '[DONE]') continue;
                    
                    let evt: any;
                    try { evt = JSON.parse(jsonStr); } catch { continue; }

                    const eventType = evt.event;
                    
                    if (eventType === 'thread.message.delta') {
                      const contents = evt.data?.delta?.content;
                      if (Array.isArray(contents)) {
                        for (const c of contents) {
                          let deltaText = '';
                          if (c.type === 'text' && c.text?.value) {
                            deltaText = c.text.value;
                          } else if (c.type === 'output_text_delta' && c.delta?.text) {
                            deltaText = c.delta.text;
                          } else if (c.type === 'output_text' && c.text?.value) {
                            deltaText = c.text.value;
                          }

                          // 清洗文本 - 只在智能過濾模式下清理
                          if (deltaText && SMART_FILTERING) {
                            deltaText = smartFilter.cleanText(deltaText);
                          }

                          if (SHOW_THINKING_ONLY) {
                            // 思考模式：直接累積所有內容，不過濾
                            if (deltaText) {
                              textBuffer += deltaText;
                            }
                          } else if (SMART_FILTERING) {
                            // 智能過濾模式 - 雙重檢查
                            if (smartFilter.isValidChunk(deltaText) && deltaText.trim() && !smartFilter.isGarbagePattern(deltaText)) {
                              textBuffer += deltaText;
                              
                              if (STREAM_CONFIG.ENABLE_DEBUG_LOG) {
                                console.log(`[FILTER] Valid chunk: "${deltaText}", Buffer: "${textBuffer.slice(-30)}", HasStarted: ${hasStartedShowing}`);
                              }
                              
                              if (!hasStartedShowing) {
                                // 檢查是否可以開始顯示
                                if (smartFilter.shouldStartShowing(textBuffer)) {
                                  hasStartedShowing = true;
                                  displayedText = replyHeader + textBuffer; // 加上學生資料
                                  setMessages(prev => prev.map(m => {
                                    if (m.id === assistantTempId) {
                                      return { ...m, text: displayedText, isThinking: false };
                                    }
                                    return m;
                                  }));
                                }
                              } else {
                                // 已開始顯示，繼續累加
                                displayedText = replyHeader + textBuffer; // 加上學生資料
                                setMessages(prev => prev.map(m => {
                                  if (m.id === assistantTempId) {
                                    return { ...m, text: displayedText };
                                  }
                                  return m;
                                }));
                              }
                            } else if (STREAM_CONFIG.ENABLE_DEBUG_LOG && deltaText) {
                              console.log(`[FILTER] Rejected chunk: "${deltaText}"`);
                            }
                          } else {
                            // 原始即時模式 - 但仍要過濾明顯無效內容
                            if (smartFilter.isValidChunk(deltaText) && deltaText.trim()) {
                              setMessages(prev => prev.map(m => {
                                if (m.id === assistantTempId) {
                                  const currentText = m.text === 'AI正在思考中，請稍候...' ? replyHeader : (m.text || replyHeader);
                                  return { ...m, text: currentText + deltaText };
                                }
                                return m;
                              }));
                            }
                          }
                        }
                      }
                    } else if (eventType === 'thread.run.completed' || evt.event === 'done') {
                      // 確保最終內容正確顯示
                      if ((SHOW_THINKING_ONLY || SMART_FILTERING) && textBuffer) {
                        if (!hasStartedShowing || SHOW_THINKING_ONLY) {
                          // 如果到最後都沒開始顯示，或是思考模式，直接顯示全部內容（包含學生資料）
                          const finalText = replyHeader + (textBuffer || '');
                          setMessages(prev => prev.map(m => {
                            if (m.id === assistantTempId) {
                              return { ...m, text: finalText || '(無內容)', isThinking: false };
                            }
                            return m;
                          }));
                        } else {
                          // 智能過濾模式且已開始顯示，確保最終狀態正確
                          setMessages(prev => prev.map(m => {
                            if (m.id === assistantTempId) {
                              return { ...m, isThinking: false };
                            }
                            return m;
                          }));
                        }
                      }
                      setIsLoading(false);
                      return;
                    } else if (
                      eventType === 'thread.run.failed' || 
                      eventType === 'thread.run.cancelled' || 
                      eventType === 'thread.run.expired'
                    ) {
                      setMessages(prev => prev.map(m => {
                        if (m.id === assistantTempId) {
                          return { ...m, text: '（生成失敗，請重試）', isThinking: false };
                        }
                        return m;
                      }));
                      setIsLoading(false);
                      return;
                    }
                  }
                }
              }
            } catch (streamError) {
              console.error('[STREAM ERROR]', streamError);
              setMessages(prev => prev.map(m => {
                if (m.id === assistantTempId) {
                  return { ...m, text: '（串流發生錯誤，請重試）', isThinking: false };
                }
                return m;
              }));
            } finally {
              try { reader.releaseLock(); } catch {}
            }
            
            setIsLoading(false);
            return;
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
        // 如果是 homeschool 類型，先獲取學生資料摘要
        let studentSummary = '';
        if (config?.type === 'homeschool') {
            try {
                const hsRes = await fetch(`/api/homeschool-prompt?userId=${userId}`);
                if (hsRes.ok) {
                    const hs = await hsRes.json();
                    const parts: string[] = [];
                    if (typeof hs.age === 'number') parts.push(`年齡：${hs.age} 歲`);
                    if (hs.gender) parts.push(`性別：${hs.gender === 'male' ? '男孩' : '女孩'}`);
                    if (Array.isArray(hs.concerns) && hs.concerns.length > 0) {
                        const labels = hs.concerns.map((c: string) => getConcernLabel(c));
                        const extra = hs.concerns.includes('other') && hs.otherConcern ? `（${hs.otherConcern}）` : '';
                        parts.push(`主要關注：${labels.join('、')}${extra}`);
                    }
                    if (parts.length) {
                        studentSummary = `📋 學生資料：${parts.join('；')}\n\n`;
                    }
                }
            } catch (e) {
                console.warn('[WARN] 獲取學生資料摘要失敗:', e);
            }
        }

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

        const data = await response.json();
        
        console.log('[DEBUG] 收到的訊息數量:', data.messages?.length);
        console.log('[DEBUG] 所有訊息:', data.messages);
        console.log('[DEBUG] 第一條訊息:', data.messages?.[0]);
        console.log('[DEBUG] 第一條訊息 role:', data.messages?.[0]?.role);
        console.log('[DEBUG] 第一條訊息 content:', data.messages?.[0]?.content);

        if (data.success && Array.isArray(data.messages)) {
            const formattedMessages = data.messages.map((msg: any, index: number) => {
                const content = msg.content || '';
                
                // 為第一條 bot 訊息加上學生資料摘要（只有當訊息中還沒有時）
                if (studentSummary && index === 0 && msg.role !== 'user' && !content.startsWith('📋 學生資料：')) {
                    console.log('[DEBUG] 為第一條訊息加上學生資料摘要');
                    return {
                        sender: 'bot',
                        text: studentSummary + content,
                        references: msg.references || []
                    };
                }
                return {
                    sender: msg.role === 'user' ? 'user' : 'bot',
                    text: content,
                    references: msg.references || []
                };
            });
            
            console.log('[DEBUG] 格式化後的訊息數量:', formattedMessages.length);
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