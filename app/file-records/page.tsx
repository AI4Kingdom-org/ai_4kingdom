'use client';

import { useState, useEffect } from 'react';
import styles from './page.module.css';
import { ASSISTANT_IDS } from '../config/constants';
import { useAuth } from '../contexts/AuthContext';
import BackToPortalLink from '../components/BackToPortalLink';

// 助手選擇器選項
const assistantOptions = [
  { id: '', label: '所有助手' },
  { id: ASSISTANT_IDS.SUNDAY_GUIDE, label: '牧者助手' },
  { id: ASSISTANT_IDS.JOHNSUNG, label: '宋尚節牧師' },
  { id: ASSISTANT_IDS.SPIRITUAL_PARTNER, label: '靈修伙伴' },
  { id: ASSISTANT_IDS.CHILDREN_MENTAL, label: '兒童心理' },
  { id: ASSISTANT_IDS.HOMESCHOOL, label: '家庭教育' },
  { id: ASSISTANT_IDS.GENERAL, label: '通用助手' }
];

// 文件記錄類型定義
interface FileRecord {
  assistantId: string;
  vectorStoreId: string;
  fileId: string;
  fileName: string;
  updatedAt: string;
  summary: string;
  fullText: string;
  devotional: string;
  bibleStudy: string;
  userId?: string;
}

