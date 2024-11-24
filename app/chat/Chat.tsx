'use client';

import { useState, useEffect, useRef } from 'react';
import styles from './Chat.module.css';

interface ChatItem {
    Message: string;
    Timestamp: string;
    UserId: string;
}

const Chat = ({ userId }: { userId: string }) => {
    const [messages, setMessages] = useState<{ sender: string; text: string }[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    // 解析消息
    const parseHistoryMessage = (messageStr: string) => {
        try {
            const parsed = JSON.parse(messageStr);
            return [
                { sender: 'user', text: parsed.userMessage },
                { sender: 'bot', text: parsed.botReply }
            ];
        } catch (e) {
            return [];
        }
    };

    // 获取聊天历史记录
    async function fetchHistory() {
        try {
            const response = await fetch(`/api/chat?userId=${userId}`);
            if (!response.ok) {
                throw new Error(`获取聊天历史失败: ${response.status}`);
            }
            const data = await response.json();
            
            // 处理历史消息
            const allMessages = data.flatMap((item: ChatItem) => parseHistoryMessage(item.Message));
            setMessages(allMessages);
            setError('');
            scrollToBottom();
        } catch (err) {
            console.error(err);
            setError('加载聊天历史失败，请稍后重试');
        }
    }

    useEffect(() => {
        if (userId) {
            fetchHistory();
        }
    }, [userId]);

    async function sendMessage() {
        if (!input.trim()) return;

        const newMessage = { sender: 'user', text: input };
        setMessages(prev => [...prev, newMessage]);
        setInput('');
        setLoading(true);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, message: input }),
            });

            if (!response.ok) {
                throw new Error(`发送消息失败: ${response.status}`);
            }

            const data = await response.json();
            const botReply = { sender: 'bot', text: data.reply };
            setMessages(prev => [...prev, botReply]);
            setError('');
            scrollToBottom();
        } catch (err) {
            console.error('发送消息错��:', err);
            setError('发送消息失败，请重试');
        } finally {
            setLoading(false);
        }
    }

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
                    onKeyDown={(e) => e.key === 'Enter' && !loading && sendMessage()}
                    placeholder="输入消息..."
                    className={styles.inputField}
                />

                <button
                    onClick={sendMessage}
                    disabled={loading || !input.trim()}
                    className={styles.sendButton}
                >
                    {loading ? '发送中...' : '发送'}
                </button>
            </div>
        </div>
    );
};

export default Chat;
