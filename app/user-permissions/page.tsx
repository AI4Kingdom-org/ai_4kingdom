'use client';

import { useState, useEffect } from 'react';
import styles from './UserPermissions.module.css';
import BackToPortalLink from '../components/BackToPortalLink';
import { useAuth } from '../contexts/AuthContext';

// 引入權限配置
import { UPLOAD_PERMITTED_USERS, PERMISSION_GROUPS } from '../config/userPermissions';

interface User {
  id: string;
  username: string;
  displayName: string;
  email: string;
}

export default function UserPermissionsPage() {
  const { user } = useAuth();
  const [permittedUsers, setPermittedUsers] = useState<string[]>([...UPLOAD_PERMITTED_USERS]);
  const [permissionGroups, setPermissionGroups] = useState(PERMISSION_GROUPS);
  const [newUserId, setNewUserId] = useState('');
  const [newUserGroup, setNewUserGroup] = useState<keyof typeof PERMISSION_GROUPS>('EDITORS');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [userDetails, setUserDetails] = useState<Record<string, User>>({});
  // Agape 單位專屬上傳者
  const [agapeUploaders, setAgapeUploaders] = useState<string[]>([]);
  const [newAgapeUserId, setNewAgapeUserId] = useState('');
  // East Christ Home 單位專屬上傳者
  const [eastUploaders, setEastUploaders] = useState<string[]>([]);
  const [newEastUserId, setNewEastUserId] = useState('');
  // Jian Zhu 單位專屬上傳者
  const [jianZhuUploaders, setJianZhuUploaders] = useState<string[]>([]);
  const [newJianZhuUserId, setNewJianZhuUserId] = useState('');

  // 檢查當前用戶是否為管理員
  const isAdmin = user?.user_id === '1' || PERMISSION_GROUPS.ADMINS.includes(user?.user_id || '');

  useEffect(() => {
    if (!isAdmin) {
      setMessage({
        type: 'error',
        text: '您沒有權限訪問此頁面'
      });
    } else {
  loadCurrentPermissions();
    }
  }, [isAdmin]);

  // 加載當前權限配置
  const loadCurrentPermissions = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/permissions');
      const data = await response.json();
      
    if (data.success) {
        setPermittedUsers(data.data.uploadPermittedUsers);
        setPermissionGroups(data.data.permissionGroups);
  await loadAgapeUploaders();
  await loadEastUploaders();
  await loadJianZhuUploaders();
        await fetchUserDetails();
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('加載權限配置失敗:', error);
      setMessage({
        type: 'error',
        text: '加載權限配置失敗'
      });
      // 使用默認配置
  await loadAgapeUploaders();
  await loadEastUploaders();
  await loadJianZhuUploaders();
      await fetchUserDetails();
    } finally {
      setLoading(false);
    }
  };

  // 讀取 Agape 單位 allowedUploaders
  const loadAgapeUploaders = async () => {
    try {
      const res = await fetch('/api/admin/sunday-guide-units');
      const data = await res.json();
      if (data.success) {
        setAgapeUploaders(data.data.units.agape.allowedUploaders || []);
      }
    } catch (e) {
      console.error('載入 Agape 單位上傳者失敗', e);
    }
  };

  // 讀取 East Christ Home 單位 allowedUploaders
  const loadEastUploaders = async () => {
    try {
      const res = await fetch('/api/admin/sunday-guide-units');
      const data = await res.json();
      if (data.success) {
        setEastUploaders(data.data.units.eastChristHome?.allowedUploaders || []);
      }
    } catch (e) {
      console.error('載入 East Christ Home 單位上傳者失敗', e);
    }
  };

  // 讀取 Jian Zhu 單位 allowedUploaders
  const loadJianZhuUploaders = async () => {
    try {
      const res = await fetch('/api/admin/sunday-guide-units');
      const data = await res.json();
      if (data.success) {
        setJianZhuUploaders(data.data.units.jianZhu?.allowedUploaders || []);
      }
    } catch (e) {
      console.error('載入 Jian Zhu 單位上傳者失敗', e);
    }
  };

  // 獲取用戶詳細資訊
  const fetchUserDetails = async () => {
    setLoading(true);
    try {
      const allUserIds = [
        ...permittedUsers,
        ...Object.values(permissionGroups).flat()
      ].filter((id, index, arr) => arr.indexOf(id) === index);

      const userPromises = allUserIds.map(async (userId) => {
        try {
          const response = await fetch(`${process.env.NEXT_PUBLIC_WP_API_BASE || 'https://ai4kingdom.org/wp-json/custom/v1'}/get_user_info`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ user_id: userId })
          });

          if (response.ok) {
            const userData = await response.json();
            if (userData.success) {
              return {
                id: userId,
                username: userData.username || `用戶${userId}`,
                displayName: userData.display_name || userData.username || `用戶${userId}`,
                email: userData.email || ''
              };
            }
          }
        } catch (error) {
          console.error(`獲取用戶 ${userId} 資訊失敗:`, error);
        }
        
        return {
          id: userId,
          username: `用戶${userId}`,
          displayName: `用戶${userId}`,
          email: ''
        };
      });

      const users = await Promise.all(userPromises);
      const userDetailsMap = users.reduce((acc, user) => {
        acc[user.id] = user;
        return acc;
      }, {} as Record<string, User>);

      setUserDetails(userDetailsMap);
    } catch (error) {
      console.error('獲取用戶資訊失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  // 添加用戶到上傳權限列表
  const addUserToUploadPermissions = async () => {
    if (!newUserId.trim()) {
      setMessage({ type: 'error', text: '請輸入用戶ID' });
      return;
    }

    if (permittedUsers.includes(newUserId.trim())) {
      setMessage({ type: 'error', text: '該用戶已有上傳權限' });
      return;
    }

    try {
      const updatedUsers = [...permittedUsers, newUserId.trim()];
      await updatePermissionsConfig(updatedUsers, permissionGroups);
      setPermittedUsers(updatedUsers);
      setNewUserId('');
      setMessage({ type: 'success', text: '用戶權限添加成功' });
      await fetchUserDetails();
    } catch (error) {
      setMessage({ type: 'error', text: '添加用戶權限失敗' });
    }
  };

  // 從上傳權限列表中移除用戶
  const removeUserFromUploadPermissions = async (userId: string) => {
    if (!confirm(`確定要移除用戶 ${userDetails[userId]?.displayName || userId} 的上傳權限嗎？`)) {
      return;
    }

    try {
      const updatedUsers = permittedUsers.filter(id => id !== userId);
      await updatePermissionsConfig(updatedUsers, permissionGroups);
      setPermittedUsers(updatedUsers);
      setMessage({ type: 'success', text: '用戶權限移除成功' });
    } catch (error) {
      setMessage({ type: 'error', text: '移除用戶權限失敗' });
    }
  };

  // 添加用戶到權限組
  const addUserToGroup = async () => {
    if (!newUserId.trim()) {
      setMessage({ type: 'error', text: '請輸入用戶ID' });
      return;
    }

    if (permissionGroups[newUserGroup].includes(newUserId.trim())) {
      setMessage({ type: 'error', text: '該用戶已在此權限組中' });
      return;
    }

    try {
      const updatedGroups = {
        ...permissionGroups,
        [newUserGroup]: [...permissionGroups[newUserGroup], newUserId.trim()]
      };
      await updatePermissionsConfig(permittedUsers, updatedGroups);
      setPermissionGroups(updatedGroups);
      setNewUserId('');
      setMessage({ type: 'success', text: '用戶已添加到權限組' });
      await fetchUserDetails();
    } catch (error) {
      setMessage({ type: 'error', text: '添加用戶到權限組失敗' });
    }
  };

  // 從權限組中移除用戶
  const removeUserFromGroup = async (userId: string, groupName: keyof typeof PERMISSION_GROUPS) => {
    if (!confirm(`確定要從 ${groupName} 組中移除用戶 ${userDetails[userId]?.displayName || userId} 嗎？`)) {
      return;
    }

    try {
      const updatedGroups = {
        ...permissionGroups,
        [groupName]: permissionGroups[groupName].filter(id => id !== userId)
      };
      await updatePermissionsConfig(permittedUsers, updatedGroups);
      setPermissionGroups(updatedGroups);
      setMessage({ type: 'success', text: '用戶已從權限組中移除' });
    } catch (error) {
      setMessage({ type: 'error', text: '從權限組中移除用戶失敗' });
    }
  };

  // 更新權限配置（調用 API 來持久化配置）
  const updatePermissionsConfig = async (
    users: string[], 
    groups: typeof PERMISSION_GROUPS
  ) => {
    try {
      const response = await fetch('/api/admin/permissions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uploadPermittedUsers: users,
          permissionGroups: groups,
          userId: user?.user_id
        }),
      });

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || '更新失敗');
      }
      
      return data;
    } catch (error) {
      console.error('更新權限配置失敗:', error);
      throw error;
    }
  };

  // 更新 Agape 單位 allowedUploaders
  const updateAgapeUploaders = async (uploaders: string[]) => {
    try {
      const res = await fetch('/api/admin/sunday-guide-units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitId: 'agape', allowedUploaders: uploaders, userId: user?.user_id })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '更新失敗');
      return true;
    } catch (e) {
      console.error('更新 Agape 上傳者失敗', e);
      setMessage({ type: 'error', text: '更新 Agape 上傳者失敗' });
      return false;
    }
  };

  // 更新 East 單位 allowedUploaders
  const updateEastUploaders = async (uploaders: string[]) => {
    try {
      const res = await fetch('/api/admin/sunday-guide-units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitId: 'eastChristHome', allowedUploaders: uploaders, userId: user?.user_id })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '更新失敗');
      return true;
    } catch (e) {
      console.error('更新 East 上傳者失敗', e);
      setMessage({ type: 'error', text: '更新 East 上傳者失敗' });
      return false;
    }
  };

  // 更新 Jian Zhu 單位 allowedUploaders
  const updateJianZhuUploaders = async (uploaders: string[]) => {
    try {
      const res = await fetch('/api/admin/sunday-guide-units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitId: 'jianZhu', allowedUploaders: uploaders, userId: user?.user_id })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '更新失敗');
      return true;
    } catch (e) {
      console.error('更新 Jian Zhu 上傳者失敗', e);
      setMessage({ type: 'error', text: '更新 Jian Zhu 上傳者失敗' });
      return false;
    }
  };

  const addEastUploader = async () => {
    if (!newEastUserId.trim()) {
      setMessage({ type: 'error', text: '請輸入用戶ID' });
      return;
    }
    if (eastUploaders.includes(newEastUserId.trim())) {
      setMessage({ type: 'error', text: '該用戶已在 East 上傳清單中' });
      return;
    }
    const updated = [...eastUploaders, newEastUserId.trim()];
    const ok = await updateEastUploaders(updated);
    if (ok) {
      setEastUploaders(updated);
      setNewEastUserId('');
      setMessage({ type: 'success', text: 'East 上傳者已新增' });
      await fetchUserDetails();
    }
  };

  const removeEastUploader = async (uId: string) => {
    if (!confirm(`確定要移除用戶 ${userDetails[uId]?.displayName || uId} 的 East 上傳權限嗎？`)) return;
    const updated = eastUploaders.filter(id => id !== uId);
    const ok = await updateEastUploaders(updated);
    if (ok) {
      setEastUploaders(updated);
      setMessage({ type: 'success', text: 'East 上傳者已移除' });
    }
  };

  const addJianZhuUploader = async () => {
    if (!newJianZhuUserId.trim()) {
      setMessage({ type: 'error', text: '請輸入用戶ID' });
      return;
    }
    if (jianZhuUploaders.includes(newJianZhuUserId.trim())) {
      setMessage({ type: 'error', text: '該用戶已在 Jian Zhu 上傳清單中' });
      return;
    }
    const updated = [...jianZhuUploaders, newJianZhuUserId.trim()];
    const ok = await updateJianZhuUploaders(updated);
    if (ok) {
      setJianZhuUploaders(updated);
      setNewJianZhuUserId('');
      setMessage({ type: 'success', text: 'Jian Zhu 上傳者已新增' });
      await fetchUserDetails();
    }
  };

  const removeJianZhuUploader = async (uId: string) => {
    if (!confirm(`確定要移除用戶 ${userDetails[uId]?.displayName || uId} 的 Jian Zhu 上傳權限嗎？`)) return;
    const updated = jianZhuUploaders.filter(id => id !== uId);
    const ok = await updateJianZhuUploaders(updated);
    if (ok) {
      setJianZhuUploaders(updated);
      setMessage({ type: 'success', text: 'Jian Zhu 上傳者已移除' });
    }
  };

  const addAgapeUploader = async () => {
    if (!newAgapeUserId.trim()) {
      setMessage({ type: 'error', text: '請輸入用戶ID' });
      return;
    }
    if (agapeUploaders.includes(newAgapeUserId.trim())) {
      setMessage({ type: 'error', text: '該用戶已在 Agape 上傳清單中' });
      return;
    }
    const updated = [...agapeUploaders, newAgapeUserId.trim()];
    const ok = await updateAgapeUploaders(updated);
    if (ok) {
      setAgapeUploaders(updated);
      setNewAgapeUserId('');
      setMessage({ type: 'success', text: 'Agape 上傳者已新增' });
      await fetchUserDetails();
    }
  };

  const removeAgapeUploader = async (userId: string) => {
    if (!confirm(`確定要移除用戶 ${userDetails[userId]?.displayName || userId} 的 Agape 上傳權限嗎？`)) return;
    const updated = agapeUploaders.filter(id => id !== userId);
    const ok = await updateAgapeUploaders(updated);
    if (ok) {
      setAgapeUploaders(updated);
      setMessage({ type: 'success', text: 'Agape 上傳者已移除' });
    }
  };

  // 清除消息
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  if (!user) {
    return (
      <div className={styles.container}>
        <BackToPortalLink />
        <div className={styles.error}>請先登入以訪問權限管理</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className={styles.container}>
        <BackToPortalLink />
        <div className={styles.error}>您沒有權限訪問此頁面</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <BackToPortalLink />
      <h1 className={styles.title}>用戶權限管理</h1>

      {message && (
        <div className={`${styles.message} ${styles[message.type]}`}>
          {message.text}
        </div>
      )}

      {/* 上傳權限管理 */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>文檔上傳權限管理</h2>
        
        <div className={styles.addUserForm}>
          <input
            type="text"
            placeholder="輸入用戶ID"
            value={newUserId}
            onChange={(e) => setNewUserId(e.target.value)}
            className={styles.input}
          />
          <button onClick={addUserToUploadPermissions} className={styles.button}>
            添加上傳權限
          </button>
        </div>

        <div className={styles.userList}>
          <h3>具有上傳權限的用戶</h3>
          {loading ? (
            <div className={styles.loading}>載入中...</div>
          ) : permittedUsers.length === 0 ? (
            <div className={styles.noUsers}>暫無用戶</div>
          ) : (
            <ul className={styles.list}>
              {permittedUsers.map((userId) => (
                <li key={userId} className={styles.listItem}>
                  <div className={styles.userInfo}>
                    <strong>{userDetails[userId]?.displayName || `用戶${userId}`}</strong>
                    <span className={styles.userId}>ID: {userId}</span>
                    {userDetails[userId]?.email && (
                      <span className={styles.userEmail}>{userDetails[userId].email}</span>
                    )}
                  </div>
                  <button
                    onClick={() => removeUserFromUploadPermissions(userId)}
                    className={styles.removeButton}
                  >
                    移除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Agape 單位專屬上傳權限管理 */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Agape 單位專屬上傳權限</h2>
        <div className={styles.addUserForm}>
          <input
            type="text"
            placeholder="輸入用戶ID"
            value={newAgapeUserId}
            onChange={(e) => setNewAgapeUserId(e.target.value)}
            className={styles.input}
          />
          <button onClick={addAgapeUploader} className={styles.button}>添加 Agape 上傳權限</button>
        </div>
        <div className={styles.userList}>
          <h3>Agape 具有上傳權限的用戶</h3>
          {loading ? (
            <div className={styles.loading}>載入中...</div>
          ) : agapeUploaders.length === 0 ? (
            <div className={styles.noUsers}>暫無用戶</div>
          ) : (
            <ul className={styles.list}>
              {agapeUploaders.map(userId => (
                <li key={userId} className={styles.listItem}>
                  <div className={styles.userInfo}>
                    <strong>{userDetails[userId]?.displayName || `用戶${userId}`}</strong>
                    <span className={styles.userId}>ID: {userId}</span>
                    {userDetails[userId]?.email && <span className={styles.userEmail}>{userDetails[userId].email}</span>}
                  </div>
                  <button onClick={() => removeAgapeUploader(userId)} className={styles.removeButton}>移除</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* East Christ Home 單位專屬上傳權限管理 */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>East Christ Home 單位專屬上傳權限</h2>
        <div className={styles.addUserForm}>
          <input
            type="text"
            placeholder="輸入用戶ID"
            value={newEastUserId}
            onChange={(e) => setNewEastUserId(e.target.value)}
            className={styles.input}
          />
          <button onClick={addEastUploader} className={styles.button}>添加 East 上傳權限</button>
        </div>
        <div className={styles.userList}>
          <h3>East 具有上傳權限的用戶</h3>
          {loading ? (
            <div className={styles.loading}>載入中...</div>
          ) : eastUploaders.length === 0 ? (
            <div className={styles.noUsers}>暫無用戶</div>
          ) : (
            <ul className={styles.list}>
              {eastUploaders.map(userId => (
                <li key={userId} className={styles.listItem}>
                  <div className={styles.userInfo}>
                    <strong>{userDetails[userId]?.displayName || `用戶${userId}`}</strong>
                    <span className={styles.userId}>ID: {userId}</span>
                    {userDetails[userId]?.email && <span className={styles.userEmail}>{userDetails[userId].email}</span>}
                  </div>
                  <button onClick={() => removeEastUploader(userId)} className={styles.removeButton}>移除</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Jian Zhu 單位專屬上傳權限管理 */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Jian Zhu 單位專屬上傳權限</h2>
        <div className={styles.addUserForm}>
          <input
            type="text"
            placeholder="輸入用戶ID"
            value={newJianZhuUserId}
            onChange={(e) => setNewJianZhuUserId(e.target.value)}
            className={styles.input}
          />
          <button onClick={addJianZhuUploader} className={styles.button}>添加 Jian Zhu 上傳權限</button>
        </div>
        <div className={styles.userList}>
          <h3>Jian Zhu 具有上傳權限的用戶</h3>
          {loading ? (
            <div className={styles.loading}>載入中...</div>
          ) : jianZhuUploaders.length === 0 ? (
            <div className={styles.noUsers}>暫無用戶</div>
          ) : (
            <ul className={styles.list}>
              {jianZhuUploaders.map(userId => (
                <li key={userId} className={styles.listItem}>
                  <div className={styles.userInfo}>
                    <strong>{userDetails[userId]?.displayName || `用戶${userId}`}</strong>
                    <span className={styles.userId}>ID: {userId}</span>
                    {userDetails[userId]?.email && <span className={styles.userEmail}>{userDetails[userId].email}</span>}
                  </div>
                  <button onClick={() => removeJianZhuUploader(userId)} className={styles.removeButton}>移除</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 權限組管理 */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>權限組管理</h2>
        
        <div className={styles.addUserForm}>
          <input
            type="text"
            placeholder="輸入用戶ID"
            value={newUserId}
            onChange={(e) => setNewUserId(e.target.value)}
            className={styles.input}
          />
          <select
            value={newUserGroup}
            onChange={(e) => setNewUserGroup(e.target.value as keyof typeof PERMISSION_GROUPS)}
            className={styles.select}
          >
            <option value="ADMINS">管理員</option>
            <option value="EDITORS">編輯者</option>
            <option value="SPECIAL_USERS">特殊用戶</option>
          </select>
          <button onClick={addUserToGroup} className={styles.button}>
            添加到權限組
          </button>
        </div>

        {Object.entries(permissionGroups).map(([groupName, userIds]) => (
          <div key={groupName} className={styles.groupSection}>
            <h3 className={styles.groupTitle}>
              {groupName === 'ADMINS' ? '管理員' : 
               groupName === 'EDITORS' ? '編輯者' : '特殊用戶'}
              <span className={styles.groupCount}>({userIds.length})</span>
            </h3>
            {userIds.length === 0 ? (
              <div className={styles.noUsers}>此組暫無用戶</div>
            ) : (
              <ul className={styles.list}>
                {userIds.map((userId) => (
                  <li key={userId} className={styles.listItem}>
                    <div className={styles.userInfo}>
                      <strong>{userDetails[userId]?.displayName || `用戶${userId}`}</strong>
                      <span className={styles.userId}>ID: {userId}</span>
                      {userDetails[userId]?.email && (
                        <span className={styles.userEmail}>{userDetails[userId].email}</span>
                      )}
                    </div>
                    <button
                      onClick={() => removeUserFromGroup(userId, groupName as keyof typeof PERMISSION_GROUPS)}
                      className={styles.removeButton}
                    >
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {/* 權限說明 */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>權限說明</h2>
        <div className={styles.permissionInfo}>
          <div className={styles.infoItem}>
            <strong>文檔上傳權限：</strong>
            <p>控制哪些用戶可以在Sunday Guide等頁面看到並使用文檔上傳功能</p>
          </div>
          <div className={styles.infoItem}>
            <strong>管理員組：</strong>
            <p>具有完全管理權限，可以管理其他用戶的權限</p>
          </div>
          <div className={styles.infoItem}>
            <strong>編輯者組：</strong>
            <p>具有編輯權限的用戶組</p>
          </div>
          <div className={styles.infoItem}>
            <strong>特殊用戶組：</strong>
            <p>需要特殊權限的用戶組</p>
          </div>
        </div>
      </div>
    </div>
  );
}
