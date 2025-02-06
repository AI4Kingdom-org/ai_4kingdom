'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Chat from "../components/Chat/Chat";
import { CHAT_TYPES } from "@/app/config/chatTypes";
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from "../config/constants";
import { ChatProvider, useChat } from '../contexts/ChatContext';
import styles from './Homeschool.module.css';

function HomeschoolContent() {
    const { user, loading: authLoading } = useAuth();
    const { setConfig } = useChat();
    const [assistantId, setAssistantId] = useState(ASSISTANT_IDS.HOMESCHOOL);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        async function fetchAssistantId() {
            if (!user?.user_id) return;

            try {
                const response = await fetch(`/api/homeschool-prompt?userId=${user.user_id}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.assistantId) {
                        setAssistantId(data.assistantId);
                        setConfig({
                            type: CHAT_TYPES.HOMESCHOOL,
                            assistantId: data.assistantId,
                            vectorStoreId: VECTOR_STORE_IDS.HOMESCHOOL,
                            userId: user?.user_id
                        });
                    }
                }
            } catch (error) {
                console.error('获取 Assistant ID 失败:', error);
            } finally {
                setIsLoading(false);
            }
        }

        if (user?.user_id) {
            fetchAssistantId();
        }
    }, [user?.user_id, setConfig]);

    if (authLoading || isLoading) {
        return <div>加载中...</div>;
    }

    if (!user) {
        return <div>请先登录后使用</div>;
    }

    return (
        <div className={styles.container}>
            <Chat 
                type={CHAT_TYPES.HOMESCHOOL}
                assistantId={assistantId}
                vectorStoreId={VECTOR_STORE_IDS.HOMESCHOOL}
            />
        </div>
    );
}

export default function Homeschool() {
    const { user } = useAuth();
    
    console.log('[DEBUG] Homeschool页面初始化:', {
        userId: user?.user_id,
        assistantId: ASSISTANT_IDS.HOMESCHOOL,
        vectorStoreId: VECTOR_STORE_IDS.HOMESCHOOL
    });
    
    if (!user?.user_id) {
        return null;
    }

    return (
        <ChatProvider initialConfig={{
            type: CHAT_TYPES.HOMESCHOOL,
            assistantId: ASSISTANT_IDS.HOMESCHOOL,
            vectorStoreId: VECTOR_STORE_IDS.HOMESCHOOL,
            userId: user.user_id
        }}>
            <HomeschoolContent />
        </ChatProvider>
    );
}