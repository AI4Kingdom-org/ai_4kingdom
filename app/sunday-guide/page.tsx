'use client';

import { useState } from 'react';
import AssistantManager from '../components/AssistantManager';
import WithChat from '../components/layouts/WithChat';
import { useCredit } from '../contexts/CreditContext';
import UserIdDisplay from '../components/UserIdDisplay';
import styles from './SundayGuide.module.css';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';

interface ProcessedContent {
  summary: string;
  fullText: string;
  devotional: string;
  bibleStudy: string;
}

export default function SundayGuide() {
  const { refreshUsage } = useCredit(); // 引入信用點數更新函數
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedContent, setProcessedContent] = useState<ProcessedContent | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadTime, setUploadTime] = useState<string>('');

  const handleFileProcessed = async (content: ProcessedContent) => {
    setProcessedContent(content);
    setIsProcessing(false);
    
    // 文件處理完成後立即刷新信用點數使用量
    await refreshUsage();
  };

  return (
    <WithChat>
      <div className={styles.container}>
      <UserIdDisplay />
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>“文件上传与处理</h2>
          <AssistantManager 
            onFileProcessed={handleFileProcessed} 
            setIsProcessing={setIsProcessing} 
            setUploadProgress={setUploadProgress}
            setUploadTime={setUploadTime}
          />
          {uploadTime && (
            <div className={styles.uploadTimeContainer}>
              <p>处理完成时间: {uploadTime}</p>
            </div>
          )}
        </section>

        {processedContent && !isProcessing && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>处理结果预览</h2>
            <div className={styles.previewContainer}>
              <div className={styles.previewSection}>
                <h3>信息总结</h3>
                <div className={styles.previewContent}>{processedContent.summary}</div>
              </div>
              {/* <div className={styles.previewSection}>
                <h3>信息文字</h3>
                <div className={styles.previewContent}>{processedContent.fullText}</div>
              </div> */}
              <div className={styles.previewSection}>
                <h3>每日灵修</h3>
                <div className={styles.previewContent}>{processedContent.devotional}</div>
              </div>
              <div className={styles.previewSection}>
                <h3>查经指引</h3>
                <div className={styles.previewContent}>{processedContent.bibleStudy}</div>
              </div>
            </div>
          </section>
        )}
      </div>
    </WithChat>
  );
}