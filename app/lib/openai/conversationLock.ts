import { DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '@/app/utils/dynamodb';

const CHAT_HISTORY_TABLE = process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME || 'ChatHistory';
// 借用既有 ChatHistory 表的 (UserId, Timestamp) 主鍵存放跨 instance 的對話鎖，不需新建表。
const LOCK_PARTITION = '__conversation_lock__';
const LOCK_TTL_MS = 120000;

/**
 * 跨 instance 安全的對話鎖（DynamoDB 條件寫入）。
 * 取代舊版「記憶體鎖 + openai.beta.threads.runs.list() 查詢活躍 run」的雙重保護——
 * Responses/Conversations 沒有對應的「列出進行中回應」API，改用條件寫入達到同等（多 instance 下甚至更可靠）的互斥效果。
 */
export async function acquireConversationLock(conversationId: string): Promise<boolean> {
  try {
    const doc = await createDynamoDBClient();
    const now = Date.now();
    await doc.send(new PutCommand({
      TableName: CHAT_HISTORY_TABLE,
      Item: { UserId: LOCK_PARTITION, Timestamp: conversationId, expiresAt: now + LOCK_TTL_MS },
      ConditionExpression: 'attribute_not_exists(UserId) OR expiresAt < :now',
      ExpressionAttributeValues: { ':now': now },
    }));
    return true;
  } catch (e: any) {
    if (e?.name === 'ConditionalCheckFailedException') return false;
    // DynamoDB 本身不可用時不應讓聊天功能整個失效，退回「允許執行」並記錄警告。
    console.warn('[WARN] 取得對話鎖失敗（DynamoDB 錯誤），略過鎖定繼續執行:', e);
    return true;
  }
}

export async function releaseConversationLock(conversationId: string): Promise<void> {
  try {
    const doc = await createDynamoDBClient();
    await doc.send(new DeleteCommand({
      TableName: CHAT_HISTORY_TABLE,
      Key: { UserId: LOCK_PARTITION, Timestamp: conversationId },
    }));
  } catch (e) {
    console.warn('[WARN] 釋放對話鎖失敗（不影響本次請求結果，鎖會於 TTL 後自動失效）:', e);
  }
}
