'use client';

import { useState, useRef } from 'react';
import BackToPortalLink from '../components/BackToPortalLink';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';
import styles from './page.module.css';

interface UploadFile {
  file: File;
  id: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  errorMessage?: string;
}

interface AssistantOption {
  id: string;
  label: string;
  vectorStoreId: string;
}

const assistantOptions: AssistantOption[] = [
  { 
    id: ASSISTANT_IDS?.SUNDAY_GUIDE || 'asst_4QKJubuGno3Rw4iALWHExIh4', 
    label: '牧者助手', 
    vectorStoreId: VECTOR_STORE_IDS?.SUNDAY_GUIDE || 'vs_67c549731c10819192a57550f0dd37f4' 
  },
  { 
    id: ASSISTANT_IDS?.JOHNSUNG || 'asst_5QAFGCqN0BJvgz6FDc5bKhXx', 
    label: '宋尚節牧師', 
    vectorStoreId: VECTOR_STORE_IDS?.JOHNSUNG || 'vs_67c549731c10819192a57550f0dd37f4' 
  },
  { 
    id: ASSISTANT_IDS?.SPIRITUAL_PARTNER || 'asst_fKy4T9OgaIDNXjGTlQB9aoLm', 
    label: '靈修伙伴', 
    vectorStoreId: VECTOR_STORE_IDS?.SPIRITUAL_PARTNER || 'vs_67b2781f3d048191a8c9fc35d9ecd3ab' 
  },
  { 
    id: ASSISTANT_IDS?.CHILDREN_MENTAL || 'asst_LvMdndv0ZetWAaftw76CRraM', 
    label: '兒童心理', 
    vectorStoreId: VECTOR_STORE_IDS?.CHILDREN_MENTAL || 'vs_67b28ec53da48191863817002d79222b' 
  },
  { 
    id: ASSISTANT_IDS?.HOMESCHOOL || 'asst_fNylZyKusZ3fKmcR5USxIzbY', 
    label: '家庭教育', 
    vectorStoreId: VECTOR_STORE_IDS?.HOMESCHOOL || 'vs_67b28ec53da48191863817002d79222b' 
  },
  { 
    id: ASSISTANT_IDS?.GENERAL || 'asst_O9yodhRcFLqS28ZybIF35Y4o', 
    label: '通用助手', 
    vectorStoreId: VECTOR_STORE_IDS?.GENERAL || 'vs_AMJIJ1zfGnzHpI1msv4T8Ww3' 
  }
];

