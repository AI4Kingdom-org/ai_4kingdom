'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useChat, ChatProvider } from '../contexts/ChatContext';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';
import { CHAT_TYPES } from '../config/chatTypes';
import { HomeschoolPromptData, CONCERN_OPTIONS } from '../types/homeschool';
import styles from './HomeschoolPrompt.module.css';

interface PromptData {
  childName: string;
  age?: number;
  gender?: 'male' | 'female';
  concerns?: string[];
  otherConcern?: string;  // 「其他」選項的具體說明
  basicInfo: string;
  recentChanges: string;
}

function HomeschoolPromptContent() {
  const { user } = useAuth();
  const { setConfig } = useChat();
  const [promptData, setPromptData] = useState<PromptData>({
    childName: '',
    age: undefined,
    gender: undefined,
    concerns: [],
    otherConcern: '',
    basicInfo: '',
    recentChanges: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');

  // 加载数据
  useEffect(() => {
    const fetchData = async () => {
      if (!user?.user_id) return;
      
      try {
        setIsLoading(true);
        const response = await fetch(`/api/homeschool-prompt?userId=${user.user_id}`);
        if (response.ok) {
          const data = await response.json();
          setPromptData({
            childName: data.childName || '',
            age: data.age || undefined,
            gender: data.gender || undefined,
            concerns: data.concerns || [],
            otherConcern: data.otherConcern || '',
            basicInfo: data.basicInfo || '',
            recentChanges: data.recentChanges || ''
          });
        }
      } catch (error) {
        console.error('加载数据失败:', error);
        setMessage('加载数据失败');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [user?.user_id]);

  // 處理問題選項切換
  const toggleConcern = (value: string) => {
    setPromptData(prev => ({
      ...prev,
      concerns: prev.concerns?.includes(value)
        ? prev.concerns.filter(c => c !== value)
        : [...(prev.concerns || []), value]
    }));
  };

  // 保存数据
  const handleSave = async () => {
    console.log('[DEBUG] handleSave 被調用');
    console.log('[DEBUG] user:', user);
    console.log('[DEBUG] promptData:', promptData);
    
    if (!user?.user_id) {
      console.log('[DEBUG] 未登入，中止保存');
      setMessage('请先登录');
      return;
    }

    // 驗證必填欄位
    if (!promptData.childName.trim()) {
      console.log('[DEBUG] 孩子姓名為空，中止保存');
      setMessage('請填寫孩子姓名');
      return;
    }

    try {
      setIsLoading(true);
      const payload = {
        userId: user.user_id,
        ...promptData
      };
      console.log('[DEBUG] 準備發送 POST 請求，payload:', payload);
      
      const response = await fetch('/api/homeschool-prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      
      console.log('[DEBUG] 收到回應，status:', response.status);

      if (response.ok) {
        const data = await response.json();
        setConfig({ 
          type: CHAT_TYPES.HOMESCHOOL,
          assistantId: ASSISTANT_IDS.HOMESCHOOL,
          threadId: data.threadId,
          vectorStoreId: VECTOR_STORE_IDS.HOMESCHOOL
        });
        // 跨分頁通知
        localStorage.setItem('homeschool_data_updated', Date.now().toString());
        window.dispatchEvent(new Event('homeschool_data_updated'));
        setMessage('保存成功');
        // 移除強制跳轉
      } else {
        throw new Error('保存失败');
      }
    } catch (error) {
      console.error('保存失败:', error);
      setMessage('保存失败');
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) {
    return <div className={styles.container}>请先登录</div>;
  }

  return (
    <div className={styles.container}>
      <p className={styles.subtitle}>填寫孩子的基本資訊，讓AI家庭助手提供更個人化的建議</p>

      <div className={styles.formGroup}>
        <label htmlFor="childName">孩子姓名 <span className={styles.required}>*</span></label>
        <input
          id="childName"
          type="text"
          value={promptData.childName}
          onChange={(e) => setPromptData(prev => ({
            ...prev,
            childName: e.target.value
          }))}
          disabled={isLoading}
          placeholder="請輸入孩子的姓名或暱稱"
        />
      </div>

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label htmlFor="age">年齡</label>
          <input
            id="age"
            type="number"
            min="0"
            max="18"
            value={promptData.age || ''}
            onChange={(e) => setPromptData(prev => ({
              ...prev,
              age: e.target.value ? parseInt(e.target.value) : undefined
            }))}
            disabled={isLoading}
            placeholder="歲"
          />
        </div>

        <div className={styles.formGroup}>
          <label>性別</label>
          <div className={styles.radioGroup}>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="gender"
                value="male"
                checked={promptData.gender === 'male'}
                onChange={(e) => setPromptData(prev => ({
                  ...prev,
                  gender: e.target.value as 'male' | 'female'
                }))}
                disabled={isLoading}
              />
              <span>男孩</span>
            </label>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="gender"
                value="female"
                checked={promptData.gender === 'female'}
                onChange={(e) => setPromptData(prev => ({
                  ...prev,
                  gender: e.target.value as 'male' | 'female'
                }))}
                disabled={isLoading}
              />
              <span>女孩</span>
            </label>
          </div>
        </div>
      </div>

      <div className={styles.formGroup}>
        <label>主要關注問題（可多選）</label>
        <div className={styles.checkboxGroup}>
          {CONCERN_OPTIONS.map(option => (
            <label key={option.value} className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={promptData.concerns?.includes(option.value) || false}
                onChange={() => toggleConcern(option.value)}
                disabled={isLoading}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        {promptData.concerns?.includes('other') && (
          <input
            type="text"
            className={styles.otherInput}
            value={promptData.otherConcern || ''}
            onChange={(e) => setPromptData(prev => ({
              ...prev,
              otherConcern: e.target.value
            }))}
            disabled={isLoading}
            placeholder="請說明其他關注的問題"
          />
        )}
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="basicInfo">基本情況描述</label>
        <textarea
          id="basicInfo"
          value={promptData.basicInfo}
          onChange={(e) => setPromptData(prev => ({
            ...prev,
            basicInfo: e.target.value
          }))}
          disabled={isLoading}
          rows={4}
          placeholder="例如：孩子的性格特點、興趣愛好、學習狀況等"
        />
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="recentChanges">近期變化或特殊情況</label>
        <textarea
          id="recentChanges"
          value={promptData.recentChanges}
          onChange={(e) => setPromptData(prev => ({
            ...prev,
            recentChanges: e.target.value
          }))}
          disabled={isLoading}
          rows={4}
          placeholder="例如：最近遇到的困難、行為變化、特殊事件等"
        />
      </div>

      {message && (
        <div className={message.includes('成功') ? styles.successMessage : styles.errorMessage}>
          {message}
        </div>
      )}

      <button
        className={styles.button}
        onClick={handleSave}
        disabled={isLoading}
      >
        {isLoading ? '保存中...' : '保存設定'}
      </button>
    </div>
  );
}

export default function HomeschoolPrompt() {
  return (
    <ChatProvider initialConfig={{
      type: 'homeschool',
      assistantId: ASSISTANT_IDS.HOMESCHOOL,
      vectorStoreId: VECTOR_STORE_IDS.HOMESCHOOL
    }}>
      <HomeschoolPromptContent />
    </ChatProvider>
  );
}
