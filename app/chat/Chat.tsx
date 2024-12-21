'use client';

import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect, useRef } from 'react';
import styles from './Chat.module.css';

interface ChatItem {
    Message: string;
    Timestamp: string;
    UserId: string;
}

const Chat = () => {
    const { userData, loading } = useAuth();
    const [messages, setMessages] = useState<{ sender: string; text: string }[]>([]);
    const [input, setInput] = useState('');
    const [error, setError] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [isLoading, setIsLoading] = useState(false);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const parseHistoryMessage = (messageStr: string) => {
        try {
            const parsed = JSON.parse(messageStr);
            if (!parsed.userMessage || !parsed.botReply) {
                console.error('Invalid message format:', messageStr);
                return [];
            }
            return [
                { sender: 'user', text: parsed.userMessage },
                { sender: 'bot', text: parsed.botReply }
            ];
        } catch (e) {
            console.error('Failed to parse message:', e);
            return [];
        }
    };

    useEffect(() => {
        async function fetchHistory() {
            if (!userData) return;
            
            try {
                const response = await fetch(`/api/chat?userId=${userData.ID}`);
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(`获取聊天历史失败: ${response.status}`);
                }
                
                const allMessages = data.flatMap((item: ChatItem) => 
                    parseHistoryMessage(item.Message)
                );
                setMessages(allMessages);
                scrollToBottom();
            } catch (err) {
                setError(err instanceof Error ? err.message : '加载失败');
            }
        }

        if (userData) {
            fetchHistory();
        }
    }, [userData]);

    const sendMessage = async () => {
        if (!input.trim() || !userData) return;
        setIsLoading(true);
        const currentInput = input;
        setInput('');
        
        // 添加重试逻辑
        const maxRetries = 2;
        let retryCount = 0;

        while (retryCount <= maxRetries) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        userId: userData.ID,
                        message: currentInput 
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    if (response.status === 504 && retryCount < maxRetries) {
                        console.log(`[DEBUG] 重试 ${retryCount + 1}/${maxRetries}`);
                        retryCount++;
                        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                        continue;
                    }
                    throw new Error(await response.text() || '发送失败');
                }

                const data = await response.json();
                setMessages(prev => [...prev, 
                    { sender: 'user', text: currentInput },
                    { sender: 'bot', text: data.reply }
                ]);
                break;

            } catch (err) {
                console.error('[ERROR]:', err);
                if (retryCount === maxRetries) {
                    setError(err instanceof Error ? err.message : '发送失败');
                    setInput(currentInput); // 恢复输入
                } else {
                    retryCount++;
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                    continue;
                }
            }
        }

        setIsLoading(false);
        scrollToBottom();
    };

    if (loading) return <div>加载中...</div>;
    if (!userData) return <div>请登录后使用</div>;

    return (
        <div className={styles.chatWindow}>
            <div className={styles.messages}>
                {messages.map((msg, index) => (
                    <div
                        key={index}
                        className={`${styles.message} ${msg.sender === 'user' ? styles.user : styles.bot}`}
                    >
                        {msg.sender === 'bot' && (
                            <img 
                                src="https://logos-world.net/wp-content/uploads/2023/02/ChatGPT-Logo.png"
                                alt="AI Avatar" 
                                className={styles.avatar}
                            />
                        )}
                        <div className={styles.messageContent}>
                            {msg.text}
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.inputArea}>
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !isLoading && sendMessage()}
                    placeholder="输入消息..."
                    className={styles.inputField}
                    disabled={isLoading}
                />
                <button
                    onClick={sendMessage}
                    disabled={!input.trim() || isLoading}
                    className={styles.sendButton}
                >
                    {isLoading ? '发送中...' : '发送'}
                </button>
            </div>
        </div>
    );
};

export default Chat;
