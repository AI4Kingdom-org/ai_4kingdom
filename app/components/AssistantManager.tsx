import { useState, useEffect, useRef } from 'react';
import styles from './AssistantManager.module.css';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';
import stylesGuide from '../sunday-guide/SundayGuide.module.css';
import { useCredit } from '../contexts/CreditContext';
import { useAuth } from '../contexts/AuthContext';
// Token deduction is done via /api/usage/update-tokens (server-side) to avoid browser DynamoDB SDK issues

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
  disabled?: boolean; // 添加 disabled 屬性支援
  assistantId?: string; // 新增：可覆寫助手 ID
  vectorStoreId?: string; // 新增：可覆寫向量庫 ID
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
  setUploadTime,
  disabled = false,
  assistantId = ASSISTANT_IDS.SUNDAY_GUIDE,
  vectorStoreId = VECTOR_STORE_IDS.SUNDAY_GUIDE
}: AssistantManagerProps) {
  const { refreshUsage } = useCredit();
  const { user } = useAuth(); // 添加 useAuth 以獲取用戶 ID
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
  const [uploadedFileId, setUploadedFileId] = useState<string>('');
  const [uploading, setUploading] = useState<boolean>(false);
  const [processing, setProcessing] = useState<boolean>(false);
  const [processingComplete, setProcessingComplete] = useState<boolean>(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string>('idle');
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isPollingActiveRef = useRef<boolean>(false);
  const [fileExists, setFileExists] = useState<boolean>(false);  // 新增：檔案是否已存在的狀態
  // 新增：處理完成訊息顯示狀態
  const [showFinalResult, setShowFinalResult] = useState(false);
  // Drag-and-drop state
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
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
    setFileExists(false); // 重置檔案存在狀態
    
    try {
      setError(null);
      const formData = new FormData();
      formData.append('file', file);
      
      // 添加用戶 ID 到上傳請求
      if (user?.user_id) {
        formData.append('userId', user.user_id);
      }
      
      // 開始上傳文件
    // 單位上下文：agape 或 eastChristHome（依 URL 判斷）
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
    const unitQS = pathname.includes('agape-church')
      ? '&unitId=agape'
      : (pathname.includes('east-christ-home') ? '&unitId=eastChristHome' : (pathname.includes('jian-zhu') ? '&unitId=jianZhu' : ''));
  const uploadResponse = await fetch(`/api/vector-store/upload?vectorStoreId=${vectorStoreId}&assistantId=${assistantId}${unitQS}` , {
        method: 'POST',
        body: formData
      });
      
      // 解析響應
      let responseData;
      try {
        responseData = await uploadResponse.json();
      } catch (e) {
        console.error("無法解析回應:", e);
        throw new Error(`文件上傳失敗: ${uploadResponse.status}`);
      }

      // 檢查檔案是否已存在
      if (uploadResponse.status === 409 && responseData?.fileExists) {
        console.log("文件已存在:", responseData);
        setFileExists(true);
        setError(responseData.details || "文件已存在，请使用不同的文件名称");
        setUploading(false);
        setUploadProgress(0);
        setTaskStatus(prev => ({ ...prev, upload: 'idle' }));
        return;
      }
      
      if (!uploadResponse.ok) {
        console.error("上传失败状态码:", uploadResponse.status, responseData?.error || "未知错误");
        throw new Error(`文件上传失败: ${uploadResponse.status} - ${responseData?.error || "未知错误"}`);
      }
      
      // 上传成功，更新状态
      setTaskStatus(prev => ({ ...prev, upload: 'completed' }));
      setUploadSuccess(true);
      setUploadedFileName(file.name);
      setUploadedFileId(responseData.fileId || '');
      setUploading(false);
      setUploadProgress(20);
      
      // 文件上传成功后，扣除 token 使用量（透過 server-side API，避免 browser 直接呼叫 DynamoDB）
      if (user?.user_id) {
        const estimatedPages = Math.max(1, Math.ceil(file.size / (100 * 1024))); // 每 100KB 估算為 1 頁
        try {
          await fetch('/api/usage/update-tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.user_id, type: 'upload', estimatedPages }),
          });
        } catch (tokenErr) {
          console.error('[AssistantManager] 上傳 token 扣除失敗:', tokenErr);
        }
        await refreshUsage();
      }
      
    } catch (err) {
      console.error('文件处理错误:', err);
      setError(err instanceof Error ? err.message : '未知错误');
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

  const handleFileProcessed = async (content: {
    summary: string;
    fullText: string;
    devotional: string;
    bibleStudy: string;
  }) => {
    // 先通知父組件處理結果
    onFileProcessed(content);
    
    // 文件处理成功后，扣除 token 使用量（透過 server-side API，避免 browser 直接呼叫 DynamoDB）
    if (user?.user_id) {
      const textLength = (content.summary?.length || 0) +
                         (content.fullText?.length || 0) +
                         (content.devotional?.length || 0) +
                         (content.bibleStudy?.length || 0);
      const estimatedPages = Math.max(1, Math.ceil(textLength / 5000)); // 每 5000 字估算為 1 頁
      try {
        await fetch('/api/usage/update-tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.user_id, type: 'process', estimatedPages }),
        });
      } catch (tokenErr) {
        console.error('[AssistantManager] 處理 token 扣除失敗:', tokenErr);
      }
    }

    // 立即更新信用点数使用量
    await refreshUsage();
    
    // 新增：通知其他頁面（如 /user-sunday-guide）有新檔案上傳完成
    try {
      const assistantIdForModule = assistantId === ASSISTANT_IDS.SUNDAY_GUIDE ? 'sunday-guide' : 'other';
      const channel = new BroadcastChannel('file-upload-complete');
      channel.postMessage({
        type: 'FILE_UPLOAD_COMPLETE',
        fileName: uploadedFileName,
        timestamp: Date.now(),
        assistantId: assistantId,
        module: assistantIdForModule
      });
      channel.close();
      console.log('[DEBUG] 已通知其他頁面檔案上傳完成:', uploadedFileName, '模組:', assistantIdForModule);
    } catch (error) {
      console.error('[DEBUG] BroadcastChannel 通知失敗:', error);
    }
  };

  const checkProcessingStatus = async () => {
    try {
  const statusResponse = await fetch(`/api/sunday-guide/progress?vectorStoreId=${vectorStoreId}&fileName=${encodeURIComponent(uploadedFileName)}`);
      if (!statusResponse.ok) {
        console.error('检查处理状态失败:', statusResponse.status);
        return;
      }
      const statusData = await statusResponse.json();
      // 僅在所有 summary/devotional/bibleStudy 都完成時才顯示耗時
      const allCompleted = statusData.status === 'completed' &&
        statusData.result &&
        statusData.result.summary &&
        statusData.result.devotional &&
        statusData.result.bibleStudy;
      if (allCompleted) {
        setProcessingStatus('completed');
        setProcessingComplete(true);
        setProcessing(false);
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        const pdtTime = getPDTTime();
        setUploadTime(pdtTime);
        if (startTime) {
          const timeSpentStr = calculateTimeSpent(startTime, statusData.processingTime);
          setTimeSpent(timeSpentStr);
        }
        setTaskStatus({
          upload: 'completed',
          summary: 'completed',
          fullText: 'completed',
          devotional: 'completed',
          bibleStudy: 'completed'
        });
        if (statusData.result) {
          handleFileProcessed(statusData.result);
        }
        setUploadProgress(100);
      } else if (statusData.status === 'failed') {
        setProcessingStatus('failed');
        setProcessingError(statusData.error || '文件处理失败');
        setProcessing(false);
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      } else if (statusData.status === 'processing') {
        setProcessingStatus('processing');
        if (statusData.stage === 'summary') {
          setTaskStatus(prev => ({ ...prev, summary: 'processing' }));
        } else if (statusData.stage === 'fullText') {
          setTaskStatus(prev => ({ ...prev, summary: 'completed', fullText: 'processing' }));
        } else if (statusData.stage === 'devotional') {
          setTaskStatus(prev => ({ ...prev, summary: 'completed', fullText: 'completed', devotional: 'processing' }));
        } else if (statusData.stage === 'bibleStudy') {
          setTaskStatus(prev => ({ ...prev, summary: 'completed', fullText: 'completed', devotional: 'completed', bibleStudy: 'processing' }));
        }
      }
    } catch (err) {
      console.error('检查处理状态出错:', err);
    }
  };

  const handleProcessDocument = async () => {
    setIsProcessing(true);
    setProcessing(true);
    isPollingActiveRef.current = true;
    setTaskStatus(prev => ({ ...prev, summary: 'processing' }));
    setProcessingComplete(false);
    setProcessingError(null);
    
    try {
      // 记录处理开始时间
      const startProcessingTime = new Date();
      
      // 啟動處理流程（fire-and-forget：不 await，避免 CloudFront 30s 超時）
      fetch('/api/sunday-guide/process-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assistantId,
          vectorStoreId,
          fileName: uploadedFileName,
          fileId: uploadedFileId || undefined,
          userId: user?.user_id || '-'
        })
      }).catch(e => console.log('[AssistantManager] process-document kick:', e.message));
      
      // 立即開始輪詢檢查結果
      let pollAttempts = 0;
      const MAX_POLL_ATTEMPTS = 150; // ~7.5 分鐘
      const checkResult = async () => {
        pollAttempts++;
        if (pollAttempts > MAX_POLL_ATTEMPTS) {
          isPollingActiveRef.current = false;
          setProcessing(false);
          setIsProcessing(false);
          setProcessingError('處理逾時，請重新上傳或稍後再試。');
          setProcessingStatus('failed');
          setTaskStatus(prev => ({ ...prev, summary: 'idle', fullText: 'idle', devotional: 'idle', bibleStudy: 'idle' }));
          return;
        }
        try {
          const resultResponse = await fetch(`/api/sunday-guide/check-result?vectorStoreId=${vectorStoreId}&fileName=${encodeURIComponent(uploadedFileName)}`);
          if (!resultResponse.ok) {
            setTimeout(checkResult, 5000);
            return;
          }
          const result = await resultResponse.json();
          if (result.status === 'failed') {
            isPollingActiveRef.current = false;
            setProcessing(false);
            setIsProcessing(false);
            setProcessingError(result.error || '文件處理失敗，請重新嘗試。');
            setProcessingStatus('failed');
            setTaskStatus(prev => ({ ...prev, summary: 'idle', fullText: 'idle', devotional: 'idle', bibleStudy: 'idle' }));
            return;
          }
          if (result.found) {
            isPollingActiveRef.current = false;
            setProcessingComplete(true);
            setProcessing(false);
            setShowFinalResult(true);
            const pdtTime = getPDTTime();
            setUploadTime(pdtTime);
            const processingTime = calculateTimeSpent(startProcessingTime, result.processingTime);
            setTimeSpent(processingTime);
            setTaskStatus({
              upload: 'completed',
              summary: 'completed',
              fullText: 'completed',
              devotional: 'completed',
              bibleStudy: 'completed'
            });
            setUploadProgress(100);
            handleFileProcessed(result);
          } else {
            setShowFinalResult(false);
            setTimeout(checkResult, 3000);
          }
        } catch (err) {
          setTimeout(checkResult, 5000);
        }
      };

      setTimeout(checkResult, 2000);
      
      // 每 20 秒更新一次处理阶段，让用户看到进展（缩短更新间隔）
      let currentStage = 0;
      const stages = ['summary', 'fullText', 'devotional', 'bibleStudy'];          const updateStage = () => {
        if (isPollingActiveRef.current) {
          currentStage = (currentStage + 1) % stages.length;
          setTaskStatus(prev => {
            const newStatus = { ...prev };
            
            // 将前面的阶段标记为完成
            for (let i = 0; i < currentStage; i++) {
              newStatus[stages[i] as keyof TaskStatus] = 'completed';
            }
            
            // 将当前阶段标记为处理中
            newStatus[stages[currentStage] as keyof TaskStatus] = 'processing';
            
            // 将后面的阶段标记为空闲
            for (let i = currentStage + 1; i < stages.length; i++) {
              newStatus[stages[i] as keyof TaskStatus] = 'idle';
            }
            
            // 更新进度条，给用户更明确的进展提示
            const progressPercentage = Math.min(80, 20 + (currentStage * 20));
            setUploadProgress(progressPercentage);
            
            return newStatus;
          });
          
          // 缩短更新间隔到20秒
          setTimeout(updateStage, 20000);
        }
      };
      
      setTimeout(updateStage, 15000);
      
    } catch (err) {
      console.error('文件处理错误:', err);
      setError(err instanceof Error ? err.message : '未知错误');
      setProcessingError(err instanceof Error ? err.message : '未知错误');
      setProcessingStatus('failed');
      setTaskStatus(prev => ({ ...prev, summary: 'idle', fullText: 'idle', devotional: 'idle', bibleStudy: 'idle' }));
      isPollingActiveRef.current = false;
      setProcessing(false);
    } finally {
      setIsProcessing(false);
    }
  };

  // 清理輪詢間隔
  useEffect(() => {
    return () => {
      isPollingActiveRef.current = false;
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  // 通知父组件处理完成后，尝试刷新 user-sunday-guide 页面内容（不跳转）
  useEffect(() => {
    if (processingComplete) {
      // 尝试在父页面存在特定刷新函数时调用
      if (window && window.dispatchEvent) {
        window.dispatchEvent(new Event('user-sunday-guide-refresh'));
      }
    }
  }, [processingComplete]);

  // 任务列表渲染
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

  // Drag-and-drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file);
  };

  return (
    <div className={styles.container}>
      {error && (
        <div className={fileExists ? styles.warning : styles.error}>
          {error}
        </div>
      )}
      <div className={styles.uploadSection}>
        <div className={styles.uploadForm}>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.doc,.docx"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
              // reset so same file can be re-selected
              e.target.value = '';
            }}
            disabled={disabled}
          />
          {/* Drag-and-drop zone */}
          <div
            className={`${styles.dropZone} ${isDragging ? styles.dropZoneDragging : ''} ${disabled ? styles.dropZoneDisabled : ''}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => { if (!disabled) fileInputRef.current?.click(); }}
          >
            <span className={styles.dropIcon}>📄</span>
            <span className={styles.dropMain}>
              {isDragging ? '放开以上传' : '点击或拖放文件到此处'}
            </span>
            <span className={styles.dropSub}>支持格式：.pdf、.txt、.doc、.docx</span>
          </div>
          
          {uploading && (
            <div className={styles.loadingCircle}>
              <span className={styles.spinner}>⟳</span> 上传中...
            </div>
          )}
          
          {uploadSuccess && !processing && !processingComplete && (
            <div className={styles.successMsg}>
              文件「{uploadedFileName}」上传成功！
              <button onClick={handleProcessDocument} disabled={processing || disabled} style={{marginLeft:8}}>
                {processing ? '处理中...' : '开始处理'}
              </button>
            </div>
          )}
          
          {processing && (
            <div className={styles.loadingCircle}>
              <span className={styles.spinner}>⟳</span> 处理中...
              {processingStatus === 'processing' && (
                <span style={{marginLeft: '10px'}}>
                  {taskStatus.summary === 'processing' && '生成摘要中...'}
                  {taskStatus.fullText === 'processing' && '整理文本中...'}
                  {taskStatus.devotional === 'processing' && '生成灵修中...'}
                  {taskStatus.bibleStudy === 'processing' && '生成查经指引中...'}
                </span>
              )}
              <div style={{fontSize: '0.8rem', marginTop: '0.3rem', color: '#666'}}>
                此過程可能需要幾分鐘，請耐心等待完整處理結果
              </div>
            </div>
          )}
          
          {processingError && (
            <div className={styles.error} style={{marginTop: '10px'}}>
              处理失败: {processingError}
            </div>
          )}
          
          {processingComplete && (
            <></>
          )}
        </div>
      </div>
      
      {fileName && timeSpent && showFinalResult && (
        <div className={stylesGuide.timeSpent}>
          <span>
            <span className={stylesGuide.timeIcon}>⏱</span> 
            文件：{fileName} | 处理完成，耗时：{timeSpent}
          </span>
        </div>
      )}
    </div>
  );
}