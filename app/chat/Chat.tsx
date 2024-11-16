'use client';

import { useState, useEffect, useRef } from 'react';
import styles from './Chat.module.css';

const Chat = ({ userId }: { userId: string }) => {
    // 定义组件状态
    const [messages, setMessages] = useState<{ sender: string; text: string }[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null); // 用于自动滚动到底部

    // 滚动到底部函数
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    // 获取聊天历史记录
    async function fetchHistory() {
        try {
            const response = await fetch(`/api/chat?userId=${userId}`);
            if (!response.ok) {
                throw new Error(`Failed to fetch chat history: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            setMessages(data.history || []);
            setError(''); // 清除错误状态
            scrollToBottom(); // 滚动到底部
        } catch (err) {
            console.error(err);
            setError('Failed to load chat history. Please try again later.');
        }
    }

    // 使用 useEffect 在组件加载时调用 fetchHistory
    useEffect(() => {
        if (!userId) {
            console.error('UserId is required');
            setError('UserId is missing. Cannot load chat history.');
            return;
        }
        fetchHistory();
    }, [userId]);

    // 发送消息
    async function sendMessage() {
        if (!input.trim()) return;

        const newMessage = { sender: 'user', text: input };
        setMessages((prev) => [...prev, newMessage]);
        setInput('');
        setLoading(true);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, message: input }),
            });

            if (!response.ok) {
                throw new Error(`Failed to send message: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const botReply = { sender: 'bot', text: data.reply };

            // 更新消息状态，显示 bot 回复
            setMessages((prev) => [...prev, botReply]);
            setError(''); // 清除错误状态
            scrollToBottom(); // 滚动到底部
        } catch (err) {
            console.error('Error sending message:', err);
            setError('Failed to send message. Please try again.');
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
                        {msg.text}
                    </div>
                ))}
                <div ref={messagesEndRef} /> {/* 用于自动滚动 */}
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.inputArea}>
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !loading && sendMessage()}
                    placeholder="Type your message..."
                    className={styles.inputField} // 更新了样式类名
                />

                <button
                    onClick={sendMessage}
                    disabled={loading || !input.trim()}
                    className={styles.sendButton} // 更新了样式类名
                >
                    {loading ? 'Sending...' : 'Send'}
                </button>
            </div>

        </div>
    );
};

export default Chat;
