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
  // 新增：右側顯示用戶所有上傳的檔案記錄
  const [recentFiles, setRecentFiles] = useState<Array<{ fileName: string, uploadDate: string, fileId: string }>>([]);
  // 新增：選中的檔案 ID
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

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
  
  // 取得所有用戶上傳檔案
  const fetchRecentFiles = async () => {
    if (!user?.user_id) {
      console.log('[DEBUG] 用戶未登入或無 user_id:', user);
      setRecentFiles([]);
      return;
    }
    try {
      const apiUrl = `/api/sunday-guide/documents?assistantId=${ASSISTANT_IDS.SUNDAY_GUIDE}&userId=${user.user_id}`;
      console.log('[DEBUG] 請求 API URL:', apiUrl);
      console.log('[DEBUG] 當前用戶:', user);
      
      const response = await fetch(apiUrl);
      if (!response.ok) {
        console.error('[DEBUG] API 回應失敗:', response.status, response.statusText);
        throw new Error('獲取檔案記錄失敗');
      }
      
      const data = await response.json();
      console.log('[DEBUG] API 回應數據:', data);
      
      if (data.success && data.records && data.records.length > 0) {
        // 直接排序所有檔案，取前20筆
        const sortedFiles = data.records.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        const recentFilesData = sortedFiles.slice(0, 20).map((rec: any) => ({
          fileName: rec.fileName || '未命名文件',
          uploadDate: new Date(rec.updatedAt).toLocaleDateString('en-US', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }),
          fileId: rec.fileId || ''
        }));
        console.log('[DEBUG] 處理後的檔案數據:', recentFilesData);
        setRecentFiles(recentFilesData);
      } else {
        console.log('[DEBUG] 無檔案記錄或 API 失敗:', data);
        setRecentFiles([]);
      }
    } catch (error) {
      console.error('[DEBUG] 獲取檔案記錄失敗:', error);
      setRecentFiles([]);
    }
  };

  // 點擊 recent file 取得內容，改為直接開新分頁顯示完整版
  const handleRecentFileClick = (fileId: string, fileName: string) => {
    if (!user?.user_id || !fileId) return;
    const url = `/api/sunday-guide/download-pdf?includeAll=true&userId=${user.user_id}&assistantId=${ASSISTANT_IDS.SUNDAY_GUIDE}&fileId=${fileId}&previewOnly=true`;
    window.open(url, '_blank');
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
    await fetchRecentFiles(); // 新增：處理完成後即時刷新上傳記錄
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
            disabled={isUploadDisabled} // 已移除本月上傳上限
          />
          
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
        </section>
        {/* 右側顯示用戶所有上傳記錄 */}
        <aside className={styles.recentFilesAside}>
          <h4 className={styles.recentFilesTitle}>上传记录</h4>
          {recentFiles.length === 0 ? (
            <div className={styles.noRecentFiles}>尚无上传记录</div>
          ) : (
            <ul className={styles.recentFilesListScrollable}>
              {recentFiles.map((file, idx) => (
                <li 
                  key={file.fileId || idx} 
                  className={styles.recentFileItem} 
                  style={{ 
                    cursor: 'pointer',
                    backgroundColor: selectedFileId === file.fileId ? '#e3f2fd' : '#fff',
                    color: selectedFileId === file.fileId ? '#333' : '#333',
                    border: selectedFileId === file.fileId ? '2px solid #0070f3' : '2px solid #ddd',
                    borderRadius: '4px',
                    padding: '4px'
                  }}
                  onClick={() => {
                    setSelectedFileId(file.fileId);
                    localStorage.setItem('selectedFileId', file.fileId);
                    localStorage.setItem('selectedFileName', file.fileName);
                    const channel = new BroadcastChannel('file-selection');
                    channel.postMessage({
                      type: 'FILE_SELECTED',
                      fileId: file.fileId,
                      fileName: file.fileName,
                      timestamp: Date.now()
                    });
                    channel.close();
                    console.log('[DEBUG] 已選中檔案並廣播事件:', { fileId: file.fileId, fileName: file.fileName });
                  }}
                  title="點擊選擇此檔案"
                >
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