import { NextResponse } from 'next/server';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PERMISSION_GROUPS } from '@/app/config/userPermissions';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { isInternalRequest, requireMember } from './server';

/**
 * 伺服器端管理員判定。
 *
 * 會員 token 只帶 uid / plan，沒有角色；管理員改由伺服器端名單決定，不相信前端帶來的 userId：
 * - 超級管理員：環境變數 ADMIN_USER_IDS（逗號分隔 WP userId，未設定時為 '1'）
 * - 管理員：超級管理員 ＋ /user-permissions 頁面維護的 ADMINS 群組（DynamoDB，讀不到時退回靜態 PERMISSION_GROUPS）
 *
 * 持有 WP_SERVICE_TOKEN 的內部呼叫（x-a4k-internal）視同超級管理員，供 curl / 維運腳本使用。
 */

const SUNDAY_GUIDE_TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';
const PERMISSIONS_CONFIG_ASSISTANT_ID = '__SYSTEM_PERMISSIONS__';
const PERMISSIONS_CONFIG_TYPE = 'GLOBAL_UPLOAD_PERMISSIONS';

export const INTERNAL_ACTOR_ID = 'internal';

export type PermissionGroups = {
  ADMINS: string[];
  EDITORS: string[];
  SPECIAL_USERS: string[];
};

function normalizeStringArray(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((item) => String(item ?? '').trim()).filter(Boolean))];
}

function normalizePermissionGroups(input: unknown): PermissionGroups {
  const groups = (input || {}) as Record<string, unknown>;
  return {
    ADMINS: normalizeStringArray(groups.ADMINS),
    EDITORS: normalizeStringArray(groups.EDITORS),
    SPECIAL_USERS: normalizeStringArray(groups.SPECIAL_USERS),
  };
}

/** 讀取 /api/admin/permissions 存在 DynamoDB 的權限設定；不存在或讀取失敗回傳 null。 */
export async function readPermissionConfig(): Promise<{ uploadPermittedUsers: string[]; permissionGroups: PermissionGroups } | null> {
  try {
    const client = await createDynamoDBClient();
    const result = await client.send(
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

    const record = (result.Items || []).find((item) => item.recordType === PERMISSIONS_CONFIG_TYPE);
    if (!record) return null;

    return {
      uploadPermittedUsers: normalizeStringArray(record.uploadPermittedUsers),
      permissionGroups: normalizePermissionGroups(record.permissionGroups),
    };
  } catch (error) {
    console.warn('[admin] 讀取權限設定失敗，改用靜態名單:', error);
    return null;
  }
}

function superAdminIds(): string[] {
  const ids = (process.env.ADMIN_USER_IDS || '1').split(',').map((id) => id.trim()).filter(Boolean);
  return ids.length > 0 ? ids : ['1'];
}

export function isSuperAdmin(userId: string): boolean {
  return superAdminIds().includes(userId);
}

export async function isAdmin(userId: string): Promise<boolean> {
  if (isSuperAdmin(userId)) return true;
  const stored = await readPermissionConfig();
  const admins = stored?.permissionGroups.ADMINS || PERMISSION_GROUPS.ADMINS;
  return admins.includes(userId);
}

export function forbidden(message = '沒有權限執行此操作') {
  return NextResponse.json({ success: false, code: 'FORBIDDEN', error: message }, { status: 403 });
}

/**
 * 需要管理員；回傳操作者 id（會員 userId，內部呼叫為 'internal'）或要直接回應的錯誤。
 * superOnly：只允許超級管理員（例如修改 ADMINS 群組本身，避免群組成員自行擴權）。
 */
export async function requireAdmin(
  request: Request,
  options: { superOnly?: boolean } = {}
): Promise<{ actorId: string } | { response: NextResponse }> {
  if (isInternalRequest(request)) return { actorId: INTERNAL_ACTOR_ID };

  const auth = requireMember(request);
  if ('response' in auth) return auth;

  const { userId } = auth.identity;
  const allowed = options.superOnly ? isSuperAdmin(userId) : await isAdmin(userId);
  if (!allowed) return { response: forbidden() };
  return { actorId: userId };
}
