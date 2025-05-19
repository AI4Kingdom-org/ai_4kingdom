'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useChat } from '../contexts/ChatContext';
import { useCredit } from '../contexts/CreditContext';
import Chat from '../components/Chat/Chat';
import WithChat from '../components/layouts/WithChat';
import styles from './page.module.css';
import { CHAT_TYPES } from '../config/chatTypes';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';
import ReactMarkdown from 'react-markdown';
import Script from 'next/script';

// 添加全局類型定義，以解決TypeScript報錯
declare global {
  interface Window {
    html2canvas: any;
    jspdf: {
      jsPDF: any;
    };
    jsPDF: any;
  }
}

// 使用 script 標籤直接引入 jspdf 和 html2canvas 庫，避免動態導入問題
const scriptsLoaded = {
  jspdf: false,
  html2canvas: false
};

type GuideMode = 'summary' | 'text' | 'devotional' | 'bible' | null;

// 簡繁轉換映射表（擴展版，包含更多常用字符）
const traditionalToSimplified: Record<string, string> = {
  '個': '个', '東': '东', '義': '义', '並': '并', '餘': '余', '傑': '杰',
  '這': '这', '為': '为', '來': '来', '後': '后', '點': '点', '國': '国',
  '說': '说', '當': '当', '時': '时', '從': '从', '學': '学', '實': '实',
  '進': '进', '與': '与', '產': '产', '還': '还', '會': '会', '發': '发',
  '經': '经', '見': '见', '樣': '样', '現': '现', '話': '话', '讓': '让',
  '對': '对', '體': '体', '們': '们', '開': '开', '過': '过', '著': '着',
  '關': '关', '靈': '灵', '長': '长', '門': '门', '問': '问', '間': '间',
  '聽': '听', '書': '书', '頁': '页', '紐': '纽', '約': '约', '馬': '马',
  '總': '总', '結': '结', '數': '数', '處': '处',
  '導': '导', '應': '应', '該': '该', '頭': '头', '顯': '显', '願': '愿',
  '歲': '岁', '師': '师', '遠': '远', '鐘': '钟', '專': '专', '區': '区',
  '團': '团', '園': '园', '圓': '圆', '連': '连', '週': '周', '階': '阶',
  '麼': '么', '麗': '丽', '壽': '寿', '圍': '围', '興': '兴',
  '證': '证', '讀': '读', '認': '认', '隻': '只', '講': '讲',
  '較': '较', '誰': '谁', '張': '张', '際': '际', '離': '离', '壓': '压',
  '雲': '云', '畫': '画', '惡': '恶', '愛': '爱', '爺': '爷', '態': '态',
  '雞': '鸡', '強': '强', '歡': '欢', '漢': '汉'
};

