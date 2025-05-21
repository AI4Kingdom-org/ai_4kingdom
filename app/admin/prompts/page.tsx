'use client';

import React, { useEffect, useState } from 'react';
import BackToPortalLink from '../../components/BackToPortalLink';

interface PromptItem {
  id: string;
  content: string;
  lastUpdated?: string;
}

export default function PromptsEditor() {
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [newPrompt, setNewPrompt] = useState('');
  const [newId, setNewId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 讀取所有 prompts
  const fetchPrompts = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/prompts');
      const data = await res.json();
      if (data.success) setPrompts(data.items);
      else setError(data.error || '讀取失敗');
    } catch (e) {
      setError('讀取失敗');
    }
    setLoading(false);
  };

  useEffect(() => { fetchPrompts(); }, []);

  // 自動調整文本區域高度的效果
  useEffect(() => {
    const adjustTextareaHeights = () => {
      const textareas = document.querySelectorAll('textarea') as NodeListOf<HTMLTextAreaElement>;
      textareas.forEach(textarea => {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
      });
    };
    
    // 初始調整
    setTimeout(adjustTextareaHeights, 0);
    
    // 當 editingId 或 prompts 改變時調整
    return adjustTextareaHeights;
  }, [editingId, prompts, newPrompt, editingContent]);

  // 新增 prompt
  const handleAdd = async () => {
    if (!newId || !newPrompt) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: newId, content: newPrompt })
      });
      const data = await res.json();
      if (data.success) {
        setNewId('');
        setNewPrompt('');
        fetchPrompts();
      } else setError(data.error || '新增失敗');
    } catch (e) {
      setError('新增失敗');
    }
    setLoading(false);
  };
  // 編輯 prompt
  const handleEdit = (item: PromptItem) => {
    setEditingId(item.id);
    setEditingContent(item.content);
    
    // 確保文本區域在下次渲染後調整高度
    setTimeout(() => {
      const textarea = document.querySelector('textarea[value="' + item.content + '"]') as HTMLTextAreaElement;
      if (textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
      }
    }, 0);
  };
  const handleSaveEdit = async () => {
    if (!editingId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, content: editingContent })
      });
      const data = await res.json();
      if (data.success) {
        setEditingId(null);
        setEditingContent('');
        fetchPrompts();
      } else setError(data.error || '編輯失敗');
    } catch (e) {
      setError('編輯失敗');
    }
    setLoading(false);
  };

  // 刪除 prompt
  const handleDelete = async (id: string) => {
    if (!window.confirm('確定要刪除嗎？')) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/prompts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success) fetchPrompts();
      else setError(data.error || '刪除失敗');
    } catch (e) {
      setError('刪除失敗');
    }
    setLoading(false);
  };
  return (
    <div style={{ maxWidth: 1050, margin: '40px auto', padding: 24, background: '#fff', borderRadius: 8 }}>
      <BackToPortalLink />
      <h2>AI Prompts 管理</h2>
      {error && <div style={{ color: 'red', marginBottom: 8 }}>{error}</div>}      <div style={{ marginBottom: 16 }}>        <input
          placeholder="ID"
          value={newId}
          onChange={e => setNewId(e.target.value)}
          style={{ width: 80, marginRight: 8, padding: '6px', border: '1px solid #aac', borderRadius: '4px' }}
          disabled={loading}        />        <textarea
          placeholder="Prompt 內容"
          value={newPrompt}
          onChange={e => setNewPrompt(e.target.value)}
          style={{ 
            width: 480, 
            minHeight: 80, 
            marginRight: 8, 
            verticalAlign: 'top', 
            resize: 'vertical', 
            padding: '6px', 
            border: '1px solid #aac', 
            borderRadius: '4px',
            overflowY: 'hidden' // 隱藏垂直滾動條
          }}
          rows={Math.max(3, newPrompt.split('\n').length + 1)}
          disabled={loading}
          onInput={(e) => {
            // 自動調整高度
            const target = e.target as HTMLTextAreaElement;
            target.style.height = 'auto';
            target.style.height = `${target.scrollHeight}px`;
          }}
        />
        <button 
          onClick={handleAdd} 
          disabled={loading || !newId || !newPrompt}
          style={{ 
            padding: '8px 16px', 
            backgroundColor: (!newId || !newPrompt) ? '#cccccc' : '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading || !newId || !newPrompt ? 'not-allowed' : 'pointer'
          }}
        >
          新增
        </button>
      </div>      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #ccc', borderRadius: '4px' }}>
        <thead>
          <tr style={{ background: '#deeaff' }}>
            <th style={{ width: 60, padding: '10px', borderBottom: '2px solid #ccc' }}>ID</th>
            <th style={{ padding: '10px', borderBottom: '2px solid #ccc' }}>內容</th>
            <th style={{ width: 120, padding: '10px', borderBottom: '2px solid #ccc' }}>最後更新</th>
            <th style={{ width: 140, padding: '10px', borderBottom: '2px solid #ccc' }}>操作</th>
          </tr>
        </thead>        <tbody>          {[...prompts].reverse().map((item, index) => (            <tr key={item.id} style={{ background: index % 2 === 0 ? '#e6f2ff' : 'white' }}>
              <td style={{ padding: '10px', verticalAlign: 'top', wordBreak: 'break-all' }}>{item.id}</td>              <td style={{ padding: '10px', verticalAlign: 'top' }}>{editingId === item.id ? (<textarea
                    value={editingContent}
                    onChange={e => setEditingContent(e.target.value)}
                    style={{ 
                      width: '100%', 
                      minHeight: '120px', 
                      height: 'auto',
                      resize: 'vertical', 
                      border: '1px solid #aac', 
                      borderRadius: '4px',
                      padding: '8px',
                      overflowY: 'hidden' // 隱藏垂直滾動條
                    }}                    disabled={loading}
                    rows={Math.max(10, editingContent.split('\n').length + 2)} // 增加最小行數以確保內容可見
                    onInput={(e) => {
                      // 自動調整高度
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = `${target.scrollHeight}px`;
                    }}
                    ref={(el) => {
                      // 組件掛載後立即調整高度
                      if (el) {
                        setTimeout(() => {
                          el.style.height = 'auto';
                          el.style.height = `${el.scrollHeight}px`;
                        }, 0);
                      }
                    }}
                  />) : (
                  <pre style={{ 
                    whiteSpace: 'pre-wrap', 
                    margin: 0, 
                    padding: '8px', 
                    height: 'auto',
                    backgroundColor: 'rgba(255, 255, 255, 0.7)', 
                    borderRadius: '4px' 
                  }}>{item.content}</pre>
                )}              </td>
              <td style={{ fontSize: '0.85em', padding: '10px' }}>
                {item.lastUpdated ? new Date(item.lastUpdated).toLocaleString('zh-TW') : '無記錄'}
              </td>
              <td>                {editingId === item.id ? (
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <button 
                      onClick={handleSaveEdit} 
                      disabled={loading || !editingContent}
                      style={{ flex: 1 }}
                    >
                      儲存
                    </button>
                    <button 
                      onClick={() => setEditingId(null)} 
                      disabled={loading}
                      style={{ flex: 1 }}
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <button 
                      onClick={() => handleEdit(item)} 
                      disabled={loading}
                      style={{ flex: 1 }}
                    >
                      編輯
                    </button>
                    <button 
                      onClick={() => handleDelete(item.id)} 
                      disabled={loading}
                      style={{ flex: 1 }}
                    >
                      刪除
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {loading && <div style={{ marginTop: 12 }}>處理中...</div>}
    </div>
  );
}
