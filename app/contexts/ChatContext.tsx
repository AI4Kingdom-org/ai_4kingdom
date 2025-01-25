"use client";

import React, { createContext, useContext, useState, useCallback } from 'react';
import { ASSISTANT_ID, VECTOR_STORE_ID } from '../config/constants';

interface ChatConfig {
  type: string;
  assistantId: string;
  vectorStoreId: string;
  userId?: string;
}

interface ChatContextType {
  config: ChatConfig;
  setConfig: (config: ChatConfig) => void;
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
    assistantId: ASSISTANT_ID,
    vectorStoreId: VECTOR_STORE_ID,
    type: 'general'
  }
}: {
  children: React.ReactNode;
  initialConfig?: ChatConfig;
}) {
  const [config, setConfig] = useState<ChatConfig>(initialConfig);
  const [messages, setMessages] = useState<Array<{ sender: string; text: string }>>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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