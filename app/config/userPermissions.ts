// 可以上傳文件的用戶 ID 列表
export const UPLOAD_PERMITTED_USERS: string[] = [
  '1',
  // 在這裡添加更多有權限的用戶 ID
];

// 檢查用戶是否有上傳權限
export const canUserUpload = (userId: string | undefined): boolean => {
  console.log('[DEBUG] canUserUpload called with:', {
    userId,
    type: typeof userId,
    UPLOAD_PERMITTED_USERS,
    includes: userId ? UPLOAD_PERMITTED_USERS.includes(userId) : false
  });
  
  if (!userId) return false;
  return UPLOAD_PERMITTED_USERS.includes(userId);
};

// 可選：添加權限組管理
export const PERMISSION_GROUPS = {
  ADMINS: ['1'],
  EDITORS: ['5', '12'],
  SPECIAL_USERS: ['25', '30']
};

// 檢查用戶是否在特定權限組
export const isUserInGroup = (userId: string, groupName: keyof typeof PERMISSION_GROUPS): boolean => {
  return PERMISSION_GROUPS[groupName].includes(userId);
};

// 獲取所有有權限的用戶列表
export const getAllPermittedUsers = (): string[] => {
  return [...UPLOAD_PERMITTED_USERS];
};

// 檢查權限組中的用戶總數
export const getPermissionGroupSize = (groupName: keyof typeof PERMISSION_GROUPS): number => {
  return PERMISSION_GROUPS[groupName].length;
};

// 動態單位（牧者助手）上傳權限：優先使用單位配置的 allowedUploaders（於 constants SUNDAY_GUIDE_UNITS）
import { getSundayGuideUnitConfig } from './constants';

export function canUploadToSundayGuideUnit(unitId: string | undefined, userId: string | undefined): boolean {
  if (!userId) return false;
  const cfg = getSundayGuideUnitConfig(unitId);
  if (cfg.allowedUploaders.length === 0) {
    // 若該單位清單為空：default 單位走全域 canUserUpload；其他單位禁止上傳（安全預設）
    if (!unitId || unitId === 'default') return canUserUpload(userId);
    return false;
  }
  return cfg.allowedUploaders.includes(userId);
}
