import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const PERMISSIONS_FILE_PATH = path.join(process.cwd(), 'app', 'config', 'userPermissions.ts');

export async function GET() {
  try {
    // 讀取當前權限配置
    const fileContent = fs.readFileSync(PERMISSIONS_FILE_PATH, 'utf8');
    
    // 解析當前配置
    const uploadePermittedUsersMatch = fileContent.match(/UPLOAD_PERMITTED_USERS:\s*string\[\]\s*=\s*\[([\s\S]*?)\]/);
    const permissionGroupsMatch = fileContent.match(/PERMISSION_GROUPS\s*=\s*\{([\s\S]*?)\}/);
    
    let uploadPermittedUsers: string[] = [];
    let permissionGroups: any = {};
    
    if (uploadePermittedUsersMatch) {
      // 提取用戶ID列表
      const usersString = uploadePermittedUsersMatch[1];
      const userMatches = usersString.match(/'([^']+)'/g);
      if (userMatches) {
        uploadPermittedUsers = userMatches.map(match => match.slice(1, -1));
      }
    }
    
    if (permissionGroupsMatch) {
      // 簡單解析權限組（這裡可以用更複雜的解析器）
      const groupsString = permissionGroupsMatch[1];
      const adminMatch = groupsString.match(/ADMINS:\s*\[(.*?)\]/);
      const editorsMatch = groupsString.match(/EDITORS:\s*\[(.*?)\]/);
      const specialMatch = groupsString.match(/SPECIAL_USERS:\s*\[(.*?)\]/);
      
      permissionGroups = {
        ADMINS: adminMatch ? adminMatch[1].match(/'([^']+)'/g)?.map(m => m.slice(1, -1)) || [] : [],
        EDITORS: editorsMatch ? editorsMatch[1].match(/'([^']+)'/g)?.map(m => m.slice(1, -1)) || [] : [],
        SPECIAL_USERS: specialMatch ? specialMatch[1].match(/'([^']+)'/g)?.map(m => m.slice(1, -1)) || [] : []
      };
    }
    
    return NextResponse.json({
      success: true,
      data: {
        uploadPermittedUsers,
        permissionGroups
      }
    });
  } catch (error) {
    console.error('獲取權限配置失敗:', error);
    return NextResponse.json(
      { success: false, error: '獲取權限配置失敗' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { uploadPermittedUsers, permissionGroups, userId } = await request.json();
    
    // 驗證管理員權限
    if (userId !== '1') {
      return NextResponse.json(
        { success: false, error: '沒有權限執行此操作' },
        { status: 403 }
      );
    }
    
    // 生成新的配置文件內容
    const newFileContent = `// 可以上傳文件的用戶 ID 列表
export const UPLOAD_PERMITTED_USERS: string[] = [
${uploadPermittedUsers.map((id: string) => `  '${id}'`).join(',\n')},
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
  ADMINS: [${permissionGroups.ADMINS.map((id: string) => `'${id}'`).join(', ')}],
  EDITORS: [${permissionGroups.EDITORS.map((id: string) => `'${id}'`).join(', ')}],
  SPECIAL_USERS: [${permissionGroups.SPECIAL_USERS.map((id: string) => `'${id}'`).join(', ')}]
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
`;

    // 寫入文件
    fs.writeFileSync(PERMISSIONS_FILE_PATH, newFileContent, 'utf8');
    
    return NextResponse.json({
      success: true,
      message: '權限配置更新成功'
    });
  } catch (error) {
    console.error('更新權限配置失敗:', error);
    return NextResponse.json(
      { success: false, error: '更新權限配置失敗' },
      { status: 500 }
    );
  }
}
