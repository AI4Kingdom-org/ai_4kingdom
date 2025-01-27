'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Chat from "@/app/components/Chat/Chat";
import { CHAT_TYPES } from "@/app/config/chatTypes";
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from "../config/constants";
import { ChatProvider } from '../contexts/ChatContext';

function HomeschoolContent() {
    const { user } = useAuth();
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
                    }
                }
            } catch (error) {
                console.error('获取 Assistant ID 失败:', error);
            } finally {
                setIsLoading(false);
            }
        }

        fetchAssistantId();
    }, [user?.user_id]);

    if (isLoading) {
        return <div>加载中...</div>;
    }

    return (
        <Chat 
            type={CHAT_TYPES.HOMESCHOOL}
            assistantId={assistantId}
            vectorStoreId={VECTOR_STORE_IDS.HOMESCHOOL}
        />
    );
}

export default function Homeschool() {
    return (
        <ChatProvider initialConfig={{
            type: CHAT_TYPES.HOMESCHOOL,
            assistantId: ASSISTANT_IDS.HOMESCHOOL,
            vectorStoreId: VECTOR_STORE_IDS.HOMESCHOOL
        }}>
            <HomeschoolContent />
        </ChatProvider>
    );
}