'use client';

import { useState, useEffect } from 'react';
import styles from './DocumentUploader.module.css';

interface DocumentUploaderProps {
  onUpload: (file: File) => Promise<void>;
  isProcessing: boolean;
}

// 錯誤詳細信息接口
interface ErrorDetails {
  error: string;
  errorType?: string;
  errorCode?: string;
  details?: string;
  context?: {
    step?: string;
    errorMessage?: string;
    elapsedTime?: number;
    // 其他可能的上下文信息
  };
  timestamp?: string;
}

export default function DocumentUploader({ onUpload, isProcessing }: DocumentUploaderProps) {
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<ErrorDetails | null>(null);
  const [summary, setSummary] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // 添加成功消息顯示的計時器效果
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (summary) {
      // 顯示成功消息 3 秒後自動隱藏
      timer = setTimeout(() => {
        setSummary('');
      }, 3000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [summary]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files?.length) {
      await handleFiles(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await handleFiles(file);
      // 清除輸入，這樣同一個文件可以再次上傳
      event.target.value = '';
    }
  };

  const handleFiles = async (file: File) => {
    setError(null);
    setErrorDetails(null);
    setSummary('');
    setShowDetails(false);

    try {
      // 檢查文件大小（限制為 20MB）
      const maxSize = 20 * 1024 * 1024; // 20MB
      if (file.size > maxSize) {
        throw new Error('文件大小不能超过 20MB');
      }

      await onUpload(file);
      setSummary(`文件 ${file.name} 上传成功！`);
    } catch (error) {
      console.error('上傳失敗詳情:', error);
      
      // 尝试提取详细错误信息
      let errorMessage = '上传失败';
      let details: ErrorDetails | null = null;
      
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // 檢查是否有響應數據
        if ((error as any).response) {
          try {
            const responseData = await (error as any).response.json();
            if (responseData) {
              details = responseData as ErrorDetails;
              errorMessage = details.error || errorMessage;
            }
          } catch (e) {
            console.warn('無法解析錯誤響應:', e);
          }
        } else if ((error as any).cause?.errorDetails) {
          details = (error as any).cause.errorDetails;
        }
      } else if (typeof error === 'object' && error !== null) {
        // 可能是已經解析的API錯誤響應
        details = error as ErrorDetails;
        errorMessage = details.error || '未知错误';
      }
      
      setError(errorMessage);
      setErrorDetails(details);
    }
  };

  // 格式化錯誤詳情顯示
  const renderErrorDetails = () => {
    if (!errorDetails) return null;
    
    return (
      <div className={styles.errorDetails}>
        <div className={styles.errorDetailItem}>
          <strong>錯誤類型:</strong> {errorDetails.errorType || '未知'}
        </div>
        {errorDetails.errorCode && (
          <div className={styles.errorDetailItem}>
            <strong>錯誤代碼:</strong> {errorDetails.errorCode}
          </div>
        )}
        {errorDetails.context?.step && (
          <div className={styles.errorDetailItem}>
            <strong>失敗階段:</strong> {errorDetails.context.step}
          </div>
        )}
        {errorDetails.context?.errorMessage && (
          <div className={styles.errorDetailItem}>
            <strong>詳細訊息:</strong> {errorDetails.context.errorMessage}
          </div>
        )}
        {errorDetails.context?.elapsedTime && (
          <div className={styles.errorDetailItem}>
            <strong>處理耗時:</strong> {(errorDetails.context.elapsedTime / 1000).toFixed(2)} 秒
          </div>
        )}
        {errorDetails.timestamp && (
          <div className={styles.errorDetailItem}>
            <strong>時間:</strong> {new Date(errorDetails.timestamp).toLocaleString()}
          </div>
        )}
        {errorDetails.details && (
          <div className={styles.stackTrace}>
            <details>
              <summary>錯誤堆疊</summary>
              <pre>{errorDetails.details}</pre>
            </details>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={styles.uploadContainer}>
      <div 
        className={`${styles.uploadArea} ${dragActive ? styles.dragActive : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
            <input
              type="file"
          id="document-upload"
              className={styles.fileInput}
          onChange={handleFileChange}
          disabled={isProcessing}
          accept=".pdf,.doc,.docx,.txt,.md,.rtf,.csv,.json,.xml,.html,.md,.markdown,.tex"
        />
        <label htmlFor="document-upload" className={styles.uploadLabel}>
          {isProcessing ? (
            <span>处理中...</span>
          ) : (
            <div>
              <p>点击或拖拽文件到此处上传</p>
              <p className={styles.supportedFormats}>
                支援格式：PDF、Word、TXT、Markdown、RTF、CSV、JSON、XML、HTML 等
              </p>
          </div>
          )}
              </label>
            </div>
            
      {error && (
        <div className={styles.error}>
          <div className={styles.errorMessage}>
            {error}
            {errorDetails && (
              <button 
                onClick={() => setShowDetails(!showDetails)} 
                className={styles.toggleDetailsBtn}
              >
                {showDetails ? '隱藏詳情' : '顯示詳情'}
              </button>
            )}
          </div>
          {showDetails && renderErrorDetails()}
        </div>
      )}
      
      {summary && <div className={styles.success}>{summary}</div>}
    </div>
  );
} 