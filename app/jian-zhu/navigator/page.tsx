"use client";

import { useEffect, useState } from 'react';
import WithChat from '../../components/layouts/WithChat';
import styles from '../../sunday-guide/SundayGuide.module.css';

interface FileItem { fileId: string; fileName: string; uploaderId?: string; updatedAt?: string; }

export default function JianZhuNavigatorPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const filesPerPage = 20;

  const fetchFiles = async (page: number = 1) => {
    try {
      const res = await fetch(`/api/sunday-guide/documents?page=${page}&limit=${filesPerPage}&allUsers=true&unitId=jianZhu`);
      if (!res.ok) throw new Error('讀取失敗');
      const data = await res.json();
      if (data.success && data.records) {
        const sorted = data.records.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        const mapped = sorted.map((rec: any) => ({ fileId: rec.fileId, fileName: rec.fileName || '未命名', uploaderId: rec.userId, updatedAt: rec.updatedAt }));
        setFiles(mapped);
        setTotalPages(Math.ceil((data.totalCount || mapped.length) / filesPerPage));
      } else { setFiles([]); setTotalPages(1); }
    } catch { setFiles([]); setTotalPages(1); }
  };

  useEffect(() => { fetchFiles(1); localStorage.setItem('currentUnitId', 'jianZhu'); }, []);

  return (
    <WithChat chatType="sunday-guide">
      <div className={styles.navigatorContainer}>
        <h2 className={styles.sectionTitle}>Jian Zhu Navigator</h2>
        {files.length === 0 ? (
          <div className={styles.noRecentFiles}>沒有可瀏覽文檔</div>
        ) : (
          <ul className={styles.recentFilesListScrollable}>
            {files.map((file, idx) => (
              <li
                key={file.fileId || idx}
                className={styles.recentFileItem}
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  try {
                    localStorage.setItem('selectedFileId', file.fileId);
                    localStorage.setItem('selectedFileName', file.fileName);
                    localStorage.setItem('currentUnitId', 'jianZhu');
                    const channel = new BroadcastChannel('file-selection');
                    channel.postMessage({ type: 'FILE_SELECTED', fileId: file.fileId, fileName: file.fileName, ts: Date.now() });
                    channel.close();
                  } catch {}
                }}
              >
                <span className={styles.fileIndex}>{idx + 1}. </span>
                <span className={styles.fileName}>{file.fileName}</span>
                <span className={styles.uploadDate}>{file.updatedAt ? new Date(file.updatedAt).toLocaleDateString('zh-TW') : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </WithChat>
  );
}
