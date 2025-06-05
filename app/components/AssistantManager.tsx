import { useState, useEffect, useRef } from 'react';
import styles from './AssistantManager.module.css';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';
import stylesGuide from '../sunday-guide/SundayGuide.module.css';
import { useCredit } from '../contexts/CreditContext';
import { useAuth } from '../contexts/AuthContext';
import { updateFileUploadTokenUsage, updateFileProcessingTokenUsage } from '../utils/fileProcessingTokens';

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
  disabled = false // 設置默認值為 false
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
  const [uploading, setUploading] = useState<boolean>(false);
  const [processing, setProcessing] = useState<boolean>(false);
  const [processingComplete, setProcessingComplete] = useState<boolean>(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string>('idle');
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [fileExists, setFileExists] = useState<boolean>(false);  // 新增：檔案是否已存在的狀態
  
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
      const uploadResponse = await fetch(`/api/vector-store/upload?vectorStoreId=${VECTOR_STORE_IDS.SUNDAY_GUIDE}&assistantId=${ASSISTANT_IDS.SUNDAY_GUIDE}`, {
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
      setUploading(false);
      setUploadProgress(20);
      
      // 文件上传成功后，记录 token 使用量
      if (user?.user_id) {
        // 根据文件大小估算页数，这里使用一个简单的估算公式
        const estimatedPages = Math.max(1, Math.ceil(file.size / (100 * 1024))); // 每 100KB 估算为 1 页
        await updateFileUploadTokenUsage(user.user_id, estimatedPages);
        // 立即刷新使用量显示
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
    
    // 文件处理成功后，记录 token 使用量
    if (user?.user_id) {
      // 估算处理的页数，可以根据内容长度来估算
      const textLength = (content.summary?.length || 0) + 
                         (content.fullText?.length || 0) + 
                         (content.devotional?.length || 0) + 
                         (content.bibleStudy?.length || 0);
      
      // 每 5000 字符估算为 1 页
      const estimatedPages = Math.max(1, Math.ceil(textLength / 5000));
      await updateFileProcessingTokenUsage(user.user_id, estimatedPages);
    }
    
    // 立即更新信用点数使用量
    await refreshUsage();
  };

  const checkProcessingStatus = async () => {
    try {
      const statusResponse = await fetch(`/api/sunday-guide/progress?vectorStoreId=${VECTOR_STORE_IDS.JOHNSUNG}&fileName=${encodeURIComponent(uploadedFileName)}`);
      
      if (!statusResponse.ok) {
        console.error('检查处理状态失败:', statusResponse.status);
        return;
      }
      
      const statusData = await statusResponse.json();
      
      if (statusData.status === 'completed') {
        // 处理完成，获取结果
        setProcessingStatus('completed');
        setProcessingComplete(true);
        setProcessing(false);
        
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        
        // 設置時間相關信息
        const pdtTime = getPDTTime();
        setUploadTime(pdtTime);
        
        if (startTime) {
          const timeSpentStr = calculateTimeSpent(startTime, statusData.processingTime);
          setTimeSpent(timeSpentStr);
        }
        
        // 更新任务状态
        setTaskStatus({
          upload: 'completed',
          summary: 'completed',
          fullText: 'completed',
          devotional: 'completed',
          bibleStudy: 'completed'
        });
        
        // 設置處理結果
        if (statusData.result) {
          handleFileProcessed(statusData.result);
        }
        
        setUploadProgress(100);
      } else if (statusData.status === 'failed') {
        // 处理失败
        setProcessingStatus('failed');
        setProcessingError(statusData.error || '文件处理失败');
        setProcessing(false);
        
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      } else if (statusData.status === 'processing') {
        // 更新处理阶段
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
    setTaskStatus(prev => ({ ...prev, summary: 'processing' }));
    setProcessingComplete(false);
    setProcessingError(null);
    
    try {
      // 记录处理开始时间
      const startProcessingTime = new Date();
      
      // 启动处理流程
      const processResponse = await fetch('/api/sunday-guide/process-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assistantId: ASSISTANT_IDS.SUNDAY_GUIDE,
          vectorStoreId: VECTOR_STORE_IDS.SUNDAY_GUIDE,
          fileName: uploadedFileName,
          userId: user?.user_id || '-' // 添加用户 ID
        })
      });
      
      if (!processResponse.ok) {
        let errorText = "未知错误";
        try { 
          const errorResponse = await processResponse.json();
          errorText = errorResponse.details || errorResponse.error || "处理过程中发生错误";
        } catch (e) { 
          console.error("无法解析错误响应:", e); 
          try {
            errorText = await processResponse.text();
          } catch (e2) {
            console.error("无法读取错误响应文本:", e2);
          }
        }
        console.error("处理失败状态码:", processResponse.status, errorText);
        throw new Error(`文件处理失败: ${processResponse.status} - ${errorText}`);
      }
      
      // 处理已启动，设置轮询检查
      const checkResult = async () => {
        try {
          // 直接查询数据库结果
          const resultResponse = await fetch(`/api/sunday-guide/check-result?vectorStoreId=${VECTOR_STORE_IDS.SUNDAY_GUIDE}&fileName=${encodeURIComponent(uploadedFileName)}`);
          
          if (!resultResponse.ok) {
            // 如果请求失败，等待后再试
            setTimeout(checkResult, 5000);
            return;
          }
          
          const result = await resultResponse.json();
          
          if (result.found) {
            // 处理完成，更新界面
            setProcessingComplete(true);
            setProcessing(false);
            
            // 设置处理时间
            const pdtTime = getPDTTime();
            setUploadTime(pdtTime);
            
            // 计算处理时间
            const processingTime = calculateTimeSpent(startProcessingTime, result.processingTime);
            setTimeSpent(processingTime);
            
            // 更新任务状态
            setTaskStatus({
              upload: 'completed',
              summary: 'completed',
              fullText: 'completed',
              devotional: 'completed',
              bibleStudy: 'completed'
            });
            
            // 设置完成进度
            setUploadProgress(100);
            
            // 回调函数，使用处理过的方法更新信用点数
            handleFileProcessed(result);
            
          } else {
            // 未找到处理结果，继续轮询
            setTimeout(checkResult, 5000);
          }
        } catch (err) {
          console.error('检查处理结果错误:', err);
          // 发生错误时，继续轮询
          setTimeout(checkResult, 5000);
        }
      };
      
      // 开始轮询检查结果
      setTimeout(checkResult, 5000);
      
      // 每 30 秒更新一次处理阶段，让用户看到进展
      let currentStage = 0;
      const stages = ['summary', 'fullText', 'devotional', 'bibleStudy'];
      
      const updateStage = () => {
        if (!processingComplete && processing) {
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
            
            return newStatus;
          });
          
          setTimeout(updateStage, 30000);
        }
      };
      
      setTimeout(updateStage, 30000);
      
    } catch (err) {
      console.error('文件处理错误:', err);
      setError(err instanceof Error ? err.message : '未知错误');
      setProcessingError(err instanceof Error ? err.message : '未知错误');
      setProcessingStatus('failed');
      setTaskStatus(prev => ({ ...prev, summary: 'idle', fullText: 'idle', devotional: 'idle', bibleStudy: 'idle' }));
      setProcessing(false);
    } finally {
      setIsProcessing(false);
    }
  };

  // 清理輪詢間隔
  useEffect(() => {
    return () => {
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

  return (
    <div className={styles.container}>
      {error && (
        <div className={fileExists ? styles.warning : styles.error}>
          {error}
        </div>
      )}
      <div className={styles.uploadSection}>
        <h3><span className={styles.fileTypes}>.pdf,.txt,.doc,.docx</span></h3>
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
            disabled={disabled} // 禁用上传按钮
          />
          
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
      
      {fileName && timeSpent && processingComplete && (
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