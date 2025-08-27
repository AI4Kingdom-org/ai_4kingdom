const fs = require('fs');
const path = require('path');

const PERMISSIONS_FILE = path.join(process.cwd(), 'app/config/userPermissions.ts');

// 添加用戶權限
function addUploadPermission(userId: string) {
  const content = fs.readFileSync(PERMISSIONS_FILE, 'utf8');
  const currentUsers = extractUserIds(content);
  
  if (!currentUsers.includes(userId)) {
    currentUsers.push(userId);
    updatePermissionsFile(currentUsers);
    console.log(`✅ 已添加用戶 ${userId} 的上傳權限`);
  } else {
    console.log(`ℹ️ 用戶 ${userId} 已有上傳權限`);
  }
}

// 移除用戶權限
function removeUploadPermission(userId: string) {
  const content = fs.readFileSync(PERMISSIONS_FILE, 'utf8');
  const currentUsers = extractUserIds(content);
  const updatedUsers = currentUsers.filter(id => id !== userId);
  
  if (currentUsers.length !== updatedUsers.length) {
    updatePermissionsFile(updatedUsers);
    console.log(`✅ 已移除用戶 ${userId} 的上傳權限`);
  } else {
    console.log(`ℹ️ 用戶 ${userId} 沒有上傳權限`);
  }
}

// 列出所有有權限的用戶
function listPermittedUsers() {
  const content = fs.readFileSync(PERMISSIONS_FILE, 'utf8');
  const currentUsers = extractUserIds(content);
  
  console.log('📋 目前有上傳權限的用戶ID列表:');
  if (currentUsers.length === 0) {
    console.log('   (無)');
  } else {
    currentUsers.forEach(userId => {
      console.log(`   - ${userId}`);
    });
  }
  return currentUsers;
}

// 檢查用戶是否有權限
function checkUserPermission(userId: string) {
  const content = fs.readFileSync(PERMISSIONS_FILE, 'utf8');
  const currentUsers = extractUserIds(content);
  const hasPermission = currentUsers.includes(userId);
  
  console.log(`🔍 用戶 ${userId} 上傳權限檢查: ${hasPermission ? '✅ 有權限' : '❌ 無權限'}`);
  return hasPermission;
}

function extractUserIds(content: string): string[] {
  const match = content.match(/UPLOAD_PERMITTED_USERS:\s*string\[\]\s*=\s*\[([\s\S]*?)\]/);
  if (!match) return [];
  
  const userIdsString = match[1];
  return userIdsString
    .split(',')
    .map(id => id.trim().replace(/['"`]/g, ''))
    .filter(id => id && !id.startsWith('//'));
}

function updatePermissionsFile(userIds: string[]) {
  const template = `// 可以上傳文件的用戶 ID 列表
export const UPLOAD_PERMITTED_USERS: string[] = [
${userIds.map(id => `  '${id}',`).join('\n')}${userIds.length > 0 ? '\n' : ''}  // 在這裡添加更多有權限的用戶 ID
];

// 檢查用戶是否有上傳權限
export const canUserUpload = (userId: string | undefined): boolean => {
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
};`;
  
  fs.writeFileSync(PERMISSIONS_FILE, template, 'utf8');
}

// 如果直接運行此腳本
if (require.main === module) {
  const action = process.argv[2];
  const userId = process.argv[3];
  
  if (action === 'list') {
    listPermittedUsers();
    process.exit(0);
  }
  
  if (!userId) {
    console.log('使用方法:');
    console.log('  node manageUploadPermissions.ts add <userId>     # 添加用戶權限');
    console.log('  node manageUploadPermissions.ts remove <userId>  # 移除用戶權限');
    console.log('  node manageUploadPermissions.ts check <userId>   # 檢查用戶權限');
    console.log('  node manageUploadPermissions.ts list             # 列出所有有權限的用戶');
    process.exit(1);
  }
  
  if (action === 'add') {
    addUploadPermission(userId);
  } else if (action === 'remove') {
    removeUploadPermission(userId);
  } else if (action === 'check') {
    checkUserPermission(userId);
  } else {
    console.log('❌ 動作必須是 "add", "remove", "check" 或 "list"');
  }
}
