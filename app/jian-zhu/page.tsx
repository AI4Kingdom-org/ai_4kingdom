"use client";

// Jian Zhu 版本，沿用 Sunday Guide assistant/vector store，靠 unitId=jianZhu 分流
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

export default function JianZhuPage() {
  const { refreshUsage, hasInsufficientTokens, remainingCredits } = useCredit();
  const { user } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedContent, setProcessedContent] = useState<ProcessedContent | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadTime, setUploadTime] = useState<string>('');
  const [isUploadDisabled, setIsUploadDisabled] = useState(false);
  const [recentFiles, setRecentFiles] = useState<Array<{ fileName: string, uploadDate: string, fileId: string, uploaderId?: string }>>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const filesPerPage = 10;

  const hasUploadPermission = canUploadToSundayGuideUnit('jianZhu', user?.user_id);

  useEffect(() => { setIsUploadDisabled(remainingCredits <= 0); }, [remainingCredits, hasInsufficientTokens]);

  const fetchAllFileRecords = async (page: number = 1) => {
    try {
      const res = await fetch(`/api/sunday-guide/documents?page=${page}&limit=${filesPerPage}&allUsers=true&unitId=jianZhu`);
      if (!res.ok) throw new Error('獲取文件記錄失敗');
      const data = await res.json();
      if (data.success && data.records) {
        const sorted = data.records.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        const mapped = sorted.map((rec: any) => ({
          fileName: rec.fileName || '未命名文件',
          uploadDate: new Date(rec.updatedAt).toLocaleDateString('zh-TW'),
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

  useEffect(() => { fetchAllFileRecords(currentPage); }, [user]);
  useEffect(() => { fetchAllFileRecords(currentPage); }, [currentPage]);
  useEffect(() => { localStorage.setItem('currentUnitId', 'jianZhu'); }, []);

  const handleDelete = async (fileId: string, uploaderId?: string) => {
    if (!user?.user_id) return;
    if (!fileId) return;
    if (uploaderId?.toString() !== user.user_id.toString()) return; // 前端保護：僅原上傳者可刪除
    if (!confirm('確定刪除此文件記錄？此操作不可回復。')) return;
    try {
      setDeletingId(fileId);
      const qs = new URLSearchParams({ fileId, unitId: 'jianZhu', userId: user.user_id });
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

  const handleFileProcessed = async (content: ProcessedContent) => {
    setProcessedContent(content);
    setIsProcessing(false);
    await fetchAllFileRecords(currentPage);
    await refreshUsage();
  };

  return (
    <WithChat chatType="sunday-guide">
      <div className={styles.container}>
        <UserIdDisplay />
        {hasUploadPermission && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>文件上傳與處理</h2>
            {isUploadDisabled && (
              <div className={styles.creditWarning}><p>Credits 不足，無法上傳。</p></div>
            )}
            <AssistantManager
              onFileProcessed={handleFileProcessed}
              setIsProcessing={setIsProcessing}
              setUploadProgress={setUploadProgress}
              setUploadTime={setUploadTime}
              disabled={isUploadDisabled}
              assistantId={ASSISTANT_IDS.JIAN_ZHU}
              vectorStoreId={VECTOR_STORE_IDS.JIAN_ZHU}
            />
          </section>
        )}
        <aside className={styles.recentFilesAside}>
          <h4 className={styles.recentFilesTitle}>公開瀏覽文件</h4>
          {recentFiles.length === 0 ? (
            <div className={styles.noRecentFiles}>尚無可瀏覽文檔</div>
          ) : (
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
                      localStorage.setItem('currentUnitId', 'jianZhu');
                      const channel = new BroadcastChannel('file-selection');
                      channel.postMessage({
                        type: 'FILE_SELECTED',
                        assistantId: ASSISTANT_IDS.JIAN_ZHU,
                        fileId: file.fileId,
                        fileName: file.fileName,
                        ts: Date.now()
                      });
                      channel.close();
                    } catch {}
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
          )}
        </aside>
      </div>
    </WithChat>
  );
}
