'use client';

import React, { useEffect, useState } from "react";
import styles from './TestModule.module.css';

interface VectorFile {
  fileName: string;
  uploadDate: string;
}

interface Prompt {
  id: string;
  content: string;
  lastUpdated: string;
}

const TestModule = () => {
  const [files, setFiles] = useState<VectorFile[]>([]);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

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

  // 获取当前Prompt
  const fetchPrompt = async () => {
    try {
      const response = await fetch('/api/prompt');
      if (!response.ok) throw new Error('获取Prompt失败');
      const data = await response.json();
      setPrompt(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    }
  };

  useEffect(() => {
    fetchFiles();
    fetchPrompt();
  }, []);

  // 处理文件上传
  const handleUpload = async () => {
    if (!newFile) return;
    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', newFile);

    try {
      const response = await fetch('/api/vector-store/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('文件上传失败');
      
      await fetchFiles(); // 刷新文件列表
      setNewFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setLoading(false);
    }
  };

  // 处理文件删除
  const handleDelete = async () => {
    if (selectedFiles.size === 0) return;
    
    try {
      // 并行处理所有删除请求
      await Promise.all(
        Array.from(selectedFiles).map(fileName =>
          fetch(`/api/vector-store/delete/${fileName}`, {
            method: 'DELETE',
          })
        )
      );

      await fetchFiles(); // 刷新文件列表
      setSelectedFiles(new Set()); // 清除选择
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  // 更新Prompt
  const handlePromptUpdate = async () => {
    if (!prompt) return;
    
    try {
      const response = await fetch('/api/prompt', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: prompt.content }),
      });

      if (!response.ok) throw new Error('更新Prompt失败');
      
      await fetchPrompt(); // 刷新Prompt
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
    }
  };

  // 修改选择处理函数
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
  };

  return (
    <div className={styles.container}>
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.gridContainer}>
        <section className={styles.section}>
          <h2>Vector Store 文件管理</h2>
          <div className={styles.fileUpload}>
            <input
              type="file"
              onChange={(e) => setNewFile(e.target.files?.[0] || null)}
              className={styles.fileInput}
            />
            <button 
              onClick={handleUpload}
              disabled={loading || !newFile}
              className={styles.button}
            >
              {loading ? '上传中...' : '上传文件'}
            </button>
            <button
              onClick={handleDelete}
              disabled={selectedFiles.size === 0}
              className={`${styles.button} ${styles.deleteButton}`}
            >
              删除所选 ({selectedFiles.size})
            </button>
          </div>

          <div className={styles.fileList}>
            {files.map((file) => (
              <div 
                key={file.fileName} 
                className={`${styles.fileItem} ${selectedFiles.has(file.fileName) ? styles.selected : ''}`}
                onClick={() => handleFileSelect(file.fileName)}
              >
                <span className={styles.fileName}>{file.fileName}</span>
                <span className={styles.uploadDate}>
                  {new Date(file.uploadDate).toLocaleString()}
                </span>
                <div className={styles.checkbox}>
                  {selectedFiles.has(file.fileName) && <span>✓</span>}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2>Prompt 管理</h2>
          {prompt && (
            <div className={styles.promptContainer}>
              <textarea
                value={prompt.content}
                onChange={(e) => setPrompt({ ...prompt, content: e.target.value })}
                className={styles.promptInput}
                rows={10}
              />
              <div className={styles.promptActions}>
                <span className={styles.lastUpdated}>
                  最后更新: {new Date(prompt.lastUpdated).toLocaleString()}
                </span>
                <button 
                  onClick={handlePromptUpdate}
                  className={styles.button}
                >
                  更新 Prompt
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default TestModule; 