function SundayGuideContent() {
  const { user } = useAuth();
  const { setConfig } = useChat();
  const { refreshUsage } = useCredit();
  const [selectedMode, setSelectedMode] = useState<GuideMode>(null);
  const [sermonContent, setSermonContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [librariesLoaded, setLibrariesLoaded] = useState(false);
  // 添加檔案資訊相關狀態變數
  const [fileName, setFileName] = useState<string>('');
  const [uploadTime, setUploadTime] = useState<string>('');

  useEffect(() => {
    // 檢查是否在瀏覽器環境
    if (typeof window !== 'undefined') {
      // 動態引入腳本
      const loadScripts = async () => {
        try {
          // 加載 html2canvas
          const html2canvasScript = document.createElement('script');
          html2canvasScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
          html2canvasScript.async = true;
          html2canvasScript.onload = () => {
            console.log('html2canvas 已加載');
            scriptsLoaded.html2canvas = true;
            checkAllScriptsLoaded();
          };
          document.head.appendChild(html2canvasScript);

          // 加載 jspdf
          const jspdfScript = document.createElement('script');
          jspdfScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
          jspdfScript.async = true;
          jspdfScript.onload = () => {
            console.log('jsPDF 已加載');
            scriptsLoaded.jspdf = true;
            checkAllScriptsLoaded();
          };
          document.head.appendChild(jspdfScript);

          const checkAllScriptsLoaded = () => {
            if (scriptsLoaded.html2canvas && scriptsLoaded.jspdf) {
              setLibrariesLoaded(true);
              console.log('所有 PDF 生成所需庫已加載完成');
            }
          };
        } catch (error) {
          console.error('腳本加載錯誤:', error);
        }
      };
      
      loadScripts();
    }
  }, []);

  useEffect(() => {
    if (user?.user_id) {
      setConfig({
        type: CHAT_TYPES.SUNDAY_GUIDE,
        assistantId: ASSISTANT_IDS.SUNDAY_GUIDE,
        vectorStoreId: VECTOR_STORE_IDS.JOHNSUNG,
        userId: user.user_id
      });
      
      // 獲取檔案資訊
      fetchLatestFileInfo();
    }
  }, [user, setConfig]);
  
  // 頁面載入時自動選擇 summary 模式並載入內容
  useEffect(() => {
    if (user?.user_id && !sermonContent && !selectedMode) {
      handleModeSelect('summary');
    }
  }, [user, sermonContent, selectedMode]);

  const handleModeSelect = async (mode: GuideMode) => {
    setSelectedMode(mode);
    setLoading(true);
    try {
      const userId = user?.user_id || '';
      const response = await fetch(
        `/api/sunday-guide/content/${ASSISTANT_IDS.SUNDAY_GUIDE}?type=${mode}&userId=${encodeURIComponent(userId)}`
      );
      if (!response.ok) throw new Error('獲取內容失敗');
      const data = await response.json();
      setSermonContent(data.content);
      await refreshUsage();
    } catch (error) {
      console.error('獲取內容失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  // 獲取最新的文件資訊
  const fetchLatestFileInfo = async () => {
    try {
      const userId = user?.user_id || '';
      const response = await fetch(
        `/api/sunday-guide/documents?assistantId=${ASSISTANT_IDS.SUNDAY_GUIDE}&userId=${encodeURIComponent(userId)}`
      );
      if (!response.ok) throw new Error('獲取文件資訊失敗');
      const data = await response.json();
      
      if (data.success && data.records && data.records.length > 0) {
        // 按時間排序，獲取最新記錄
        const latestRecord = [...data.records].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )[0];
        
        setFileName(latestRecord.fileName || '未命名文件');
        
        // 格式化上傳時間，只顯示日期，使用洛杉磯地區格式
        const uploadDate = new Date(latestRecord.updatedAt);
        setUploadTime(uploadDate.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' }));
      }
    } catch (error) {
      console.error('獲取文件資訊失敗:', error);
    }
  };

  useEffect(() => {
    // 組件加載時獲取最新的文件資訊
    fetchLatestFileInfo();
  }, [user]);

  // 將繁體中文轉換為簡體中文（改進版本）
  const convertToSimplified = (text: string): string => {
    if (!text) return '';
    
    try {
      return text.split('').map(char => traditionalToSimplified[char] || char).join('');
    } catch (error) {
      console.error('繁簡轉換出錯:', error);
      return text; // 出錯時返回原文
    }
  };

  // 改進的PDF下載函數 - 使用伺服器端API下載
  const handleDownloadPDF = () => {
    if (!sermonContent || !selectedMode) {
      alert('無內容可下載，請先選擇一個主題。');
      return;
    }

    setPdfError(null);
    setPdfLoading(true);
    
    try {
      console.log('開始準備下載...');
      
      const userId = user?.user_id || '';
      
      // 使用伺服器端API直接下載HTML文件，添加assistantId參數
      const downloadUrl = `/api/sunday-guide/download-pdf?type=${selectedMode}&userId=${encodeURIComponent(userId)}&assistantId=${ASSISTANT_IDS.SUNDAY_GUIDE}`;
      
      // 在新分頁中打開下載URL
      window.open(downloadUrl, '_blank');
      
      console.log('下載請求已發送');
      
      // 短暫延遲後重置加載狀態
      setTimeout(() => {
        setPdfLoading(false);
      }, 1000);
      
    } catch (error) {
      console.error('PDF下載請求失敗:', error);
      setPdfError(error instanceof Error ? error.message : '下載PDF時發生錯誤，請重試');
      alert('PDF下載失敗: ' + (error instanceof Error ? error.message : '請稍後重試'));
      setPdfLoading(false);
    }
  };

  const renderContent = () => {
    if (loading) return <div className={styles.loading}>Loading, please wait...</div>;
    if (!sermonContent) return null;

    const titles = {
      summary: '讲道总结',
      text: '信息文字',
      devotional: '每日灵修',
      bible: '查经指引'
    };

    return (
      <div className={styles.contentBox}>
        <div className={styles.contentHeader}>
          <h2>{titles[selectedMode!]}</h2>
          <button 
            className={styles.downloadButton} 
            onClick={handleDownloadPDF}
            disabled={pdfLoading}
          >
            {pdfLoading ? '生成預覽中...' : '下载PDF(简体中文)'}
          </button>
        </div>
        {pdfError && <div className={styles.errorMessage}>{pdfError}</div>}
        <div className={styles.markdownContent} ref={contentRef}>
          <ReactMarkdown>{sermonContent}</ReactMarkdown>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>主日信息导航</h1>
      {fileName && (
        <div className={styles.fileInfo}>
          <div className={styles.fileNameBox}>
            <span className={styles.fileIcon}>📄</span>
            <span>{fileName}</span>
          </div>
          <div className={styles.uploadTimeBox}>
            <span className={styles.timeIcon}>🕒</span>
            <span>{uploadTime || '未知時間'}</span>
          </div>
        </div>
      )}
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

      {sermonContent ? (
        <div className={styles.contentWrapper}>
          <div className={`${styles.contentArea} ${styles.hasContent}`}>
            {renderContent()}
          </div>
          <div className={styles.chatSection}>
            {user && (
              <Chat 
                type={CHAT_TYPES.SUNDAY_GUIDE}
                assistantId={ASSISTANT_IDS.SUNDAY_GUIDE}
                vectorStoreId={VECTOR_STORE_IDS.JOHNSUNG}
                userId={user.user_id}
              />
            )}
          </div>
        </div>
      ) : (
        <div className={styles.emptyState}>
          <p>请选择要查看的内容类型</p>
        </div>
      )}
    </div>
  );
}

export default function UserSundayGuide() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Loading, please wait...</div>;
  }

  if (!user) {
    return <div>请先登录</div>;
  }

  return (
    <WithChat chatType={CHAT_TYPES.SUNDAY_GUIDE}>
      <SundayGuideContent />
    </WithChat>
  );
}