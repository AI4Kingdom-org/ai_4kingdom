'use client';

import React, { useEffect, useState } from "react";
import styles from './TestModule.module.css';

interface VectorFile {
  fileName: string;
  uploadDate: string;
  fileId: string;
}

const TestModule = () => {
  const [files, setFiles] = useState<VectorFile[]>([]);
  const [newFiles, setNewFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isAllSelected, setIsAllSelected] = useState(false);

  // 获取文件列表
  const fetchFiles = async () => {
    try {
      const response = await fetch('/api/vector-store/files');
      if (!response.ok) throw new Error('获取文件列表失败');
      const data = await response.json();
      setFiles(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  // 处理文件上传
  const handleUpload = async () => {
    if (!newFiles?.length) return;
    setLoading(true);
    setError(null);

    const formData = new FormData();
    Array.from(newFiles).forEach(file => {
      formData.append('files', file);
    });

    try {
      const response = await fetch('/api/vector-store/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || '上传失败');
      }
      
      if (response.status === 207) {
        setError(`部分文件上传失败: ${data.failedCount} 个文件未能上传`);
      }
      
      await fetchFiles();
      setNewFiles(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setLoading(false);
    }
  };

  // 处理全选
  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedFiles(new Set());
    } else {
      const allFileNames = new Set(files.map(file => file.fileName));
      setSelectedFiles(allFileNames);
    }
    setIsAllSelected(!isAllSelected);
  };

  // 处理单个文件选择
  const handleFileSelect = (fileName: string) => {
    setSelectedFiles(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(fileName)) {
        newSelection.delete(fileName);
      } else {
        newSelection.add(fileName);
      }
      return newSelection;
    });
    // 更新全选状态
    setIsAllSelected(selectedFiles.size === files.length);
  };

  // 处理批量删除
  const handleDelete = async () => {
    if (selectedFiles.size === 0) return;
    setLoading(true);
    setError(null);
    
    try {
      let failedFiles = [];
      
      // 串行处理删除请求，以避免可能的速率限制问题
      for (const fileName of selectedFiles) {
        try {
          const response = await fetch(`/api/vector-store/delete/${fileName}`, {
            method: 'DELETE',
          });
          
          if (!response.ok) {
            failedFiles.push(fileName);
          }
        } catch (err) {
          failedFiles.push(fileName);
        }
      }

      // 刷新文件列表
      await fetchFiles();
      // 清除选择
      setSelectedFiles(new Set());
      setIsAllSelected(false);

      // 如果有失败的文件，显示错误信息
      if (failedFiles.length > 0) {
        setError(`以下文件删除失败: ${failedFiles.join(', ')}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.section}>
        <h2>Vector Store 文件管理</h2>
        <div className={styles.fileUpload}>
          <input
            type="file"
            multiple
            onChange={(e) => setNewFiles(e.target.files)}
            className={styles.fileInput}
          />
          <button 
            onClick={handleUpload}
            disabled={loading || !newFiles?.length}
            className={styles.button}
          >
            {loading ? '上传中...' : '上传文件'}
          </button>
          <button
            onClick={handleDelete}
            disabled={loading || selectedFiles.size === 0}
            className={`${styles.button} ${styles.deleteButton}`}
          >
            删除所选 ({selectedFiles.size})
          </button>
        </div>

        <div className={styles.fileList}>
          <div className={styles.fileListHeader}>
            <label className={styles.selectAllLabel}>
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={handleSelectAll}
                className={styles.checkbox}
              />
              全选
            </label>
          </div>
          
          {files.map((file) => (
            <div 
              key={file.fileId}
              className={`${styles.fileItem} ${selectedFiles.has(file.fileName) ? styles.selected : ''}`}
            >
              <label className={styles.fileLabel}>
                <input
                  type="checkbox"
                  checked={selectedFiles.has(file.fileName)}
                  onChange={() => handleFileSelect(file.fileName)}
                  className={styles.checkbox}
                />
                <span className={styles.fileName}>{file.fileName}</span>
                <span className={styles.uploadDate}>
                  {new Date(file.uploadDate).toLocaleString()}
                </span>
              </label>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default TestModule; 