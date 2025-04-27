import { useState, useEffect, useRef } from 'react';
import styles from './AssistantManager.module.css';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';
import stylesGuide from '../sunday-guide/SundayGuide.module.css';

interface AssistantManagerProps {
  onFileProcessed: (content: {
    summary: string;
    fullText: string;
    devotional: string;
    bibleStudy: string;
  }) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  setUploadProgress: (progress: number) => void;
  setUploadTime: (time: string) => void;
}

interface TaskStatus {
  upload: 'idle' | 'processing' | 'completed';
  summary: 'idle' | 'processing' | 'completed';
  fullText: 'idle' | 'processing' | 'completed';
  devotional: 'idle' | 'processing' | 'completed';
  bibleStudy: 'idle' | 'processing' | 'completed';
}

export default function AssistantManager({ 
  onFileProcessed, 
  setIsProcessing, 
  setUploadProgress,
  setUploadTime
}: AssistantManagerProps) {
  const [error, setError] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus>({
    upload: 'idle',
    summary: 'idle',
    fullText: 'idle',
    devotional: 'idle',
    bibleStudy: 'idle'
  });
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [timeSpent, setTimeSpent] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [uploadSuccess, setUploadSuccess] = useState<boolean>(false);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [uploading, setUploading] = useState<boolean>(false);
  const [processing, setProcessing] = useState<boolean>(false);
  const [processingComplete, setProcessingComplete] = useState<boolean>(false);
  
  // 獲取PDT時間的輔助函數
  const getPDTTime = () => {
    const now = new Date();
    return now.toLocaleString('zh-TW', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }) + ' PDT';
  };

  // 計算處理時間
  const calculateTimeSpent = (startDate: Date, serverProcessingTime?: number) => {
    // 如果後端提供了處理時間，優先使用
    if (serverProcessingTime) {
      const diffInSec = Math.floor(serverProcessingTime / 1000);
      
      if (diffInSec < 60) {
        return `${diffInSec} 秒`;
      } else if (diffInSec < 3600) {
        const minutes = Math.floor(diffInSec / 60);
        const seconds = diffInSec % 60;
        return `${minutes} 分 ${seconds} 秒`;
      } else {
        const hours = Math.floor(diffInSec / 3600);
        const minutes = Math.floor((diffInSec % 3600) / 60);
        const seconds = diffInSec % 60;
        return `${hours} 小時 ${minutes} 分 ${seconds} 秒`;
      }
    }
    
    // 如果沒有後端處理時間，則使用前端計算的時間差
    const endDate = new Date();
    const diffInMs = endDate.getTime() - startDate.getTime();
    const diffInSec = Math.floor(diffInMs / 1000);
    
    if (diffInSec < 60) {
      return `${diffInSec} 秒`;
    } else if (diffInSec < 3600) {
      const minutes = Math.floor(diffInSec / 60);
      const seconds = diffInSec % 60;
      return `${minutes} 分 ${seconds} 秒`;
    } else {
      const hours = Math.floor(diffInSec / 3600);
      const minutes = Math.floor((diffInSec % 3600) / 60);
      const seconds = diffInSec % 60;
      return `${hours} 小時 ${minutes} 分 ${seconds} 秒`;
    }
  };

  const handleFileUpload = async (file: File) => {
    setIsProcessing(true);
    setUploadProgress(0);
    setUploading(true);
    setTaskStatus({
      upload: 'processing',
      summary: 'idle',
      fullText: 'idle',
      devotional: 'idle',
      bibleStudy: 'idle'
    });
    setStartTime(new Date());
    setFileName(file.name);
    setUploadSuccess(false);
    setUploadedFileName('');
    setProcessingComplete(false);
    
    try {
      setError(null);
      const formData = new FormData();
      formData.append('file', file);
      
      // 開始上傳文件
      const uploadResponse = await fetch(`/api/vector-store/upload?vectorStoreId=${VECTOR_STORE_IDS.JOHNSUNG}&assistantId=${ASSISTANT_IDS.SUNDAY_GUIDE}`, {
        method: 'POST',
        body: formData
      });
      
      if (!uploadResponse.ok) {
        let errorText = "未知錯誤";
        try { errorText = await uploadResponse.text(); } catch (e) { console.error("無法讀取錯誤響應:", e); }
        console.error("上傳失敗狀態碼:", uploadResponse.status, errorText);
        throw new Error(`文件上傳失敗: ${uploadResponse.status} - ${errorText}`);
      }
      
      // 上傳成功，更新狀態
      setTaskStatus(prev => ({ ...prev, upload: 'completed' }));
      setUploadSuccess(true);
      setUploadedFileName(file.name);
      setUploading(false);
      setUploadProgress(20);
      
    } catch (err) {
      console.error('文件處理錯誤:', err);
      setError(err instanceof Error ? err.message : '未知錯誤');
      setUploadProgress(0);
      setUploading(false);
      setTaskStatus({
        upload: 'idle',
        summary: 'idle',
        fullText: 'idle',
        devotional: 'idle',
        bibleStudy: 'idle'
      });
      setUploadSuccess(false);
      setUploadedFileName('');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProcessDocument = async () => {
    setIsProcessing(true);
    setProcessing(true);
    setTaskStatus(prev => ({ ...prev, summary: 'processing' }));
    setProcessingComplete(false);
    
    try {
      setError(null);
      const processResponse = await fetch('/api/sunday-guide/process-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assistantId: ASSISTANT_IDS.SUNDAY_GUIDE,
          vectorStoreId: VECTOR_STORE_IDS.JOHNSUNG,
          fileName: uploadedFileName
        })
      });
      
      if (!processResponse.ok) {
        throw new Error('文件處理失敗');
      }
      
      const result = await processResponse.json();
      
      if (result.summary) {
        setTaskStatus(prev => ({ ...prev, summary: 'completed', fullText: 'processing' }));
      }
      if (result.fullText) {
        setTaskStatus(prev => ({ ...prev, fullText: 'completed', devotional: 'processing' }));
      }
      if (result.devotional) {
        setTaskStatus(prev => ({ ...prev, devotional: 'completed', bibleStudy: 'processing' }));
      }
      if (result.bibleStudy) {
        setTaskStatus(prev => ({ ...prev, bibleStudy: 'completed' }));
      }
      
      const pdtTime = getPDTTime();
      setUploadTime(pdtTime);
      
      if (startTime) {
        const timeSpentStr = calculateTimeSpent(startTime, result.serverProcessingTime);
        setTimeSpent(timeSpentStr);
      }
      
      setUploadProgress(100);
      setProcessingComplete(true);
      
      if (onFileProcessed) {
        onFileProcessed(result);
      }
    } catch (err) {
      console.error('文件處理錯誤:', err);
      setError(err instanceof Error ? err.message : '未知錯誤');
      setTaskStatus(prev => ({ ...prev, summary: 'idle', fullText: 'idle', devotional: 'idle', bibleStudy: 'idle' }));
    } finally {
      setIsProcessing(false);
      setProcessing(false);
    }
  };

  // 清理定時器
  useEffect(() => {
    return () => {
      // 不再需要清理進度條的定時器
    };
  }, []);

  // 任務列表渲染
  const renderTaskList = () => {
    return (
      <div className={stylesGuide.taskList}>
        <div className={`${stylesGuide.taskItem} ${stylesGuide[taskStatus.upload]}`}>
          <div className={stylesGuide.taskIcon}>
            {taskStatus.upload === 'completed' ? (
              <span className={stylesGuide.checkIcon}>✓</span>
            ) : taskStatus.upload === 'processing' ? (
              <span className={stylesGuide.spinnerIcon}>⟳</span>
            ) : null}
          </div>
          <div className={stylesGuide.taskName}>上传文件</div>
        </div>
        
        <div className={`${stylesGuide.taskItem} ${stylesGuide[taskStatus.summary]}`}>
          <div className={stylesGuide.taskIcon}>
            {taskStatus.summary === 'completed' ? (
              <span className={stylesGuide.checkIcon}>✓</span>
            ) : taskStatus.summary === 'processing' ? (
              <span className={stylesGuide.spinnerIcon}>⟳</span>
            ) : null}
          </div>
          <div className={stylesGuide.taskName}>生成信息总结</div>
        </div>
        
        <div className={`${stylesGuide.taskItem} ${stylesGuide[taskStatus.fullText]}`}>
          <div className={stylesGuide.taskIcon}>
            {taskStatus.fullText === 'completed' ? (
              <span className={stylesGuide.checkIcon}>✓</span>
            ) : taskStatus.fullText === 'processing' ? (
              <span className={stylesGuide.spinnerIcon}>⟳</span>
            ) : null}
          </div>
          <div className={stylesGuide.taskName}>整理信息文字</div>
        </div>
        
        <div className={`${stylesGuide.taskItem} ${stylesGuide[taskStatus.devotional]}`}>
          <div className={stylesGuide.taskIcon}>
            {taskStatus.devotional === 'completed' ? (
              <span className={stylesGuide.checkIcon}>✓</span>
            ) : taskStatus.devotional === 'processing' ? (
              <span className={stylesGuide.spinnerIcon}>⟳</span>
            ) : null}
          </div>
          <div className={stylesGuide.taskName}>生成每日灵修</div>
        </div>
        
        <div className={`${stylesGuide.taskItem} ${stylesGuide[taskStatus.bibleStudy]}`}>
          <div className={stylesGuide.taskIcon}>
            {taskStatus.bibleStudy === 'completed' ? (
              <span className={stylesGuide.checkIcon}>✓</span>
            ) : taskStatus.bibleStudy === 'processing' ? (
              <span className={stylesGuide.spinnerIcon}>⟳</span>
            ) : null}
          </div>
          <div className={stylesGuide.taskName}>生成查经指引</div>
        </div>
        
        {timeSpent && (
          <div className={stylesGuide.timeSpent}>
            <span><span className={stylesGuide.timeIcon}>⏱</span> 处理时间：{timeSpent}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={styles.container}>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.uploadSection}>
        <h3>上传文件 <span className={styles.fileTypes}>.pdf,.txt,.doc,.docx</span></h3>
        <div className={styles.uploadForm}>
          <input
            type="file"
            accept=".pdf,.txt,.doc,.docx"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                handleFileUpload(file);
              }
            }}
          />
          
          {uploading && (
            <div className={styles.loadingCircle}>
              <span className={styles.spinner}>⟳</span> 上傳中...
            </div>
          )}
          
          {uploadSuccess && !processing && !processingComplete && (
            <div className={styles.successMsg}>
              文件「{uploadedFileName}」上傳成功！
              <button onClick={handleProcessDocument} disabled={processing} style={{marginLeft:8}}>
                {processing ? '处理中...' : '处理Go'}
              </button>
            </div>
          )}
          
          {processing && (
            <div className={styles.loadingCircle}>
              <span className={styles.spinner}>⟳</span> 处理中...
            </div>
          )}
          
          {processingComplete && (
            <div className={styles.successMsg}>
              <span style={{color:'green'}}>✓</span> 文件处理完成！您可以在下方查看处理结果。
            </div>
          )}
        </div>
      </div>
      
      {fileName && timeSpent && processingComplete && (
        <div className={stylesGuide.timeSpent}>
          <span>
            <span className={stylesGuide.timeIcon}>⏱</span> 
            文件：{fileName} | 处理完成，耗時：{timeSpent}
          </span>
        </div>
      )}
    </div>
  );
}