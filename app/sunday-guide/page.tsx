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
  const { user, canUploadFiles } = useAuth(); // 取得當前登入用戶和上傳權限檢查方法
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedContent, setProcessedContent] = useState<ProcessedContent | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadTime, setUploadTime] = useState<string>('');
  const [isUploadDisabled, setIsUploadDisabled] = useState(false);
  // 添加最新文件記錄的狀態
  const [latestFile, setLatestFile] = useState<{ fileName: string, uploadDate: string } | null>(null);
  // 添加是否顯示前次記錄的狀態
  const [showLatestFile, setShowLatestFile] = useState(true);
  // 新增：右側顯示所有用戶上傳的檔案記錄（分頁顯示）
  const [recentFiles, setRecentFiles] = useState<Array<{ fileName: string, uploadDate: string, fileId: string, uploaderId?: string }>>([]);
  // 新增：選中的檔案 ID
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  // 新增：刪除功能相關狀態
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 新增：分頁相關狀態
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const filesPerPage = 10;

  // 檢查上傳權限
  const hasUploadPermission = canUploadFiles();
  
  console.log('[DEBUG] 上傳權限檢查:', {
    user_id: user?.user_id,
    hasUploadPermission
  });

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
  
  // 獲取所有用戶的文件記錄（支援分頁）
  const fetchAllFileRecords = async (page: number = 1) => {
    try {
      const response = await fetch(`/api/sunday-guide/documents?assistantId=${ASSISTANT_IDS.SUNDAY_GUIDE}&page=${page}&limit=${filesPerPage}&allUsers=true`);
      if (!response.ok) throw new Error('獲取文件記錄失敗');
      const data = await response.json();
      if (data.success && data.records) {
        // 按時間排序，最新的在前面
        const sortedFiles = data.records.sort((a: any, b: any) => 
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        
        const filesData = sortedFiles.map((rec: any) => ({
          fileName: rec.fileName || '未命名文件',
          uploadDate: new Date(rec.updatedAt).toLocaleDateString('zh-TW'),
          fileId: rec.fileId || '',
          uploaderId: rec.userId || '未知用戶'
        }));
        
        setRecentFiles(filesData);
        setTotalPages(Math.ceil((data.totalCount || filesData.length) / filesPerPage));
      } else {
        setRecentFiles([]);
        setTotalPages(1);
      }
    } catch (error) {
      console.error('獲取文件記錄失敗:', error);
      setRecentFiles([]);
      setTotalPages(1);
    }
  };

  // 新增：處理文件刪除功能
  const handleDelete = async (fileId: string, uploaderId?: string) => {
    if (!user?.user_id) return;
    if (!fileId) return;
    if (uploaderId?.toString() !== user.user_id.toString()) return; // 前端保護：僅原上傳者可刪除
    if (!confirm('確定刪除此文件記錄？此操作不可回復。')) return;
    
    try {
      setDeletingId(fileId);
      const qs = new URLSearchParams({ fileId, unitId: 'default', userId: user.user_id });
      const res = await fetch(`/api/sunday-guide/documents?${qs.toString()}`, { method: 'DELETE' });
      const data = await res.json();
      
      if (!res.ok || !data.success) {
        alert('刪除失敗: ' + (data.error || res.status));
      } else {
        await fetchAllFileRecords(currentPage);
        if (selectedFileId === fileId) setSelectedFileId(null);
        // 如果刪除的是最新文件，重新獲取最新記錄
        await fetchLatestFileRecord();
      }
    } catch (e: any) {
      alert('刪除時發生錯誤: ' + (e.message || '未知錯誤'));
    } finally {
      setDeletingId(null);
    }
  };

  // 取得所有用戶上傳檔案
  const fetchRecentFiles = async () => {
    // 調用新的獲取所有用戶文檔的函數
    await fetchAllFileRecords(currentPage);
  };

  // 點擊 recent file 取得內容，改為直接開新分頁顯示完整版
  const handleRecentFileClick = (fileId: string, fileName: string) => {
    if (!user?.user_id || !fileId) return;
    const url = `/api/sunday-guide/download-pdf?includeAll=true&userId=${user.user_id}&assistantId=${ASSISTANT_IDS.SUNDAY_GUIDE}&fileId=${fileId}&previewOnly=true`;
    window.open(url, '_blank');
  };

  // 組件掛載時獲取文件記錄
  useEffect(() => {
    fetchLatestFileRecord();
    fetchAllFileRecords(currentPage); // 使用新的分頁函數
  }, [user]);

  // 當頁面改變時重新載入數據
  useEffect(() => {
    fetchAllFileRecords(currentPage);
  }, [currentPage]);

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
    await fetchAllFileRecords(currentPage); // 使用新的分頁函數
    await refreshUsage();
  };

  return (
  <WithChat chatType="sunday-guide">
      <div className={styles.container}>
        <UserIdDisplay />
        {/* 只有有權限的用戶才能看到文件上傳區塊 */}
        {hasUploadPermission && (
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
        )}
        {/* 所有用戶都能看到的上傳文檔列表 */}
        <aside className={styles.recentFilesAside}>
          <h4 className={styles.recentFilesTitle}>已上传可浏览文档</h4>
          {recentFiles.length === 0 ? (
            <div className={styles.noRecentFiles}>尚无可浏览文档</div>
          ) : (
            <>
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
                    <span className={styles.fileIndex}>{((currentPage - 1) * filesPerPage) + idx + 1}. </span>
                    <span className={styles.fileName}>{file.fileName}</span>
                    <span className={styles.uploadDate}>{file.uploadDate}</span>
                    {file.uploaderId && (
                      <span className={styles.uploaderInfo}>上传者: {file.uploaderId}</span>
                    )}
                    {/* 添加刪除按鈕：只有上傳者本人可以看到 */}
                    {file.uploaderId && user?.user_id && file.uploaderId.toString() === user.user_id.toString() && (
                      <button
                        onClick={(e) => { 
                          e.stopPropagation(); // 阻止觸發父元素的點擊事件
                          handleDelete(file.fileId, file.uploaderId); 
                        }}
                        disabled={deletingId === file.fileId}
                        style={{
                          marginLeft: 8,
                          background: 'none',
                          border: 'none',
                          color: 'crimson',
                          cursor: 'pointer',
                          fontSize: '14px'
                        }}
                        title="刪除此文件"
                      >
                        {deletingId === file.fileId ? '刪除中...' : '🗑'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              
              {/* 分頁控制 */}
              {totalPages > 1 && (
                <div className={styles.pagination}>
                  <button 
                    onClick={() => {
                      const newPage = currentPage - 1;
                      setCurrentPage(newPage);
                      fetchAllFileRecords(newPage);
                    }}
                    disabled={currentPage === 1}
                    className={styles.paginationButton}
                  >
                    上一页
                  </button>
                  
                  <span className={styles.paginationInfo}>
                    第 {currentPage} 页，共 {totalPages} 页
                  </span>
                  
                  <button 
                    onClick={() => {
                      const newPage = currentPage + 1;
                      setCurrentPage(newPage);
                      fetchAllFileRecords(newPage);
                    }}
                    disabled={currentPage === totalPages}
                    className={styles.paginationButton}
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </WithChat>
  );
}