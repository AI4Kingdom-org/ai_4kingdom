'use client';

import { useState } from 'react';
import AssistantManager from '../components/AssistantManager';
import TranscriptionEditor from '../components/TranscriptionEditor';
import YouTubeUploader from '../components/YouTubeUploader';
import DocumentUploader from '../components/DocumentUploader';
import Chat from '../components/Chat/Chat';
import WithChat from '../components/layouts/WithChat';
import styles from './SundayGuide.module.css';

export default function SundayGuide() {
  const [selectedAssistant, setSelectedAssistant] = useState<{
    assistantId: string;
    vectorStoreId?: string;
  } | null>(null);

  const handleAssistantSelect = async (assistantId: string, vectorStoreId?: string) => {
    try {
      console.log('[DEBUG] 选择助手:', { assistantId, vectorStoreId });
      
      // 更新所有其他助手状态为非活跃
      const response = await fetch('/api/sunday-guide/assistants/deactivate-all', {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error('更新助手状态失败');
      }
      console.log('[DEBUG] 所有助手已设置为非活跃');

      // 设置选中的助手为活跃状态
      const activateResponse = await fetch(`/api/sunday-guide/assistants/${assistantId}/activate`, {
        method: 'POST'
      });

      if (!activateResponse.ok) {
        throw new Error('激活助手失败');
      }
      console.log('[DEBUG] 助手激活成功:', { assistantId, vectorStoreId });

      setSelectedAssistant({ assistantId, vectorStoreId });
      
    } catch (error) {
      console.error('[ERROR] 选择助手失败:', error);
    }
  };

  const handleVectorStoreCreated = async (vectorStoreId: string) => {
    console.log('新的 Vector Store 创建成功:', vectorStoreId);
    
    // 如果当前有选中的助手，更新其 vectorStoreId
    if (selectedAssistant?.assistantId) {
      try {
        // 调用 API 更新助手信息
        const response = await fetch(`/api/sunday-guide/assistants/${selectedAssistant.assistantId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            vectorStoreId
          })
        });

        if (!response.ok) {
          throw new Error('更新助手失败');
        }

        // 更新本地状态
        setSelectedAssistant(prev => prev ? {
          ...prev,
          vectorStoreId
        } : null);

        console.log('助手 vectorStoreId 更新成功');
      } catch (error) {
        console.error('更新助手 vectorStoreId 失败:', error);
      }
    }
  };

  return (
    <WithChat>
      <div className={styles.container}>
        <h1 className={styles.title}>Sunday Guide</h1>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>YouTube 上传</h2>
          <YouTubeUploader onVectorStoreCreated={handleVectorStoreCreated} />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>助手管理</h2>
          <AssistantManager onAssistantSelect={handleAssistantSelect} />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>转录文本编辑</h2>
          <TranscriptionEditor assistantId={selectedAssistant?.assistantId || null} />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>文档上传</h2>
          <DocumentUploader
            assistantId={selectedAssistant?.assistantId}
            vectorStoreId={selectedAssistant?.vectorStoreId}
          />
        </section>
      </div>
    </WithChat>
  );
} 