export default function FileUploadPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // 使用更穩健的初始化方式
  const [selectedAssistant, setSelectedAssistant] = useState<AssistantOption>(() => {
    const firstOption = assistantOptions[0] || {
      id: 'default',
      label: '預設助手',
      vectorStoreId: 'vs_default'
    };
    return firstOption;
  });
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 處理檔案選擇
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const newFiles: UploadFile[] = Array.from(files).map(file => ({
      file,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      status: 'pending',
      progress: 0
    }));

    setUploadFiles(prev => [...prev, ...newFiles]);
  };

  // 移除檔案
  const removeFile = (fileId: string) => {
    setUploadFiles(prev => prev.filter(f => f.id !== fileId));
  };

  // 清空所有檔案
  const clearAllFiles = () => {
    setUploadFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 上傳單一檔案
  const uploadSingleFile = async (uploadFile: UploadFile): Promise<boolean> => {
    const { file, id } = uploadFile;
    
    try {
      // 更新狀態為上傳中
      setUploadFiles(prev => prev.map(f => 
        f.id === id ? { ...f, status: 'uploading', progress: 0 } : f
      ));      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', 'anonymous'); // 使用匿名用戶ID

      const response = await fetch(
        `/api/vector-store/upload?vectorStoreId=${selectedAssistant.vectorStoreId}&assistantId=${selectedAssistant.id}`,
        {
          method: 'POST',
          body: formData
        }
      );      const data = await response.json();
      
      console.log('[DEBUG] 檔案上傳響應:', {
        ok: response.ok,
        status: response.status,
        success: data.success,
        data: data
      });

      if (response.ok && data.success) {
        // 上傳成功
        console.log('[DEBUG] 檔案上傳成功:', file.name);
        setUploadFiles(prev => prev.map(f => 
          f.id === id ? { ...f, status: 'success', progress: 100, completed: true } : f
        ));
        return true;
      } else {
        // 上傳失敗
        console.log('[DEBUG] 檔案上傳失敗:', { fileName: file.name, error: data.error });
        setUploadFiles(prev => prev.map(f => 
          f.id === id ? { 
            ...f, 
            status: 'error', 
            progress: 0,
            errorMessage: data.error || '上傳失敗' 
          } : f
        ));
        return false;
      }
    } catch (error) {
      // 發生錯誤
      setUploadFiles(prev => prev.map(f => 
        f.id === id ? { 
          ...f, 
          status: 'error', 
          progress: 0,
          errorMessage: error instanceof Error ? error.message : '網路錯誤' 
        } : f
      ));
      return false;
    }
  };

  // 開始上傳所有檔案
  const handleUploadAll = async () => {    if (uploadFiles.length === 0) {
      setMessage({ type: 'error', text: '請先選擇要上傳的檔案' });
      return;
    }

    setIsUploading(true);
    setMessage(null);

    let successCount = 0;
    let failCount = 0;

    // 逐一上傳檔案
    for (const uploadFile of uploadFiles) {
      if (uploadFile.status === 'pending') {
        const success = await uploadSingleFile(uploadFile);
        if (success) {
          successCount++;
        } else {
          failCount++;
        }
      }
    }

    setIsUploading(false);

    // 顯示結果訊息
    if (failCount === 0) {
      setMessage({ 
        type: 'success', 
        text: `成功上傳 ${successCount} 個檔案到 ${selectedAssistant.label}` 
      });
    } else {
      setMessage({ 
        type: 'error', 
        text: `${successCount} 個檔案上傳成功，${failCount} 個檔案上傳失敗` 
      });
    }

    // 5秒後清除訊息
    setTimeout(() => setMessage(null), 5000);
  };

  // 重試失敗的檔案
  const retryFailedFiles = async () => {
    const failedFiles = uploadFiles.filter(f => f.status === 'error');
    
    if (failedFiles.length === 0) return;

    setIsUploading(true);
    
    for (const uploadFile of failedFiles) {
      await uploadSingleFile(uploadFile);
    }
    
    setIsUploading(false);
  };

  // 格式化檔案大小
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 獲取狀態圖標
  const getStatusIcon = (status: UploadFile['status']) => {
    switch (status) {
      case 'pending': return '⏳';
      case 'uploading': return '⬆️';
      case 'success': return '✅';
      case 'error': return '❌';
      default: return '⏳';
    }  };

  return (
    <div className={styles.container}>
      <BackToPortalLink />
      <h1 className={styles.title}>檔案上傳</h1>

      <div className={styles.section}>
        <h2>選擇助手類型</h2>
        <div className={styles.assistantSelector}>
          {assistantOptions.map(option => (
            <label key={option.id} className={styles.assistantOption}>
              <input
                type="radio"
                name="assistant"
                value={option.id}
                checked={selectedAssistant.id === option.id}
                onChange={() => setSelectedAssistant(option)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>        <div className={styles.selectedInfo}>
          <p><strong>選中的助手：</strong> {selectedAssistant?.label || '未選擇'}</p>
          <p><strong>助手ID：</strong> {selectedAssistant?.id || '未設定'}</p>
          <p><strong>Vector Store ID：</strong> {selectedAssistant?.vectorStoreId || '未設定'}</p>
        </div>
      </div>

      <div className={styles.section}>
        <h2>選擇檔案</h2>
        <div className={styles.fileSelector}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.txt,.md"
            onChange={handleFileSelect}
            className={styles.fileInput}
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className={styles.selectButton}
          >
            選擇檔案
          </button>
          
          {uploadFiles.length > 0 && (
            <button 
              onClick={clearAllFiles}
              className={styles.clearButton}
              disabled={isUploading}
            >
              清空所有檔案
            </button>
          )}
        </div>
      </div>

      {uploadFiles.length > 0 && (
        <div className={styles.section}>
          <h2>檔案清單 ({uploadFiles.length} 個檔案)</h2>
          
          <div className={styles.fileList}>
            {uploadFiles.map(uploadFile => (
              <div key={uploadFile.id} className={styles.fileItem}>
                <div className={styles.fileInfo}>
                  <span className={styles.statusIcon}>
                    {getStatusIcon(uploadFile.status)}
                  </span>
                  <div className={styles.fileDetails}>
                    <div className={styles.fileName}>{uploadFile.file.name}</div>
                    <div className={styles.fileSize}>
                      {formatFileSize(uploadFile.file.size)}
                    </div>
                    {uploadFile.errorMessage && (
                      <div className={styles.errorMessage}>
                        {uploadFile.errorMessage}
                      </div>
                    )}
                  </div>
                </div>
                
                <div className={styles.fileActions}>
                  {uploadFile.status === 'uploading' && (
                    <div className={styles.progress}>
                      上傳中...
                    </div>
                  )}
                  
                  {uploadFile.status === 'pending' && (
                    <button 
                      onClick={() => removeFile(uploadFile.id)}
                      className={styles.removeButton}
                      disabled={isUploading}
                    >
                      移除
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.uploadActions}>
            <button 
              onClick={handleUploadAll}
              className={styles.uploadButton}
              disabled={isUploading || uploadFiles.every(f => f.status !== 'pending')}
            >
              {isUploading ? '上傳中...' : '開始上傳'}
            </button>
            
            {uploadFiles.some(f => f.status === 'error') && (
              <button 
                onClick={retryFailedFiles}
                className={styles.retryButton}
                disabled={isUploading}
              >
                重試失敗檔案
              </button>
            )}
          </div>
        </div>
      )}

      {message && (
        <div className={`${styles.message} ${styles[message.type]}`}>
          {message.text}
        </div>
      )}

      <div className={styles.uploadInfo}>
        <h3>上傳說明</h3>
        <ul>
          <li>支援的檔案格式：PDF、DOC、DOCX、TXT、MD</li>
          <li>可以一次選擇多個檔案進行批量上傳</li>
          <li>上傳的檔案會加入到選定助手的知識庫中</li>
          <li>檔案名稱不能重複，如有重複會顯示錯誤</li>
          <li>上傳後的檔案可在「文件記錄管理」中查看和管理</li>
        </ul>
      </div>
    </div>
  );
}
