"use client";

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useChat } from '../../contexts/ChatContext';
import { useCredit } from '../../contexts/CreditContext';
import Chat from '../../components/Chat/Chat';
import WithChat from '../../components/layouts/WithChat';
import styles from '../../user-sunday-guide/page.module.css';
import { CHAT_TYPES } from '../../config/chatTypes';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../../config/constants';
import ReactMarkdown from 'react-markdown';

// Reuse same type of modes
type GuideMode = 'summary' | 'devotional' | 'bible' | null;

interface EastRecord {
  fileName: string;
  uploadTime: string;
  fileUniqueId: string; // reuse fileId
  fileId?: string;
}

function EastNavigatorContent() {
  const [fileList, setFileList] = useState<EastRecord[]>([]);
  const [selectedFileUniqueId, setSelectedFileUniqueId] = useState<string | null>(null);
  const { user } = useAuth();
  const { setConfig } = useChat();
  const { refreshUsage } = useCredit();
  const [selectedMode, setSelectedMode] = useState<GuideMode>(null);
  const [sermonContent, setSermonContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fileName, setFileName] = useState<string>('');
  const [uploadTime, setUploadTime] = useState<string>('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // 初始化 chat config 為 East 專用（但沿用 Sunday Guide 資源）
  useEffect(() => {
    if (user?.user_id) {
      setConfig({
        type: CHAT_TYPES.SUNDAY_GUIDE,
        assistantId: ASSISTANT_IDS.SUNDAY_GUIDE,
        vectorStoreId: VECTOR_STORE_IDS.SUNDAY_GUIDE,
        userId: user.user_id
      });
      fetchEastFiles();
    }
  }, [user, setConfig]);

  const fetchEastFiles = async () => {
    try {
      const res = await fetch(`/api/sunday-guide/documents?unitId=eastChristHome&allUsers=true`);
      if (!res.ok) throw new Error('获取文件记录失败');
      const data = await res.json();
      if (data.success && data.records?.length) {
        const sorted = [...data.records].sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        const mapped: EastRecord[] = sorted.map((r: any) => ({
          fileName: r.fileName || '未命名文件',
          uploadTime: r.updatedAt,
          fileUniqueId: r.fileId,
          fileId: r.fileId
        }));
        setFileList(mapped);
        const storedId = typeof window !== 'undefined' ? localStorage.getItem('selectedFileId') : null;
        const storedName = typeof window !== 'undefined' ? localStorage.getItem('selectedFileName') : null;
        const storedItem = storedId ? mapped.find(m => m.fileUniqueId === storedId) : null;
        const target = storedItem || mapped[0];
        setSelectedFileUniqueId(target.fileUniqueId);
        setFileName(storedItem ? (storedName || storedItem.fileName) : target.fileName);
        setUploadTime(new Date(target.uploadTime).toLocaleDateString('zh-TW'));
      } else {
        setFileList([]);
        setFileName('尚未上传文件');
        setUploadTime('');
        setSelectedFileUniqueId(null);
      }
    } catch (e) {
      console.error(e);
      setFileList([]);
      setFileName('获取文件信息失败');
      setUploadTime('');
      setSelectedFileUniqueId(null);
    }
  };

  const broadcastSelection = (fileId: string, name: string) => {
    try {
      localStorage.setItem('selectedFileId', fileId);
      localStorage.setItem('selectedFileName', name);
      localStorage.setItem('currentUnitId', 'eastChristHome');
      const channel = new BroadcastChannel('file-selection');
      channel.postMessage({
        type: 'FILE_SELECTED',
        assistantId: ASSISTANT_IDS.SUNDAY_GUIDE,
        fileId,
        fileName: name,
        ts: Date.now()
      });
      channel.close();
    } catch (err) {
      console.warn('broadcastSelection error', err);
    }
  };

  useEffect(() => {
    const channel = new BroadcastChannel('file-selection');
    const handler = (e: MessageEvent) => {
      const data = e.data;
      if (data?.type === 'FILE_SELECTED' && data.assistantId === ASSISTANT_IDS.SUNDAY_GUIDE) {
        setSelectedFileUniqueId(data.fileId);
        setFileName(data.fileName);
        setUploadTime('');
        setSermonContent(null);
        setSelectedMode(null);
      }
    };
    channel.addEventListener('message', handler);
    return () => { channel.removeEventListener('message', handler); channel.close(); };
  }, []);

  const handleModeSelect = async (mode: GuideMode) => {
    if (!selectedFileUniqueId) return;
    setSelectedMode(mode);
    setLoading(true);
    try {
      const userId = user?.user_id || '';
      const apiUrl = `/api/sunday-guide/content/${ASSISTANT_IDS.SUNDAY_GUIDE}?type=${mode}&userId=${encodeURIComponent(userId)}&fileId=${encodeURIComponent(selectedFileUniqueId)}`;
      const response = await fetch(apiUrl);
      if (!response.ok) {
        const errData = await response.json().catch(()=>({error:'未知錯誤'}));
        throw new Error(`获取内容失败: ${response.status} - ${errData.error || response.statusText}`);
      }
      const data = await response.json();
      setSermonContent(data.content);
      await refreshUsage();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : '請稍後重試');
    } finally {
      setLoading(false);
    }
  };

  const renderContent = () => {
    if (loading) return <div className={styles.loading}>加载中，请稍候...</div>;
    if (!sermonContent) return null;
    const titles: Record<string,string> = { summary: '讲道总结', devotional: '每日灵修', bible: '查经指引' };
    return (
      <div className={styles.contentBox}>
        <div className={styles.contentHeader}>
          <h2>{titles[selectedMode!]}</h2>
          {sermonContent && (
            <button
              style={{ marginLeft: 8 }}
              className={styles.downloadButton}
              onClick={() => handleDownloadPDF()}
              disabled={pdfLoading}
            >
              {pdfLoading ? '生成中...' : '下载完整版'}
            </button>
          )}
        </div>
        {pdfError && <div className={styles.errorMessage}>{pdfError}</div>}
        <div className={styles.markdownContent} ref={contentRef}>
          <ReactMarkdown>{sermonContent}</ReactMarkdown>
        </div>
      </div>
    );
  };

  const handleDownloadPDF = () => {
    setPdfError(null);
    setPdfLoading(true);
    try {
      const userId = user?.user_id || '';
      const base = '/api/sunday-guide/download-pdf';
      const params = new URLSearchParams();
      params.set('assistantId', ASSISTANT_IDS.SUNDAY_GUIDE);
      params.set('userId', userId);
      params.set('includeAll', 'true');
      const url = `${base}?${params.toString()}`;
      window.open(url, '_blank');
      setTimeout(()=> setPdfLoading(false), 1200);
    } catch (err) {
      console.error('PDF 下載失敗', err);
      setPdfError(err instanceof Error ? err.message : '下載失敗');
      setPdfLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>主日信息导航</h1>
      {fileName && fileName !== '尚未上傳文件' && fileName !== '獲取文件資訊失敗' && (
        <div style={{ fontSize: '13px', color: '#0070f3', marginBottom: 12, textAlign: 'center' }}>
          当前文件: {fileName} {uploadTime && `(上传时间: ${uploadTime})`}
        </div>
      )}
      <div className={styles.buttonGroup}>
        <button className={`${styles.modeButton} ${selectedMode === 'summary' ? styles.active : ''}`} onClick={()=>handleModeSelect('summary')} disabled={!selectedFileUniqueId}>信息总结</button>
        <button className={`${styles.modeButton} ${selectedMode === 'devotional' ? styles.active : ''}`} onClick={()=>handleModeSelect('devotional')} disabled={!selectedFileUniqueId}>每日灵修</button>
        <button className={`${styles.modeButton} ${selectedMode === 'bible' ? styles.active : ''}`} onClick={()=>handleModeSelect('bible')} disabled={!selectedFileUniqueId}>查经指引</button>
      </div>
      {(!fileName || fileName === '尚未上傳文件' || fileName === '獲取文件資訊失敗') && (
        <div style={{ fontSize: '14px', color: '#ff6b6b', marginTop: 8, marginBottom: 16, textAlign: 'center', padding: '12px', backgroundColor: '#fff5f5', borderRadius: '8px', border: '1px solid #ffebee' }}>
          {fileName === '获取文件信息失败' ? '无法获取文件信息，请稍后重试' : '目前尚无可用文件'}
        </div>
      )}
      {sermonContent ? (
        <div className={styles.contentWrapper}>
          <div className={`${styles.contentArea} ${styles.hasContent}`}>{renderContent()}</div>
          <div className={styles.chatSection}>
            {user && (
              <Chat
                type={CHAT_TYPES.SUNDAY_GUIDE}
                assistantId={ASSISTANT_IDS.SUNDAY_GUIDE}
                vectorStoreId={VECTOR_STORE_IDS.SUNDAY_GUIDE}
                userId={user.user_id}
              />
            )}
          </div>
        </div>
      ) : (
        <div className={styles.emptyState}><p>请先选择要查看的内容类型</p></div>
      )}
    </div>
  );
}

export default function EastNavigatorPage() {
  const { user, loading } = useAuth();
  if (loading) return <div>Loading...</div>;
  if (!user) return <div>请先登录</div>;
  return (
    <WithChat chatType={CHAT_TYPES.SUNDAY_GUIDE}>
      <EastNavigatorContent />
    </WithChat>
  );
}
