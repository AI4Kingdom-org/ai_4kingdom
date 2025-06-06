'use client';

import { useState, useEffect } from 'react';
import AssistantManager from '../components/AssistantManager';
import WithChat from '../components/layouts/WithChat';
import { useCredit } from '../contexts/CreditContext';
import UserIdDisplay from '../components/UserIdDisplay';
import styles from './SundayGuide.module.css';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';
import { useAuth } from '../contexts/AuthContext';

interface ProcessedContent {
  summary: string;
  fullText: string;
  devotional: string;
  bibleStudy: string;
}

export default function SundayGuide() {
  const { refreshUsage, hasInsufficientTokens, remainingCredits } = useCredit();
  const { user } = useAuth(); // 取得當前登入用戶
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedContent, setProcessedContent] = useState<ProcessedContent | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadTime, setUploadTime] = useState<string>('');
  const [isUploadDisabled, setIsUploadDisabled] = useState(false);
  // 添加最新文件記錄的狀態
  const [latestFile, setLatestFile] = useState<{ fileName: string, uploadDate: string } | null>(null);
  // 添加是否顯示前次記錄的狀態
  const [showLatestFile, setShowLatestFile] = useState(true);
  // 新增：右側顯示當月上傳的五筆檔案記錄
  const [recentFiles, setRecentFiles] = useState<Array<{ fileName: string, uploadDate: string }>>([]);
  // 新增：本月是否已達上傳上限
  const [isMonthlyLimitReached, setIsMonthlyLimitReached] = useState(false);

  // 檢查用戶是否有足夠的 Credits
  useEffect(() => {
    // 只有當確實沒有剩餘 Credits 時才禁用上傳
    setIsUploadDisabled(remainingCredits <= 0);
  }, [remainingCredits, hasInsufficientTokens]);
  
  // 獲取最新的文件記錄（只查詢當前用戶）
  const fetchLatestFileRecord = async () => {
    if (!user?.user_id) {
      setLatestFile(null);
      return;
    }
    try {
      const response = await fetch(`/api/sunday-guide/documents?assistantId=${ASSISTANT_IDS.SUNDAY_GUIDE}&userId=${user.user_id}`);
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
      } else {
        setLatestFile(null);
      }
    } catch (error) {
      setLatestFile(null);
      console.error('獲取文件記錄失敗:', error);
    }
  };
  
  // 取得本月五筆最新檔案
  const fetchRecentFiles = async () => {
    if (!user?.user_id) {
      setRecentFiles([]);
      setIsMonthlyLimitReached(false);
      return;
    }
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const monthStart = `${year}-${month}-01T00:00:00.000Z`;
      // 查詢本月所有檔案
      const response = await fetch(`/api/sunday-guide/documents?assistantId=${ASSISTANT_IDS.SUNDAY_GUIDE}&userId=${user.user_id}`);
      if (!response.ok) throw new Error('獲取檔案記錄失敗');
      const data = await response.json();
      if (data.success && data.records && data.records.length > 0) {
        // 過濾本月檔案並排序
        const monthFiles = data.records.filter((rec: any) => {
          const d = new Date(rec.updatedAt);
          return d >= new Date(monthStart);
        }).sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        setRecentFiles(monthFiles.slice(0, 5).map((rec: any) => ({
          fileName: rec.fileName || '未命名文件',
          uploadDate: new Date(rec.updatedAt).toLocaleDateString('en-US', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          })
        })));
        setIsMonthlyLimitReached(monthFiles.length >= 5);
      } else {
        setRecentFiles([]);
        setIsMonthlyLimitReached(false);
      }
    } catch (error) {
      setRecentFiles([]);
      setIsMonthlyLimitReached(false);
      console.error('獲取檔案記錄失敗:', error);
    }
  };

  // 組件掛載時獲取最新的文件記錄
  useEffect(() => {
    fetchLatestFileRecord();
    fetchRecentFiles();
  }, [user]);

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
    await fetchRecentFiles(); // 新增：處理完成後即時刷新本月上傳記錄
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
            disabled={isUploadDisabled || isMonthlyLimitReached} // 新增條件：本月超過5筆禁止上傳
          />
          {isMonthlyLimitReached && (
            <div className={styles.creditWarning} style={{ backgroundColor: '#ffeaea', color: '#b71c1c', borderLeft: '4px solid #e53935', marginTop: 12 }}>
              <p>本月上传已达上限（5笔），请等到下月1日后再上传新文件。</p>
            </div>
          )}
          
          {/* 添加處理時間提示說明 */}
          {isProcessing && (
            <div className={styles.processingAlert}>
              <p>文件处理需要一些时间（约 3-5 分钟），请勿关闭此页面。处理完成后将自动显示结果。</p>
            </div>
          )}
          {uploadTime && (
            <div className={styles.uploadTimeContainer}>
              <p>处理完成时间: {uploadTime}</p>
              <p className={styles.processingNote}>* 文件处理需要较长时间，请耐心等待完整处理</p>
            </div>
          )}
          
          {/* 显示最新上传的文档记录已隐藏 */}
        </section>
        {/* 右侧显示本月五筆最新文件记录 */}
        <aside className={styles.recentFilesAside}>
          <h4 className={styles.recentFilesTitle}>本月五筆上传记录</h4>
          {recentFiles.length === 0 ? (
            <div className={styles.noRecentFiles}>本月尚无上传记录</div>
          ) : (
            <ul className={styles.recentFilesList}>
              {recentFiles.map((file, idx) => (
                <li key={idx} className={styles.recentFileItem}>
                  <span className={styles.fileIndex}>{recentFiles.length - idx}. </span>
                  <span className={styles.fileName}>{file.fileName}</span>
                  <span className={styles.uploadDate}>{file.uploadDate}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </WithChat>
  );
}