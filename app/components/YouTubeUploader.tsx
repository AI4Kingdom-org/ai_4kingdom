'use client';

import { useState } from 'react';
import styles from './YouTubeUploader.module.css';

interface YouTubeUploaderProps {
  onVectorStoreCreated?: (vectorStoreId: string) => void;
}

export default function YouTubeUploader({ onVectorStoreCreated }: YouTubeUploaderProps) {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleUpload = async () => {
    if (!url.trim()) return;
    
    try {
      setIsLoading(true);
      setError('');
      
      // 直接上传 YouTube URL
      const response = await fetch('/api/sunday-guide/youtube', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url })  // 不再传入 vectorStoreId
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '上传失败');
      }

      const data = await response.json();
      console.log('上传成功:', data);
      
      // 3. 绑定 Assistant 和 Vector Store
      if (data.assistantId) {
        const bindResponse = await fetch(`/api/sunday-guide/assistants/${data.assistantId}/bind-vector-store`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            vectorStoreId: data.vectorStoreId
          })
        });

        if (!bindResponse.ok) {
          throw new Error('绑定 Vector Store 失败');
        }
      }
      
      // 4. 通知父组件 Vector Store 创建成功
      onVectorStoreCreated?.(data.vectorStoreId);
      
      setUrl('');

      // 在文件上传后添加验证
      console.log('正在检查文件状态...');
      const filesResponse = await fetch(`/api/vector-store/files?vectorStoreId=${data.vectorStoreId}`);
      const filesData = await filesResponse.json();
      console.log('Vector Store 文件列表:', filesData);

      if (!filesData.files?.length) {
        console.warn('警告: Vector Store 中没有找到文件');
      }
    } catch (error) {
      console.error('处理失败:', error);
      setError(error instanceof Error ? error.message : '上传失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="输入 YouTube 链接"
        className={styles.input}
        disabled={isLoading}
      />
      <button
        onClick={handleUpload}
        disabled={!url.trim() || isLoading}
        className={styles.button}
      >
        {isLoading ? '处理中...' : '上传'}
      </button>
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
} 