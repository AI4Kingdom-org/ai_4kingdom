'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { CONCERN_OPTIONS } from '../types/homeschool';
import styles from './HomeschoolProfileForm.module.css';

const SITE = process.env.NEXT_PUBLIC_PRIMARY_DOMAIN || 'https://ai4kingdom.org';

export interface HomeschoolProfile {
  childName: string;
  age?: number;
  gender?: 'male' | 'female';
  concerns?: string[];
  otherConcern?: string;  // 「其他」選項的具體說明
  basicInfo: string;
  recentChanges: string;
}

interface HomeschoolProfileFormProps {
  /** 嵌在聊天面板裡：去掉卡片外框、改為面板內捲動 */
  embedded?: boolean;
  onSaved?: (profile: HomeschoolProfile) => void;
  onCancel?: () => void;
}

/**
 * 家庭教育「孩子資料」表單（會員限定）。
 * 獨立頁 /homeschool-prompt 與 /homeschool 聊天面板共用。
 * 頁面嵌在 WordPress 的 sandbox iframe 裡，註冊／登入連結改用新分頁開啟。
 */
export default function HomeschoolProfileForm({ embedded = false, onSaved, onCancel }: HomeschoolProfileFormProps) {
  const { user, loading: authLoading } = useAuth();
  const [promptData, setPromptData] = useState<HomeschoolProfile>({
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
    if (!user?.user_id) {
      setMessage('请先登录');
      return;
    }

    // 驗證必填欄位
    if (!promptData.childName.trim()) {
      setMessage('請填寫孩子姓名');
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetch('/api/homeschool-prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: user.user_id, ...promptData }),
      });

      if (response.ok) {
        setMessage('保存成功');
        onSaved?.(promptData);
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

  const containerClass = `${styles.container}${embedded ? ' ' + styles.embedded : ''}`;

  // 身分還在確認中：不要先顯示「請先登入」，避免會員看到一閃而過的提示
  if (authLoading) {
    return <div className={containerClass}><p className={styles.subtitle}>載入中…</p></div>;
  }

  if (!user) {
    return (
      <div className={containerClass}>
        <p className={styles.memberOnly}>
          填寫孩子資料是會員功能。免費註冊即可使用，讓 AI 家庭助手依照孩子的狀況提供個人化建議。
        </p>
        <div className={styles.memberLinks}>
          <a href={`${SITE}/register/`} target="_blank" rel="noopener">免費註冊</a>
          <a href={`${SITE}/login/`} target="_blank" rel="noopener">登入</a>
        </div>
      </div>
    );
  }

  return (
    <div className={containerClass}>
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
      {onCancel && (
        <button
          type="button"
          className={styles.cancelButton}
          onClick={onCancel}
          disabled={isLoading}
        >
          返回對話
        </button>
      )}
    </div>
  );
}
