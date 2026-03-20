import { NextRequest, NextResponse } from 'next/server';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { PERMISSION_GROUPS, UPLOAD_PERMITTED_USERS } from '@/app/config/userPermissions';

const SUNDAY_GUIDE_TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';
const PERMISSIONS_CONFIG_ASSISTANT_ID = '__SYSTEM_PERMISSIONS__';
const PERMISSIONS_CONFIG_TYPE = 'GLOBAL_UPLOAD_PERMISSIONS';

type PermissionGroups = {
  ADMINS: string[];
  EDITORS: string[];
  SPECIAL_USERS: string[];
};

function normalizeStringArray(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const unique = new Set<string>();
  for (const item of list) {
    const value = String(item || '').trim();
    if (value) unique.add(value);
  }
  return Array.from(unique);
}

function normalizePermissionGroups(input: unknown): PermissionGroups {
  const groups = (input || {}) as Record<string, unknown>;
  return {
    ADMINS: normalizeStringArray(groups.ADMINS),
    EDITORS: normalizeStringArray(groups.EDITORS),
    SPECIAL_USERS: normalizeStringArray(groups.SPECIAL_USERS),
  };
}

async function readPermissionsFromStore() {
  const docClient = await createDynamoDBClient();
  const result = await docClient.send(
    new QueryCommand({
      TableName: SUNDAY_GUIDE_TABLE,
      KeyConditionExpression: 'assistantId = :assistantId',
      ExpressionAttributeValues: {
        ':assistantId': PERMISSIONS_CONFIG_ASSISTANT_ID,
      },
      ScanIndexForward: false,
      Limit: 20,
    })
  );

  const items = result.Items || [];
  const matched = items.find((item) => item.recordType === PERMISSIONS_CONFIG_TYPE);
  if (!matched) return null;

  return {
    uploadPermittedUsers: normalizeStringArray(matched.uploadPermittedUsers),
    permissionGroups: normalizePermissionGroups(matched.permissionGroups),
    updatedAt: matched.updatedAt,
    updatedBy: matched.updatedBy,
  };
}

export async function GET() {
  try {
    const stored = await readPermissionsFromStore();
    const fallbackData = {
      uploadPermittedUsers: [...UPLOAD_PERMITTED_USERS],
      permissionGroups: {
        ADMINS: [...PERMISSION_GROUPS.ADMINS],
        EDITORS: [...PERMISSION_GROUPS.EDITORS],
        SPECIAL_USERS: [...PERMISSION_GROUPS.SPECIAL_USERS],
      },
    };

    const payload = stored || fallbackData;
    
    return NextResponse.json({
      success: true,
      data: {
        uploadPermittedUsers: payload.uploadPermittedUsers,
        permissionGroups: payload.permissionGroups,
        source: stored ? 'dynamodb' : 'fallback-static',
        updatedAt: stored?.updatedAt || null,
        updatedBy: stored?.updatedBy || null,
      }
    });
  } catch (error) {
    console.error('獲取權限配置失敗，回退到靜態白名單:', error);
    return NextResponse.json({
      success: true,
      data: {
        uploadPermittedUsers: [...UPLOAD_PERMITTED_USERS],
        permissionGroups: {
          ADMINS: [...PERMISSION_GROUPS.ADMINS],
          EDITORS: [...PERMISSION_GROUPS.EDITORS],
          SPECIAL_USERS: [...PERMISSION_GROUPS.SPECIAL_USERS],
        },
        source: 'fallback-static',
        updatedAt: null,
        updatedBy: null,
      }
    });
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
    
    const normalizedUsers = normalizeStringArray(uploadPermittedUsers);
    const normalizedGroups = normalizePermissionGroups(permissionGroups);

    const docClient = await createDynamoDBClient();
    await docClient.send(
      new PutCommand({
        TableName: SUNDAY_GUIDE_TABLE,
        Item: {
          assistantId: PERMISSIONS_CONFIG_ASSISTANT_ID,
          Timestamp: new Date().toISOString(),
          recordType: PERMISSIONS_CONFIG_TYPE,
          uploadPermittedUsers: normalizedUsers,
          permissionGroups: normalizedGroups,
          updatedBy: String(userId),
          updatedAt: new Date().toISOString(),
        },
      })
    );
    
    return NextResponse.json({
      success: true,
      message: '權限配置更新成功（DynamoDB）'
    });
  } catch (error) {
    console.error('更新權限配置失敗:', error);
    return NextResponse.json(
      { success: false, error: '更新權限配置失敗' },
      { status: 500 }
    );
  }
}
