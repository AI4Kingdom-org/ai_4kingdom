// 可以上傳文件的用戶 ID 列表
export const UPLOAD_PERMITTED_USERS: string[] = [
  '1',
  '24',
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

// 添加缺少的函數：檢查用戶是否有權限上傳到特定 Sunday Guide 單位
export const canUploadToSundayGuideUnit = (unitId: string, userId?: string): boolean => {
  if (!userId) return false;
  
  // 從 constants.ts 導入單位配置
  try {
    const { getSundayGuideUnitConfig } = require('./constants');
    const unitConfig = getSundayGuideUnitConfig(unitId);
    
    if (!unitConfig || !unitConfig.allowedUploaders) {
      return false;
    }
    
    return unitConfig.allowedUploaders.includes(userId);
  } catch (error) {
    console.error('檢查單位上傳權限時發生錯誤:', error);
    return false;
  }
};