export default function FileRecordsPage() {
  const { user } = useAuth();
  const [records, setRecords] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAssistant, setSelectedAssistant] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  // 分頁狀態
  const [currentPage, setCurrentPage] = useState(1);
  const recordsPerPage = 10;

  // 新增：選取檔案記錄的狀態 - 使用索引陣列而非 fileId
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);

  // 切換單一checkbox - 使用索引而非 fileId
  const handleCheckboxChange = (index: number) => {
    setSelectedIndices(prev =>
      prev.includes(index)
        ? prev.filter(i => i !== index)
        : [...prev, index]
    );
  };

  // 全選/全不選 - 使用索引陣列
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      // 全選目前頁面的所有索引
      setSelectedIndices(Array.from({ length: currentRecords.length }, (_, i) => i));
    } else {
      // 清空選取
      setSelectedIndices([]);
    }
  };
  // 單/多選刪除功能
  const handleDeleteSelected = async () => {
    if (selectedIndices.length === 0) {
      alert('請先勾選要刪除的檔案記錄');
      return;
    }
    
    // 獲取選取記錄的 fileId 陣列
    const selectedFileIds = selectedIndices.map(index => currentRecords[index].fileId).filter(Boolean);
    
    // 確認刪除
    if (!confirm(`確定要刪除已選取的 ${selectedFileIds.length} 個檔案嗎？此操作無法撤銷！`)) {
      return;
    }
    
    setDeleteLoading(true);
    setDeleteMessage(null);
    
    let successCount = 0;
    let failCount = 0;
    
    // 逐一刪除所選的檔案
    for (const fileId of selectedFileIds) {
      try {
        const response = await fetch(`/api/vector-store/delete-file`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fileId })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          successCount++;
        } else {
          failCount++;
          console.error('刪除檔案失敗:', data.error || '未知錯誤');
        }
      } catch (err) {
        failCount++;
        console.error('刪除檔案錯誤:', err);
      }
    }
    
    // 重新載入記錄
    await fetchRecords();
    
    // 設置結果訊息
    setDeleteMessage({
      type: failCount === 0 ? 'success' : 'error',
      text: `${successCount} 個檔案成功刪除${failCount > 0 ? `，${failCount} 個檔案刪除失敗` : ''}`
    });
    
    // 清空選取
    setSelectedIndices([]);
    
    setDeleteLoading(false);
    
    // 5秒後自動清除訊息
    setTimeout(() => {
      setDeleteMessage(null);
    }, 5000);
  };

  // 獲取文件記錄
  const fetchRecords = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const url = `/api/sunday-guide/documents${selectedAssistant ? `?assistantId=${selectedAssistant}` : ''}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('獲取文件記錄失敗');
      }
      
      const data = await response.json();
      
      if (data.success) {
        setRecords(data.records || []);
      } else {
        throw new Error(data.error || '獲取記錄時發生錯誤');
      }
    } catch (err) {
      console.error('獲取文件記錄錯誤:', err);
      setError(err instanceof Error ? err.message : '未知錯誤');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };
  
  // 初始載入及助手選擇變更時載入記錄
  useEffect(() => {
    if (user) {
      fetchRecords();
    }
  }, [user, selectedAssistant]);

  // 刪除所有文件記錄
  const deleteAllFiles = async () => {
    // 顯示確認對話框
    if (!confirm('確定要刪除所有向量儲存中的檔案嗎？此操作無法撤銷！')) {
      return;
    }
    
    setDeleteLoading(true);
    setDeleteMessage(null);
    
    try {
      const queryParams = selectedAssistant ? `?vectorStoreId=${selectedAssistant}` : '';
      
      const response = await fetch(`/api/vector-store/delete-all${queryParams}`, {
        method: 'DELETE',
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setDeleteMessage({
          type: 'success',
          text: `成功刪除了 ${data.deletedCount} 個檔案！`
        });
        
        // 重新載入記錄
        fetchRecords();
      } else {
        throw new Error(data.error || '刪除操作失敗');
      }
    } catch (err) {
      console.error('刪除所有檔案錯誤:', err);
      setDeleteMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '刪除失敗，請稍後再試'
      });
    } finally {
      setDeleteLoading(false);
      
      // 5秒後自動清除訊息
      setTimeout(() => {
        setDeleteMessage(null);
      }, 5000);
    }
  };

  // 過濾記錄
  const filteredRecords = records.filter(record => {
    if (!searchTerm) return true;
    
    const searchLower = searchTerm.toLowerCase();
    return (
      record.fileName.toLowerCase().includes(searchLower) ||
      record.updatedAt.toLowerCase().includes(searchLower)
    );
  });
  
  // 計算分頁（先排序，後分頁）
  // 先依 updatedAt 由新到舊排序
  const sortedRecords = [...filteredRecords].sort((a, b) => {
    const dateA = new Date(a.updatedAt).getTime();
    const dateB = new Date(b.updatedAt).getTime();
    return dateB - dateA;
  });
  const totalPages = Math.ceil(sortedRecords.length / recordsPerPage);
  const indexOfLastRecord = currentPage * recordsPerPage;
  const indexOfFirstRecord = indexOfLastRecord - recordsPerPage;
  const currentRecords = sortedRecords.slice(indexOfFirstRecord, indexOfLastRecord);

  // 格式化時間
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  // 獲取助手名稱
  const getAssistantName = (assistantId: string) => {
    const assistant = assistantOptions.find(opt => opt.id === assistantId);
    return assistant ? assistant.label : assistantId;
  };

  // 分頁控制
  const paginate = (pageNumber: number) => setCurrentPage(pageNumber);

  if (!user) {
    return <div className={styles.container}>請先登入以查看文件記錄</div>;
  }

  return (
    <div className={styles.container}>
      <BackToPortalLink />
      <h1 className={styles.title}>文件上傳記錄</h1>

      <div className={styles.section}>
        <div className={styles.headerActions}>
          <div className={styles.filterSection}>
            <select 
              className={styles.selectInput}
              value={selectedAssistant}
              onChange={(e) => setSelectedAssistant(e.target.value)}
            >
              {assistantOptions.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            
            <button 
              className={styles.button} 
              onClick={fetchRecords}
            >
              刷新記錄
            </button>
            
            <button 
              className={styles.dangerButton} 
              onClick={deleteAllFiles}
              disabled={deleteLoading}
            >
              {deleteLoading ? '刪除中...' : '刪除所有檔案'}
            </button>
          </div>
          
          <div>
            <input
              type="text"
              placeholder="搜尋文件名稱或日期..."
              className={styles.searchInput}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        
        {deleteMessage && (
          <div className={`${styles.message} ${styles[deleteMessage.type]}`}>
            {deleteMessage.text}
          </div>
        )}

        {error && (
          <div className={styles.error}>
            {error}
          </div>
        )}

        {loading ? (
          <div className={styles.loading}>載入中...</div>
        ) : (
          <>
            <table className={styles.recordsTable}>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={currentRecords.length > 0 && selectedIndices.length === currentRecords.length}
                      onChange={e => handleSelectAll(e.target.checked)}
                      aria-label="全選/全不選"
                    />
                  </th>
                  <th>文件名稱</th>
                  <th>助手ID</th>
                  <th>用戶ID</th>
                  <th>Vector Store ID</th>
                  <th>助手類型</th>
                  <th>上傳時間</th>
                  <th>處理狀態</th>
                </tr>
              </thead>
              <tbody>
                {currentRecords.length > 0 ? currentRecords.map((record, index) => (
                  <tr key={index}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIndices.includes(index)}
                        onChange={() => handleCheckboxChange(index)}
                        aria-label={`選取 ${record.fileName}`}
                      />
                    </td>
                    <td>{record.fileName}</td>
                    <td>{record.assistantId || '-'}</td>
                    <td>{record.userId || '-'}</td>
                    <td>{record.vectorStoreId || '-'}</td>
                    <td>{getAssistantName(record.assistantId)}</td>
                    <td>{formatDate(record.updatedAt)}</td>
                    <td>
                      <div>摘要: <span className={record.summary === '已生成' ? styles.statusSuccess : styles.statusPending}>{record.summary}</span></div>
                      <div>全文: <span className={record.fullText === '已生成' ? styles.statusSuccess : styles.statusPending}>{record.fullText}</span></div>
                      <div>靈修: <span className={record.devotional === '已生成' ? styles.statusSuccess : styles.statusPending}>{record.devotional}</span></div>
                      <div>查經: <span className={record.bibleStudy === '已生成' ? styles.statusSuccess : styles.statusPending}>{record.bibleStudy}</span></div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', color: '#888' }}>找不到文件記錄</td>
                  </tr>
                )}
              </tbody>
            </table>            <button
              className={styles.dangerButton}
              style={{ marginTop: 8, marginBottom: 8 }}
              onClick={handleDeleteSelected}
              disabled={selectedIndices.length === 0 || deleteLoading}
            >
              {deleteLoading ? '刪除中...' : '刪除選取檔案'}
            </button>
            
            {totalPages > 1 && (
              <div className={styles.paginationControls}>
                <button 
                  className={styles.pageButton}
                  onClick={() => paginate(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  上一頁
                </button>
                
                {Array.from({ length: totalPages }, (_, i) => (
                  <button
                    key={i + 1}
                    onClick={() => paginate(i + 1)}
                    className={`${styles.pageButton} ${currentPage === i + 1 ? styles.active : ''}`}
                  >
                    {i + 1}
                  </button>
                ))}
                
                <button 
                  className={styles.pageButton}
                  onClick={() => paginate(currentPage + 1)}
                  disabled={currentPage === totalPages}
                >
                  下一頁
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}