'use client';

import { useState, useEffect } from 'react';
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
  const { refreshUsage, hasInsufficientTokens, remainingCredits } = useCredit();
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedContent, setProcessedContent] = useState<ProcessedContent | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadTime, setUploadTime] = useState<string>('');
  const [isUploadDisabled, setIsUploadDisabled] = useState(false);
  // 添加最新文件記錄的狀態
  const [latestFile, setLatestFile] = useState<{ fileName: string, uploadDate: string } | null>(null);
  // 添加是否顯示前次記錄的狀態
  const [showLatestFile, setShowLatestFile] = useState(true);

  // 檢查用戶是否有足夠的 Credits
  useEffect(() => {
    // 只有當確實沒有剩餘 Credits 時才禁用上傳
    setIsUploadDisabled(remainingCredits <= 0);
  }, [remainingCredits, hasInsufficientTokens]);
  
  // 獲取最新的文件記錄
  const fetchLatestFileRecord = async () => {
    try {
      const response = await fetch(`/api/sunday-guide/documents?assistantId=${ASSISTANT_IDS.SUNDAY_GUIDE}`);
      if (!response.ok) throw new Error('獲取文件記錄失敗');
      
      const data = await response.json();
      if (data.success && data.records && data.records.length > 0) {
        // 按時間排序，獲取最新記錄
        const latestRecord = [...data.records].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )[0];
        
        // 只保留日期部分（去除時分秒）
        const uploadDate = new Date(latestRecord.updatedAt);
        const dateOnly = uploadDate.toLocaleDateString('en-US', { 
          timeZone: 'America/Los_Angeles',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        
        setLatestFile({
          fileName: latestRecord.fileName || '未命名文件',
          uploadDate: dateOnly
        });
      }
    } catch (error) {
      console.error('獲取文件記錄失敗:', error);
    }
  };
  
  // 組件掛載時獲取最新的文件記錄
  useEffect(() => {
    fetchLatestFileRecord();
  }, []);

  // 當有處理結果時，隱藏前次上傳記錄
  useEffect(() => {
    if (processedContent) {
      setShowLatestFile(false);
    } else {
      setShowLatestFile(true);
    }
  }, [processedContent]);

  const handleFileProcessed = async (content: ProcessedContent) => {
    setProcessedContent(content);
    setIsProcessing(false);
    
    // 文件處理完成後重新獲取最新的文件記錄並刷新信用點數使用量
    await fetchLatestFileRecord();
    await refreshUsage();
  };

  return (
    <WithChat>
      <div className={styles.container}>
      <UserIdDisplay />
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>文件上传与处理</h2>
          {isUploadDisabled && (
            <div className={styles.creditWarning}>
              <p>您的 Token 额度不足！请升级会员以获取更多 Credits。</p>
            </div>
          )}
          {!isUploadDisabled && remainingCredits < 20 && (
            <div className={styles.creditWarning} style={{ backgroundColor: '#fff8e0', color: '#b7791f', borderLeft: '4px solid #ecc94b' }}>
              <p>您的 Credits 余额较低 (剩余 {remainingCredits} Credits)，请注意使用。</p>
            </div>
          )}
          <AssistantManager 
            onFileProcessed={handleFileProcessed} 
            setIsProcessing={setIsProcessing} 
            setUploadProgress={setUploadProgress}
            setUploadTime={setUploadTime}
            disabled={isUploadDisabled} // 使用新的狀態來控制按鈕的禁用
          />
          {uploadTime && (
            <div className={styles.uploadTimeContainer}>
              <p>处理完成时间: {uploadTime}</p>
            </div>
          )}
          
          {/* 顯示最新上傳的文檔記錄，但只在沒有處理結果時顯示 */}
          {showLatestFile && latestFile && !isProcessing && (
            <div className={styles.latestFileRecord}>
              <h3>前次上传文档:</h3>
              <div className={styles.fileRecordContent}>
                <div className={styles.fileNameBox}>
                  <span className={styles.fileIcon}>📄</span>
                  <span>{latestFile.fileName}</span>
                </div>
                <div className={styles.uploadDateBox}>
                  <span className={styles.timeIcon}>📅</span>
                  <span>上传日期: {latestFile.uploadDate}</span>
                </div>
              </div>
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