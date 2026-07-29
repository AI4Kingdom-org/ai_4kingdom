import OpenAI from 'openai';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '@/app/utils/dynamodb';

const CHAT_HISTORY_TABLE = process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME || 'ChatHistory';
// 舊 thread → 新 conversation 的對照表：借用 ChatHistory 既有的 (UserId, Timestamp) 主鍵，
// 以固定分區存放，Timestamp 欄位放舊 threadId，可 O(1) 查詢且不需新表。
const MIGRATION_PARTITION = '__thread_migration__';
// conversations.create()/items.create() 單次最多 20 個 items，但可重複呼叫 items.create() 分批附加，
// 因此以下會分批搬移「全部」歷史（非只取最後 20 則），避免舊對話上下文被截斷影響生成品質。
const ITEMS_BATCH_SIZE = 20;
const MIGRATION_SEED_LIMIT = 200; // 單次遷移搬移的訊息數上限，避免極端長對話拖慢使用者當下這次請求

export function isConversationId(id?: string | null): id is string {
  return !!id && id.startsWith('conv');
}

export function isLegacyThreadId(id?: string | null): id is string {
  return !!id && id.startsWith('thread');
}

function cleanMetadata(metadata?: Record<string, unknown>): Record<string, string> | undefined {
  if (!metadata) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  }
  return Object.keys(out).length ? out : undefined;
}

async function findMigratedConversationId(oldThreadId: string): Promise<string | null> {
  try {
    const doc = await createDynamoDBClient();
    const res = await doc.send(new GetCommand({
      TableName: CHAT_HISTORY_TABLE,
      Key: { UserId: MIGRATION_PARTITION, Timestamp: oldThreadId },
    }));
    return (res.Item?.conversationId as string) || null;
  } catch (e) {
    console.warn('[WARN] 查詢 thread 遷移對照失敗:', e);
    return null;
  }
}

async function saveMigrationMapping(oldThreadId: string, conversationId: string) {
  try {
    const doc = await createDynamoDBClient();
    await doc.send(new PutCommand({
      TableName: CHAT_HISTORY_TABLE,
      Item: {
        UserId: MIGRATION_PARTITION,
        Timestamp: oldThreadId,
        conversationId,
        migratedAt: new Date().toISOString(),
      },
    }));
  } catch (e) {
    console.warn('[WARN] 寫入 thread 遷移對照失敗:', e);
  }
}

// 將 ChatHistory 中引用舊 threadId 的列改指向新 conversationId（保留 legacyThreadId 供追溯）
async function updateChatHistoryThreadId(oldThreadId: string, conversationId: string) {
  try {
    const doc = await createDynamoDBClient();
    const res = await doc.send(new QueryCommand({
      TableName: CHAT_HISTORY_TABLE,
      IndexName: 'threadId-index',
      KeyConditionExpression: 'threadId = :t',
      ExpressionAttributeValues: { ':t': oldThreadId },
    }));
    for (const item of res.Items || []) {
      if (item.UserId === MIGRATION_PARTITION) continue;
      await doc.send(new UpdateCommand({
        TableName: CHAT_HISTORY_TABLE,
        Key: { UserId: item.UserId, Timestamp: item.Timestamp },
        UpdateExpression: 'SET threadId = :n, legacyThreadId = :o',
        ExpressionAttributeValues: { ':n': conversationId, ':o': oldThreadId },
      }));
    }
  } catch (e) {
    console.warn('[WARN] 更新 ChatHistory threadId 失敗（不阻斷）:', e);
  }
}

/**
 * 懶遷移：把舊 Assistants thread 的近期訊息搬進新 Conversation。
 * Assistants API 日落後 threads.messages.list 會失敗，此時建立空的 conversation（歷史遺失但可繼續對話）。
 */
export async function migrateThreadToConversation(
  openai: OpenAI,
  threadId: string,
  metadata?: Record<string, unknown>
): Promise<string> {
  const existing = await findMigratedConversationId(threadId);
  if (existing) return existing;

  type SeedItem =
    | { type: 'message'; role: 'user'; content: { type: 'input_text'; text: string }[] }
    | { type: 'message'; role: 'assistant'; content: { type: 'output_text'; text: string }[] };
  let items: SeedItem[] = [];
  try {
    // 由舊到新遍歷（order: 'asc'），最多累積 MIGRATION_SEED_LIMIT 則，以保留完整對話上下文
    const page = await openai.beta.threads.messages.list(threadId, { limit: 100, order: 'asc' });
    for await (const m of page) {
      const text = (m.content || [])
        .filter((c) => c.type === 'text')
        .map((c) => (c.type === 'text' ? c.text.value : ''))
        .join('\n')
        .trim();
      if (text) {
        items.push(
          m.role === 'assistant'
            ? { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }
            : { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
        );
      }
      if (items.length >= MIGRATION_SEED_LIMIT) {
        console.warn('[WARN] 舊 thread 訊息數超過遷移上限，僅搬移最舊的', MIGRATION_SEED_LIMIT, '則:', threadId);
        break;
      }
    }
  } catch (e) {
    console.warn('[WARN] 無法讀取舊 thread 訊息（可能已日落），將建立空 conversation:', threadId, e instanceof Error ? e.message : e);
  }

  // conversations.create() 最多接受 20 個初始 items，其餘分批用 items.create() 附加（保持時間順序）
  const firstBatch = items.slice(0, ITEMS_BATCH_SIZE);
  const conversation = await openai.conversations.create({
    metadata: cleanMetadata({ ...metadata, migratedFrom: threadId }),
    ...(firstBatch.length ? { items: firstBatch as any } : {}),
  });

  for (let i = ITEMS_BATCH_SIZE; i < items.length; i += ITEMS_BATCH_SIZE) {
    const batch = items.slice(i, i + ITEMS_BATCH_SIZE);
    try {
      await openai.conversations.items.create(conversation.id, { items: batch as any });
    } catch (e) {
      console.warn('[WARN] 搬移歷史訊息批次失敗（不中斷遷移）:', threadId, conversation.id, e instanceof Error ? e.message : e);
      break;
    }
  }

  await saveMigrationMapping(threadId, conversation.id);
  await updateChatHistoryThreadId(threadId, conversation.id);
  console.log('[INFO] 已將 thread 遷移為 conversation:', { threadId, conversationId: conversation.id, seededItems: items.length });
  return conversation.id;
}

export interface EnsureConversationResult {
  conversationId: string;
  migrated: boolean;
  created: boolean;
}

/**
 * 接受舊 threadId（thread_...）或新 conversationId（conv_...），
 * 一律回傳可用於 Responses API 的 conversationId。
 */
export async function ensureConversation(
  openai: OpenAI,
  threadOrConversationId?: string | null,
  metadata?: Record<string, unknown>
): Promise<EnsureConversationResult> {
  if (isConversationId(threadOrConversationId)) {
    return { conversationId: threadOrConversationId, migrated: false, created: false };
  }
  if (isLegacyThreadId(threadOrConversationId)) {
    const conversationId = await migrateThreadToConversation(openai, threadOrConversationId, metadata);
    return { conversationId, migrated: true, created: false };
  }
  const conversation = await openai.conversations.create({ metadata: cleanMetadata(metadata) });
  return { conversationId: conversation.id, migrated: false, created: true };
}
