"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';

interface ChatConfig {
  type: string;
  assistantId: string;
  vectorStoreId: string;
  userId?: string;
}

interface ChatContextType {
  config: ChatConfig;
  setConfig: (config: Partial<ChatConfig>) => void;
  messages: Array<{ sender: string; text: string }>;
  setMessages: React.Dispatch<React.SetStateAction<Array<{ sender: string; text: string }>>>;
  currentThreadId: string | null;
  setCurrentThreadId: (threadId: string | null) => void;
  sendMessage: (message: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

const ChatContext = createContext<ChatContextType | null>(null);

export function ChatProvider({ 
  children,
  initialConfig = {
    assistantId: ASSISTANT_IDS.GENERAL,
    vectorStoreId: VECTOR_STORE_IDS.GENERAL,
    type: 'general'
  }
}: {
  children: React.ReactNode;
  initialConfig?: ChatConfig;
}) {
  const [config, setConfigState] = useState<ChatConfig>(initialConfig);
  const [messages, setMessages] = useState<Array<{ sender: string; text: string }>>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setConfig = useCallback((newConfig: Partial<ChatConfig>) => {
    setConfigState(prev => ({
      ...prev,
      ...newConfig
    }));
  }, []);

  useEffect(() => {
    setMessages([]);
    setCurrentThreadId(null);
    setError(null);
  }, [config.assistantId, config.vectorStoreId, config.type]);

  const sendMessage = useCallback(async (message: string) => {
    if (!message.trim() || isLoading) return;
    
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message,
          threadId: currentThreadId,
          assistantId: config.assistantId,
          vectorStoreId: config.vectorStoreId,
          type: config.type
        })
      });

      if (!response.ok) {
        throw new Error('发送消息失败');
      }

      const data = await response.json();
      
      setMessages(prev => [
        ...prev,
        { sender: 'user', text: message },
        { sender: 'bot', text: data.reply }
      ]);
      
      if (data.threadId && !currentThreadId) {
        setCurrentThreadId(data.threadId);
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setIsLoading(false);
    }
  }, [currentThreadId, config, isLoading]);

  const value = {
    config,
    setConfig,
    messages,
    setMessages,
    currentThreadId,
    setCurrentThreadId,
    sendMessage,
    isLoading,
    error
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