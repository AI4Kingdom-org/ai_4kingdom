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
    <div style={{ maxWidth: 700, margin: '40px auto', padding: 24, background: '#fff', borderRadius: 8 }}>
      <BackToPortalLink />
      <h2>AI Prompts 管理</h2>
      {error && <div style={{ color: 'red', marginBottom: 8 }}>{error}</div>}
      <div style={{ marginBottom: 16 }}>
        <input
          placeholder="ID"
          value={newId}
          onChange={e => setNewId(e.target.value)}
          style={{ width: 120, marginRight: 8 }}
          disabled={loading}
        />
        <textarea
          placeholder="Prompt 內容"
          value={newPrompt}
          onChange={e => setNewPrompt(e.target.value)}
          style={{ width: 320, height: 60, marginRight: 8, verticalAlign: 'top', resize: 'vertical' }}
          disabled={loading}
        />
        <button onClick={handleAdd} disabled={loading || !newId || !newPrompt}>新增</button>
      </div>      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            <th style={{ width: 120 }}>ID</th>
            <th>內容</th>
            <th style={{ width: 120 }}>最後更新</th>
            <th style={{ width: 120 }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {[...prompts].reverse().map(item => (
            <tr key={item.id}>
              <td>{item.id}</td>
              <td>
                {editingId === item.id ? (
                  <textarea
                    value={editingContent}
                    onChange={e => setEditingContent(e.target.value)}
                    style={{ width: '95%', height: 60, resize: 'vertical' }}
                    disabled={loading}
                  />
                ) : (
                  <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{item.content}</pre>
                )}              </td>
              <td style={{ fontSize: '0.85em' }}>
                {item.lastUpdated ? new Date(item.lastUpdated).toLocaleString('zh-TW') : '無記錄'}
              </td>
              <td>
                {editingId === item.id ? (
                  <>
                    <button onClick={handleSaveEdit} disabled={loading || !editingContent}>儲存</button>
                    <button onClick={() => setEditingId(null)} disabled={loading}>取消</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => handleEdit(item)} disabled={loading}>編輯</button>
                    <button onClick={() => handleDelete(item.id)} disabled={loading}>刪除</button>
                  </>
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
