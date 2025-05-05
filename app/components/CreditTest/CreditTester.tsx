'use client';

import React, { useState, useEffect } from 'react';
import styles from './CreditTester.module.css';
import { useAuth } from '../../contexts/AuthContext';

// 定義每個用戶類型的 token 額度
const TOKEN_LIMITS = {
  free: 10000,     // 100 credits
  pro: 100000,     // 1,000 credits
  ultimate: 500000 // 5,000 credits
};

// Token 轉換為 Credit 的比率
const TOKEN_TO_CREDIT_RATIO = 100; // 100 tokens = 1 credit

// 模擬使用者類型
interface MockUser {
  user_id: string;
  username: string;
  display_name: string;
  subscription: {
    type: 'free' | 'pro' | 'ultimate';
    status: 'active' | 'inactive';
    expiry: string | null;
    roles: string[];
  }
}

interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  retrieval_tokens: number;
}

interface UsageData {
  YearMonth: string;
  UserId: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  totalTokens?: number;
}

const CreditTester: React.FC = () => {
  const { user } = useAuth();  // 使用 AuthContext 獲取當前用戶
  // 模擬用戶，使用真實用戶 ID 如果可用
  const [mockUser, setMockUser] = useState<MockUser>({
    user_id: 'mock_user_id',
    username: 'mock',
    display_name: 'Mock User',
    subscription: {
      type: 'free',
      status: 'active',
      expiry: null,
      roles: ['free_member']
    }
  });

  // 管理員憑證
  const [adminUserId, setAdminUserId] = useState<string>('');
  const [useRealCredential, setUseRealCredential] = useState<boolean>(false);

  // 使用量數據
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [chatResponse, setChatResponse] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [tokenAmount, setTokenAmount] = useState(1000); // 預設消耗 1000 tokens

  // 當真實用戶信息可用時，更新模擬用戶 ID
  useEffect(() => {
    if (user?.user_id) {
      setMockUser(prev => ({
        ...prev,
        user_id: user.user_id, // 使用真實用戶 ID
        username: user.username || prev.username, 
        display_name: user.display_name || prev.display_name,
        subscription: {
          ...prev.subscription,
          type: (user.subscription?.type as 'free' | 'pro' | 'ultimate') || prev.subscription.type,
          // 確保 roles 總是一個數組
          roles: Array.isArray(user.subscription?.roles) ? user.subscription.roles : ['free_member']
        }
      }));
      // 也自動設置管理員用戶 ID
      setAdminUserId(user.user_id);
    }
  }, [user]);

  // 獲取當前登入用戶 ID
  const getCurrentUserId = () => {
    if (user?.user_id) {
      setAdminUserId(user.user_id);
      setSuccessMessage(`已自動填入當前用戶 ID: ${user.user_id}`);
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    } else {
      setChatError('未找到當前用戶，請先登入');
    }
  };

  // 計算當月使用量
  const fetchUsage = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // 獲取當前年份和月份
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;
      const yearMonth = `${currentYear}-${currentMonth.toString().padStart(2, '0')}`;
      
      // 呼叫 API 獲取用戶使用量
      const response = await fetch(`/api/usage/monthly?userId=${mockUser.user_id}&year=${currentYear}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '無法獲取使用量數據');
      }
      
      const data = await response.json();
      console.log('Usage API Response:', data);
      
      if (data.success && Array.isArray(data.usage)) {
        // 查找當前月份的使用量
        const currentMonthUsage = data.usage.find((item: UsageData) => 
          item.YearMonth === yearMonth
        );
        
        if (currentMonthUsage) {
          setUsageData(currentMonthUsage);
        } else {
          // 如果沒有數據，設置為空
          setUsageData({
            YearMonth: yearMonth,
            UserId: mockUser.user_id,
            total_tokens: 0
          });
        }
      }
      setSuccessMessage('成功獲取使用量數據');
      
      // 3秒後清除成功訊息
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    } catch (err) {
      console.error('獲取使用量錯誤:', err);
      setError(err instanceof Error ? err.message : '獲取使用量數據失敗');
    } finally {
      setLoading(false);
    }
  };
  
  // 計算剩餘 Credits
  const calculateRemainingCredits = (): { credits: number, tokens: number } => {
    if (!usageData) return { credits: 0, tokens: 0 };
    
    const limit = TOKEN_LIMITS[mockUser.subscription.type];
    const used = usageData.total_tokens || usageData.totalTokens || 0;
    const remainingTokens = Math.max(0, limit - used);
    const credits = Math.floor(remainingTokens / TOKEN_TO_CREDIT_RATIO);
    
    return { credits, tokens: remainingTokens };
  };
  
  // 模擬發送聊天訊息並消耗 tokens
  const simulateChatUsage = async () => {
    setChatResponse(null);
    setChatError(null);
    setLoading(true);
    
    try {
      // 模擬聊天並消耗 tokens
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `這是一個測試訊息，請模擬消耗 ${tokenAmount} tokens`,
          userId: mockUser.user_id,
          config: {
            type: 'general',
            assistantId: 'asst_123456',  // 使用一個假的 assistantId
            vectorStoreId: 'vs_123456',   // 使用一個假的 vectorStoreId
            mock: true,
            mockUsage: {
              prompt_tokens: Math.floor(tokenAmount * 0.3),
              completion_tokens: Math.floor(tokenAmount * 0.7),
              total_tokens: tokenAmount,
              retrieval_tokens: 0
            }
          }
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || '模擬聊天失敗');
      }
      
      setChatResponse(data.reply || '系統已成功處理您的請求');
      setSuccessMessage(`成功模擬聊天並消耗 ${tokenAmount} tokens`);
      
      // 重新獲取使用量數據
      await fetchUsage();
      
      // 3秒後清除成功訊息
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    } catch (err) {
      console.error('模擬聊天錯誤:', err);
      setChatError(err instanceof Error ? err.message : '模擬聊天失敗');
    } finally {
      setLoading(false);
    }
  };

  // 使用真實管理員憑證進行測試
  const testWithRealCredential = async () => {
    if (!adminUserId) {
      setChatError('請先輸入管理員用戶ID');
      return;
    }

    setChatResponse(null);
    setChatError(null);
    setLoading(true);

    try {
      // 使用真實管理員憑證進行API呼叫
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `這是一個使用真實管理員憑證 (${adminUserId}) 的測試訊息。請回覆目前系統時間和版本資訊。`,
          userId: adminUserId, // 使用管理員ID
          config: {
            type: 'general',
            assistantId: 'asst_abc123', // 使用真實的助手ID
            vectorStoreId: 'vs_abc123',  // 使用真實的知識庫ID
          }
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || '使用真實憑證測試失敗');
      }
      
      setChatResponse(data.reply || '系統已成功處理您的請求');
      setSuccessMessage(`成功使用管理員憑證 (${adminUserId}) 進行測試並獲得回應`);
      
      // 3秒後清除成功訊息
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);

    } catch (err) {
      console.error('使用真實憑證測試錯誤:', err);
      setChatError(err instanceof Error ? err.message : '使用真實憑證測試失敗');
    } finally {
      setLoading(false);
    }
  };
  
  // 切換會員類型
  const changeSubscriptionType = (type: 'free' | 'pro' | 'ultimate') => {
    setMockUser(prev => ({
      ...prev,
      subscription: {
        ...prev.subscription,
        type,
        roles: type === 'free' ? ['free_member'] : 
               type === 'pro' ? ['pro_member'] : 
               ['ultimate_member']
      }
    }));
    
    setSuccessMessage(`已將會員類型切換為 ${type}`);
    setTimeout(() => {
      setSuccessMessage(null);
    }, 3000);
  };
  
  // 重置使用量數據
  const resetUsageData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // 模擬呼叫 API 重置使用量數據
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 重置本地數據
      setUsageData({
        YearMonth: new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'),
        UserId: mockUser.user_id,
        total_tokens: 0
      });
      
      setSuccessMessage('已重置使用量數據');
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    } catch (err) {
      console.error('重置使用量錯誤:', err);
      setError(err instanceof Error ? err.message : '重置使用量數據失敗');
    } finally {
      setLoading(false);
    }
  };
  
  // 設置每月使用量
  const setMonthlyUsage = async (tokenAmount: number) => {
    setLoading(true);
    setError(null);
    
    try {
      // 模擬更新使用量數據
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 更新本地數據
      setUsageData({
        YearMonth: new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'),
        UserId: mockUser.user_id,
        total_tokens: tokenAmount
      });
      
      setSuccessMessage(`已設置當月使用量為 ${tokenAmount} tokens`);
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    } catch (err) {
      console.error('設置使用量錯誤:', err);
      setError(err instanceof Error ? err.message : '設置使用量數據失敗');
    } finally {
      setLoading(false);
    }
  };
  
  // 模擬用完額度的情況
  const simulateQuotaExceeded = async () => {
    // 設置使用量為會員等級的 100%
    const limit = TOKEN_LIMITS[mockUser.subscription.type];
    await setMonthlyUsage(limit);
  };

  // 初始化載入使用量數據
  useEffect(() => {
    fetchUsage();
  }, [mockUser.user_id]);
  
  // 計算使用量百分比
  const calculateUsagePercentage = (): number => {
    if (!usageData) return 0;
    
    const limit = TOKEN_LIMITS[mockUser.subscription.type];
    const used = usageData.total_tokens || usageData.totalTokens || 0;
    return Math.min(100, (used / limit) * 100);
  };
  
  const { credits, tokens } = calculateRemainingCredits();
  const usagePercentage = calculateUsagePercentage();
  const isQuotaLow = usagePercentage > 90;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>信用點數測試器</h1>
        <p className={styles.infoText}>此工具用於測試不同會員等級的 credit 額度和用完額度時的系統反應</p>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {successMessage && <div className={styles.success}>{successMessage}</div>}
      {chatError && <div className={styles.error}>{chatError}</div>}

      <div className={styles.section}>
        <h2>模擬使用者設定</h2>
        <div className={styles.formGroup}>
          <div className={styles.selectRow}>
            <label>使用者類型:</label>
            <div className={styles.buttonRow}>
              <button 
                className={`${styles.button} ${mockUser.subscription.type === 'free' ? styles.active : ''}`} 
                onClick={() => changeSubscriptionType('free')}
                disabled={loading}
              >
                免費會員
              </button>
              <button 
                className={`${styles.button} ${mockUser.subscription.type === 'pro' ? styles.active : ''}`} 
                onClick={() => changeSubscriptionType('pro')}
                disabled={loading}
              >
                Pro 會員
              </button>
              <button 
                className={`${styles.button} ${mockUser.subscription.type === 'ultimate' ? styles.active : ''}`} 
                onClick={() => changeSubscriptionType('ultimate')}
                disabled={loading}
              >
                Ultimate 會員
              </button>
            </div>
          </div>
        </div>
        
        <div className={styles.statusCard}>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>使用者 ID:</span>
            <span className={styles.statusValue}>{mockUser.user_id}</span>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>使用者名稱:</span>
            <span className={styles.statusValue}>{mockUser.username}</span>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>顯示名稱:</span>
            <span className={styles.statusValue}>{mockUser.display_name}</span>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>會員類型:</span>
            <span className={styles.statusValue}>
              <span className={`${styles.pill} ${styles[mockUser.subscription.type]}`}>
                {mockUser.subscription.type.toUpperCase()}
              </span>
            </span>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>會員狀態:</span>
            <span className={styles.statusValue}>
              {mockUser.subscription.status === 'active' ? '啟用' : '未啟用'}
            </span>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>用戶角色:</span>
            <span className={styles.statusValue}>{mockUser.subscription.roles.join(', ')}</span>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <h2>信用點數使用量</h2>
        
        <div className={styles.statusCard}>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>當月已使用:</span>
            <span className={styles.statusValue}>
              {usageData ? (usageData.total_tokens || usageData.totalTokens || 0).toLocaleString() : '-'} tokens
            </span>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>會員額度上限:</span>
            <span className={styles.statusValue}>
              {TOKEN_LIMITS[mockUser.subscription.type].toLocaleString()} tokens
            </span>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>剩餘 tokens:</span>
            <span className={styles.statusValue}>{tokens.toLocaleString()}</span>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>剩餘 credits:</span>
            <span className={styles.statusValue}>{credits.toLocaleString()}</span>
          </div>
          
          <div className={styles.progressBar}>
            <div 
              className={`${styles.progress} ${isQuotaLow ? styles.remainingLow : ''}`} 
              style={{ width: `${usagePercentage}%` }}
            ></div>
          </div>
          <p className={styles.infoText}>使用率: {usagePercentage.toFixed(2)}%</p>
        </div>
        
        <div className={styles.buttonRow}>
          <button 
            className={styles.button} 
            onClick={fetchUsage}
            disabled={loading}
          >
            {loading ? '載入中...' : '刷新使用量'}
          </button>
          <button 
            className={styles.button} 
            onClick={resetUsageData}
            disabled={loading}
          >
            重置使用量
          </button>
          <button 
            className={styles.button} 
            onClick={simulateQuotaExceeded}
            disabled={loading}
          >
            模擬用完額度
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <h2>模擬聊天消耗</h2>
        
        <div className={styles.formGroup}>
          <label>消耗 Token 數量：</label>
          <div className={styles.tokenInputGroup}>
            <input
              type="number"
              className={styles.input}
              value={tokenAmount}
              onChange={(e) => setTokenAmount(Number(e.target.value))}
              min={100}
              step={100}
              disabled={loading}
            />
            <button 
              className={styles.button} 
              onClick={simulateChatUsage}
              disabled={loading}
            >
              {loading ? '處理中...' : '模擬聊天'}
            </button>
          </div>
        </div>
        
        <div className={styles.formGroup}>
          <label>管理員用戶 ID：</label>
          <div className={styles.tokenInputGroup}>
            <input
              type="text"
              className={styles.input}
              value={adminUserId}
              onChange={(e) => setAdminUserId(e.target.value)}
              disabled={loading}
            />
            <button 
              className={styles.button} 
              onClick={getCurrentUserId}
              disabled={loading || !user}
            >
              使用當前用戶 ID
            </button>
            <button 
              className={styles.button} 
              onClick={testWithRealCredential}
              disabled={loading || !adminUserId}
            >
              {loading ? '處理中...' : '使用真實憑證測試'}
            </button>
          </div>
        </div>

        {chatResponse && (
          <div className={styles.statusCard}>
            <h3>聊天回應</h3>
            <p>{chatResponse}</p>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h2>測試指南</h2>
        <p>1. 使用上方的按鈕切換不同的會員類型</p>
        <p>2. 使用「刷新使用量」按鈕檢查當前使用量</p>
        <p>3. 使用「模擬聊天」按鈕來模擬消耗不同數量的 tokens</p>
        <p>4. 使用「模擬用完額度」測試當用戶用完額度時的系統反應</p>
        <p>5. 使用「重置使用量」恢復初始狀態</p>
        <p>6. 使用「使用真實憑證測試」測試管理員憑證功能</p>
        <p className={styles.infoText}>注意：此工具僅用於本地環境測試，不會影響實際生產環境</p>
      </div>
    </div>
  );
};

export default CreditTester;