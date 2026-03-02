'use client';

import Script from 'next/script';
import { useState, useEffect, useRef } from 'react';
import SermonInputTabs from '../components/SermonInputTabs';
import WithChat from '../components/layouts/WithChat';
import ChatkitEmbed from '../components/ChatkitEmbed';
import UserIdDisplay from '../components/UserIdDisplay';
import { useCredit } from '../contexts/CreditContext';
import { useAuth } from '../contexts/AuthContext';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';
import { CHAT_TYPES } from '../config/chatTypes';
import ReactMarkdown from 'react-markdown';
import styles from './SundayGuide.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProcessedContent {
  summary: string;
  fullText: string;
  devotional: string;
  bibleStudy: string;
}

type GuideMode = 'summary' | 'text' | 'devotional' | 'bible' | null;

// ---------------------------------------------------------------------------
// Main Content Component
// ---------------------------------------------------------------------------

function SundayGuideContent() {
  const { refreshUsage, hasInsufficientTokens, remainingCredits } = useCredit();
  const { user, canUploadFiles } = useAuth();

  // ---- Upload states ----
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedContent, setProcessedContent] = useState<ProcessedContent | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadTime, setUploadTime] = useState<string>('');
  const [isUploadDisabled, setIsUploadDisabled] = useState(false);

  // ---- Documents list states ----
  const [recentFiles, setRecentFiles] = useState<
    Array<{ fileName: string; uploadDate: string; fileId: string; uploaderId?: string }>
  >([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const filesPerPage = 10;

  // ---- Guide navigator states ----
  const [selectedMode, setSelectedMode] = useState<GuideMode>(null);
  const [sermonContent, setSermonContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const devSkip = process.env.NEXT_PUBLIC_DEV_SKIP_AUTH === 'true';
  const hasUploadPermission = devSkip || canUploadFiles();

  // Whether any file is selected (controls guide section visibility)
  const hasFileSelected = !!selectedFileId;

  // ---- Credit check ----
  useEffect(() => {
    setIsUploadDisabled(remainingCredits <= 0);
  }, [remainingCredits, hasInsufficientTokens]);

  // ---- Fetch browsable documents (paginated, all users) ----
  const fetchAllFileRecords = async (page: number = 1) => {
    try {
      const response = await fetch(
        `/api/sunday-guide/documents?assistantId=${ASSISTANT_IDS.SUNDAY_GUIDE}&page=${page}&limit=${filesPerPage}&allUsers=true`
      );
      if (!response.ok) throw new Error('獲取文件記錄失敗');
      const data = await response.json();
      if (data.success && data.records) {
        const sortedFiles = data.records.sort(
          (a: any, b: any) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        const filesData = sortedFiles.map((rec: any) => ({
          fileName: rec.fileName || '未命名文件',
          uploadDate: new Date(rec.updatedAt).toLocaleDateString('zh-TW'),
          fileId: rec.fileId || '',
          uploaderId: rec.userId || '未知用戶',
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

  // ---- Initial load ----
  useEffect(() => {
    fetchAllFileRecords(currentPage);
  }, [user]);

  useEffect(() => {
    fetchAllFileRecords(currentPage);
  }, [currentPage]);

  // ---- Upload completed callback ----
  const handleFileProcessed = async (content: ProcessedContent) => {
    setProcessedContent(content);
    setIsProcessing(false);
    await fetchAllFileRecords(currentPage);
    await refreshUsage();
  };

  // ---- Delete file ----
  const handleDelete = async (fileId: string, uploaderId?: string) => {
    if (!user?.user_id || !fileId) return;
    if (uploaderId?.toString() !== user.user_id.toString()) return;
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
        if (selectedFileId === fileId) {
          setSelectedFileId(null);
          setSelectedFileName(null);
          setSermonContent(null);
          setSelectedMode(null);
        }
      }
    } catch (e: any) {
      alert('刪除時發生錯誤: ' + (e.message || '未知錯誤'));
    } finally {
      setDeletingId(null);
    }
  };

  // ---- Select file from list ----
  const handleSelectFile = (fileId: string, fileName: string) => {
    setSelectedFileId(fileId);
    setSelectedFileName(fileName);
    // Reset content when switching files
    setSermonContent(null);
    setSelectedMode(null);
  };

  // ---- Guide mode selection ----
  const handleModeSelect = async (mode: GuideMode) => {
    if (!selectedFileId) return;
    setSelectedMode(mode);
    setContentLoading(true);
    try {
      const userId = user?.user_id || '';
      const apiUrl = `/api/sunday-guide/content/${ASSISTANT_IDS.SUNDAY_GUIDE}?type=${mode}&userId=${encodeURIComponent(userId)}&fileId=${encodeURIComponent(selectedFileId)}`;
      const response = await fetch(apiUrl);

      if (response.status === 202) {
        const data = await response.json();
        alert(data.error || '內容正在生成中，請稍候...');
        return;
      }
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '未知錯誤' }));
        throw new Error(errorData.error || `獲取內容失敗: ${response.status}`);
      }

      const data = await response.json();
      setSermonContent(data.content);
      await refreshUsage();
    } catch (error) {
      console.error('獲取內容失敗:', error);
      alert(`獲取內容失敗: ${error instanceof Error ? error.message : '請稍後重試'}`);
    } finally {
      setContentLoading(false);
    }
  };

  // ---- Download full version ----
  const handleDownloadPDF = () => {
    setPdfError(null);
    setPdfLoading(true);
    try {
      const userId = user?.user_id || '';
      let downloadUrl = `/api/sunday-guide/download-pdf?includeAll=true&userId=${encodeURIComponent(userId)}&assistantId=${ASSISTANT_IDS.SUNDAY_GUIDE}`;
      if (selectedFileId) {
        downloadUrl += `&fileId=${encodeURIComponent(selectedFileId)}`;
      }
      window.open(downloadUrl, '_blank');
      setTimeout(() => setPdfLoading(false), 1000);
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : '下載完整版PDF時發生錯誤，請重試');
      setPdfLoading(false);
    }
  };

  // ---- Render guide content ----
  const renderContent = () => {
    if (contentLoading) return <div className={styles.loading}>載入中，請稍候...</div>;
    if (!sermonContent) return null;
    const titles: Record<string, string> = {
      summary: '讲道总结',
      text: '信息文字',
      devotional: '每日灵修',
      bible: '查经指引',
    };
    return (
      <div className={styles.contentBox}>
        <div className={styles.contentHeader}>
          <h2>{titles[selectedMode!]}</h2>
          <button className={styles.downloadButton} onClick={handleDownloadPDF} disabled={pdfLoading}>
            {pdfLoading ? '生成預覽中...' : '下载完整版(简体中文)'}
          </button>
        </div>
        {pdfError && <div className={styles.errorMessage}>{pdfError}</div>}
        <div className={styles.markdownContent} ref={contentRef}>
          <ReactMarkdown>{sermonContent}</ReactMarkdown>
        </div>
      </div>
    );
  };

  // =========================================================================
  // RENDER
  // =========================================================================
  return (
    <div className={styles.container}>
      <Script src="https://cdn.platform.openai.com/deployments/chatkit/chatkit.js" strategy="afterInteractive" />
      <UserIdDisplay />

      {/* =============== 1. Upload Section =============== */}
      {hasUploadPermission && (
        <section className={styles.uploadHero}>
          <h2 className={styles.uploadHeroTitle}>上传讲章</h2>
          <p className={styles.uploadHeroDesc}>
            上传主日讲章文件，系统将自动生成<strong>信息总结</strong>、<strong>每日灵修</strong>与<strong>查经指引</strong>。
            <br />
            支持格式：<strong>PDF / 文件</strong>、<strong>YouTube 链接</strong>、<strong>音频文件</strong>
          </p>

          {isUploadDisabled && (
            <span className={styles.creditWarningInline}>额度不足，无法上传</span>
          )}
          {!isUploadDisabled && remainingCredits > 0 && remainingCredits < 20 && (
            <span className={styles.creditWarningInline} style={{ background: '#fef3c7', color: '#92400e' }}>
              余额较低 ({remainingCredits})
            </span>
          )}

          <div className={styles.uploadArea}>
            <SermonInputTabs
              onFileProcessed={handleFileProcessed}
              setIsProcessing={setIsProcessing}
              setUploadProgress={setUploadProgress}
              setUploadTime={setUploadTime}
              disabled={isUploadDisabled}
            />
          </div>

          {isProcessing && (
            <div className={styles.processingAlert}>
              <p>处理中，约需 3-5 分钟，请勿关闭页面...</p>
            </div>
          )}
          {uploadTime && (
            <span className={styles.uploadTimeBadge}>✓ 完成于 {uploadTime}</span>
          )}
        </section>
      )}

      {/* =============== 2. Sidebar + Main Layout =============== */}
      <div className={styles.mainLayout}>
        {/* ---- Left Sidebar: 文檔列表 ---- */}
        <aside className={styles.docsSection}>
          <h4 className={styles.docsSectionTitle}>
            📚 文档列表
            <span className={styles.docsSectionHint}>— 选择一份讲章</span>
          </h4>

          {recentFiles.length === 0 ? (
            <div className={styles.noDocs}>暂无文档</div>
          ) : (
            <>
              <ul className={styles.docsListScrollable}>
                {recentFiles.map((file, idx) => (
                  <li
                    key={file.fileId || idx}
                    className={`${styles.docItem} ${selectedFileId === file.fileId ? styles.docItemSelected : ''}`}
                    onClick={() => handleSelectFile(file.fileId, file.fileName)}
                    title="点击选择此文档"
                  >
                    <span className={styles.docIndex}>
                      {(currentPage - 1) * filesPerPage + idx + 1}.
                    </span>
                    <span className={styles.docFileName}>{file.fileName}</span>
                    <span className={styles.docDate}>{file.uploadDate}</span>

                    {/* Delete button: only visible for own uploads */}
                    {file.uploaderId &&
                      user?.user_id &&
                      file.uploaderId.toString() === user.user_id.toString() && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(file.fileId, file.uploaderId);
                          }}
                          disabled={deletingId === file.fileId}
                          className={styles.deleteButton}
                          title="删除此文档"
                        >
                          {deletingId === file.fileId ? '...' : '🗑'}
                        </button>
                      )}
                  </li>
                ))}
              </ul>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className={styles.pagination}>
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className={styles.paginationButton}
                  >
                    ←
                  </button>
                  <span className={styles.paginationInfo}>
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className={styles.paginationButton}
                  >
                    →
                  </button>
                </div>
              )}
            </>
          )}
        </aside>

        {/* ---- Right Main: 導航內容 ---- */}
        {hasFileSelected ? (
        <section className={styles.guideSection}>
          <h2 className={styles.guideTitle}>主日信息导航</h2>
          <p className={styles.guideSubtitle}>
            当前讲章：{selectedFileName || '未知'}
          </p>

          {/* ChatKit */}
          {user && (
            <div className={styles.chatSection}>
              <ChatkitEmbed userId={user.user_id} />
            </div>
          )}

          {/* Mode buttons */}
          <div className={styles.buttonGroup}>
            <button
              className={`${styles.modeButton} ${selectedMode === 'summary' ? styles.active : ''}`}
              onClick={() => handleModeSelect('summary')}
            >
              信息总结
            </button>
            <button
              className={`${styles.modeButton} ${selectedMode === 'devotional' ? styles.active : ''}`}
              onClick={() => handleModeSelect('devotional')}
            >
              每日灵修
            </button>
            <button
              className={`${styles.modeButton} ${selectedMode === 'bible' ? styles.active : ''}`}
              onClick={() => handleModeSelect('bible')}
            >
              查经指引
            </button>
          </div>

          {/* Content */}
          {sermonContent ? (
            <div className={styles.contentWrapper}>
              <div className={`${styles.contentArea} ${styles.hasContent}`}>
                {renderContent()}
              </div>
            </div>
          ) : null}
        </section>
        ) : (
          <div className={styles.guidePlaceholder}>
            <div className={styles.guidePlaceholderIcon}>👈</div>
            <p className={styles.guidePlaceholderText}>
              请从左侧选择一份讲章<br />以开启主日信息导航
            </p>
          </div>
        )}
      </div>{/* end mainLayout */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page Export
// ---------------------------------------------------------------------------

export default function SundayGuideV2() {
  const { user, loading } = useAuth();

  // NEXT_PUBLIC_DEV_SKIP_AUTH=true in .env.local bypasses the auth gate for
  // local development. This flag is NOT set in amplify.yml, so production is
  // unaffected. It is baked at build time (NEXT_PUBLIC_*), so no runtime overhead.
  const devSkip = process.env.NEXT_PUBLIC_DEV_SKIP_AUTH === 'true';

  if (loading && !devSkip) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', fontSize: '1rem', color: '#64748b' }}>
        載入中...
      </div>
    );
  }

  if (!user && !devSkip) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', fontSize: '1rem', color: '#64748b' }}>
        請先登入
      </div>
    );
  }

  return (
    <WithChat chatType={CHAT_TYPES.SUNDAY_GUIDE} disableChatContext>
      <SundayGuideContent />
    </WithChat>
  );
}
