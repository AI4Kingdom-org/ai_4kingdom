"use client";

// East Christ Home 版（比照 Agape 架構），沿用 Sunday Guide 的 assistant/vector store，靠 unitId 分流
import { useState, useEffect } from 'react';
import AssistantManager from '../components/AssistantManager';
import WithChat from '../components/layouts/WithChat';
import { useCredit } from '../contexts/CreditContext';
import UserIdDisplay from '../components/UserIdDisplay';
import styles from '../sunday-guide/SundayGuide.module.css';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';
import { useAuth } from '../contexts/AuthContext';
import { canUploadToSundayGuideUnit } from '../config/userPermissions';

interface ProcessedContent {
  summary: string;
  fullText: string;
  devotional: string;
  bibleStudy: string;
}

export default function EastChristHomePage() {
  const { refreshUsage, hasInsufficientTokens, remainingCredits } = useCredit();
  const { user } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedContent, setProcessedContent] = useState<ProcessedContent | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadTime, setUploadTime] = useState<string>('');
  const [isUploadDisabled, setIsUploadDisabled] = useState(false);
  const [latestFile, setLatestFile] = useState<{ fileName: string, uploadDate: string } | null>(null);
  const [showLatestFile, setShowLatestFile] = useState(true);
  const [recentFiles, setRecentFiles] = useState<Array<{ fileName: string, uploadDate: string, fileId: string, uploaderId?: string }>>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const filesPerPage = 10;

  // 僅允許在常數中列出的使用者上傳（eastChristHome 單位）
  const hasUploadPermission = canUploadToSundayGuideUnit('eastChristHome', user?.user_id);

  useEffect(() => { setIsUploadDisabled(remainingCredits <= 0); }, [remainingCredits, hasInsufficientTokens]);

  // 获取当前使用者最新文件（assistantId = SUNDAY_GUIDE）
  const fetchLatestFileRecord = async () => {
    if (!user?.user_id) { setLatestFile(null); return; }
    try {
      const res = await fetch(`/api/sunday-guide/documents?assistantId=${ASSISTANT_IDS.SUNDAY_GUIDE}&userId=${user.user_id}&unitId=eastChristHome`);
      if (!res.ok) throw new Error('获取文件记录失败');
      const data = await res.json();
      if (data.success && data.records?.length) {
        const latestRecord = [...data.records].sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
        const uploadDate = new Date(latestRecord.updatedAt);
        const dateOnly = uploadDate.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
        setLatestFile({ fileName: latestRecord.fileName || '未命名文件', uploadDate: dateOnly });
      } else setLatestFile(null);
    } catch { setLatestFile(null); }
  };

  // 获取所有 east 單位可公开浏览的文件（只显示 allowedUploaders 上传）
  const fetchAllFileRecords = async (page: number = 1) => {
    try {
      const res = await fetch(`/api/sunday-guide/documents?assistantId=${ASSISTANT_IDS.SUNDAY_GUIDE}&page=${page}&limit=${filesPerPage}&allUsers=true&unitId=eastChristHome`);
      if (!res.ok) throw new Error('获取文件记录失败');
      const data = await res.json();
      if (data.success && data.records) {
        const sorted = data.records.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        const mapped = sorted.map((rec: any) => ({
          fileName: rec.fileName || '未命名文件',
          uploadDate: new Date(rec.updatedAt).toLocaleDateString('zh-CN'),
          fileId: rec.fileId || '',
          uploaderId: rec.userId || '未知'
        }));
        setRecentFiles(mapped);
        setTotalPages(Math.ceil((data.totalCount || mapped.length) / filesPerPage));
      } else { setRecentFiles([]); setTotalPages(1); }
    } catch {
      setRecentFiles([]); setTotalPages(1);
    }
  };

  const handleDelete = async (fileId: string, uploaderId?: string) => {
    if (!user?.user_id) return;
    if (!fileId) return;
    if (uploaderId?.toString() !== user.user_id.toString()) return; // 前端保護
    if (!confirm('確定刪除此文件記錄？此操作不可回復。')) return;
    try {
      setDeletingId(fileId);
      const qs = new URLSearchParams({ fileId, unitId: 'eastChristHome', userId: user.user_id });
      const res = await fetch(`/api/sunday-guide/documents?${qs.toString()}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert('刪除失敗: ' + (data.error || res.status));
      } else {
        await fetchAllFileRecords(currentPage);
        if (selectedFileId === fileId) setSelectedFileId(null);
      }
    } catch (e: any) {
      alert('刪除時發生錯誤: ' + (e.message || '未知錯誤'));
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => { fetchLatestFileRecord(); fetchAllFileRecords(currentPage); }, [user]);
  useEffect(() => { fetchAllFileRecords(currentPage); }, [currentPage]);
  useEffect(() => { setShowLatestFile(!processedContent); }, [processedContent]);

  const handleFileProcessed = async (content: ProcessedContent) => {
    setProcessedContent(content);
    setIsProcessing(false);
    await fetchLatestFileRecord();
    await fetchAllFileRecords(currentPage);
    await refreshUsage();
  };

  return (
    <WithChat chatType="sunday-guide">
      <div className={styles.container}>
        <UserIdDisplay />
        {hasUploadPermission && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>文件上传与处理</h2>
            {isUploadDisabled && (
              <div className={styles.creditWarning}><p>Credits 不足，无法上传。</p></div>
            )}
            {!isUploadDisabled && remainingCredits < 20 && (
              <div className={styles.creditWarning} style={{ backgroundColor: '#fff8e0', color: '#b7791f', borderLeft: '4px solid #ecc94b' }}>
                <p>Credits 余额较低 (剩余 {remainingCredits})</p>
              </div>
            )}
            <AssistantManager
              onFileProcessed={handleFileProcessed}
              setIsProcessing={setIsProcessing}
              setUploadProgress={setUploadProgress}
              setUploadTime={setUploadTime}
              disabled={isUploadDisabled}
              assistantId={ASSISTANT_IDS.SUNDAY_GUIDE}
              vectorStoreId={VECTOR_STORE_IDS.SUNDAY_GUIDE}
            />
            {isProcessing && (
              <div className={styles.processingAlert}><p>处理中 (约数分钟)，请勿关闭页面。</p></div>
            )}
            {uploadTime && (
              <div className={styles.uploadTimeContainer}>
                <p>处理完成时间: {uploadTime}</p>
                <p className={styles.processingNote}>* 处理需要时间，请耐心等待</p>
              </div>
            )}
          </section>
        )}
        <aside className={styles.recentFilesAside}>
          <h4 className={styles.recentFilesTitle}>公开浏览文件</h4>
          {recentFiles.length === 0 ? (
            <div className={styles.noRecentFiles}>尚无可浏览文档</div>
          ) : (
            <>
              <ul className={styles.recentFilesListScrollable}>
                {recentFiles.map((file, idx) => (
                  <li
                    key={file.fileId || idx}
                    className={styles.recentFileItem}
                    style={{ cursor: 'pointer', backgroundColor: selectedFileId === file.fileId ? '#e3f2fd' : '#fff', border: selectedFileId === file.fileId ? '2px solid #0070f3' : '2px solid #ddd' }}
                    onClick={() => { 
                      setSelectedFileId(file.fileId); 
                      try {
                        localStorage.setItem('selectedFileId', file.fileId);
                        localStorage.setItem('selectedFileName', file.fileName);
                        localStorage.setItem('currentUnitId', 'eastChristHome');
                        const channel = new BroadcastChannel('file-selection');
                        channel.postMessage({
                          type: 'FILE_SELECTED',
                          assistantId: ASSISTANT_IDS.SUNDAY_GUIDE,
                          fileId: file.fileId,
                          fileName: file.fileName,
                          ts: Date.now()
                        });
                        channel.close();
                      } catch (err) {
                        console.warn('broadcast file selection failed', err);
                      }
                    }}
                  >
                    <span className={styles.fileIndex}>{((currentPage - 1) * filesPerPage) + idx + 1}. </span>
                    <span className={styles.fileName}>{file.fileName}</span>
                    <span className={styles.uploadDate}>{file.uploadDate}</span>
                    {file.uploaderId && user?.user_id && file.uploaderId.toString() === user.user_id.toString() && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(file.fileId, file.uploaderId); }}
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
              {totalPages > 1 && (
                <div className={styles.pagination}>
                  <button onClick={() => { const p = currentPage - 1; setCurrentPage(p); fetchAllFileRecords(p); }} disabled={currentPage === 1} className={styles.paginationButton}>上一页</button>
                  <span className={styles.paginationInfo}>第 {currentPage} / {totalPages} 页</span>
                  <button onClick={() => { const p = currentPage + 1; setCurrentPage(p); fetchAllFileRecords(p); }} disabled={currentPage === totalPages} className={styles.paginationButton}>下一页</button>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </WithChat>
  );
}
