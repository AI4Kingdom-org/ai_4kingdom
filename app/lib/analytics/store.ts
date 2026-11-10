import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDBConfig } from '@/app/utils/dynamodb';

/**
 * 網站流量統計的儲存層（DynamoDB 表 SiteAnalytics，pk/sk 字串鍵，TTL 欄位 expiresAt）。
 *
 * 只存「每日計數」，不存逐筆瀏覽或 IP：
 * - pk = D#<site>#<YYYY-MM-DD>（UTC 日）
 *   - sk = total          → views、visitors
 *   - sk = p#<path>       → views（頁面）
 *   - sk = r#<來源>       → views（外部來源，每次進站計一次）
 *   - sk = c#<國碼>、d#<裝置>、b#<瀏覽器>、o#<作業系統> → views、visitors
 * - pk = V#<site>#<day>、sk = <訪客雜湊> → 判斷當日是否為新訪客，3 天後由 TTL 刪除
 * - AI 用量：pk = D#ai#<day>、sk = total → requests、tokens、memberRequests、guestRequests、users…
 *   pk = V#ai#<day>、sk = <userId> → 當日 AI 使用者去重
 *
 * 訪客數是「每日不重複訪客」：雜湊含日期與每日變動的鹽，跨日無法串連同一人，
 * 所以日期區間的訪客數是各日加總（訪客·日），不是區間內的不重複人數。
 */

export const ANALYTICS_TABLE = process.env.SITE_ANALYTICS_TABLE || 'SiteAnalytics';
export type TrackedSite = 'wp' | 'app';
export const TRACKED_SITES: TrackedSite[] = ['wp', 'app'];

const VISITOR_TTL_SECONDS = 3 * 24 * 60 * 60;

let cachedClient: DynamoDBDocumentClient | null = null;

/** 每次 beacon 都會呼叫，避免 createDynamoDBClient() 的除錯 log 與重複建立連線。 */
export function analyticsClient(): DynamoDBDocumentClient {
  if (!cachedClient) {
    const config = getDynamoDBConfig();
    cachedClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: config.region, credentials: config.credentials }),
      { marshallOptions: { removeUndefinedValues: true } }
    );
  }
  return cachedClient;
}

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** 第一次出現回傳 true；同一天重複出現回傳 false。 */
async function markFirstSeen(pk: string, sk: string): Promise<boolean> {
  try {
    await analyticsClient().send(
      new PutCommand({
        TableName: ANALYTICS_TABLE,
        Item: { pk, sk, expiresAt: Math.floor(Date.now() / 1000) + VISITOR_TTL_SECONDS },
        ConditionExpression: 'attribute_not_exists(pk)',
      })
    );
    return true;
  } catch (error) {
    if ((error as { name?: string })?.name === 'ConditionalCheckFailedException') return false;
    throw error;
  }
}

function addCounters(pk: string, sk: string, counters: Record<string, number>) {
  const entries = Object.entries(counters).filter(([, value]) => value !== 0);
  if (entries.length === 0) return Promise.resolve();
  const names: Record<string, string> = {};
  const values: Record<string, number> = {};
  const parts = entries.map(([key, value], i) => {
    names[`#f${i}`] = key;
    values[`:v${i}`] = value;
    return `#f${i} :v${i}`;
  });
  return analyticsClient().send(
    new UpdateCommand({
      TableName: ANALYTICS_TABLE,
      Key: { pk, sk },
      UpdateExpression: `ADD ${parts.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
}

export interface PageHit {
  site: TrackedSite;
  path: string;
  /** 外部來源名稱；站內瀏覽為 null（不計入來源）。 */
  referrer: string | null;
  country: string;
  device: string;
  browser: string;
  os: string;
  visitorHash: string;
}

export async function recordPageHit(hit: PageHit): Promise<void> {
  const day = utcDay();
  const pk = `D#${hit.site}#${day}`;
  const isNewVisitor = await markFirstSeen(`V#${hit.site}#${day}`, hit.visitorHash);
  const v = isNewVisitor ? 1 : 0;

  const writes = [
    addCounters(pk, 'total', { views: 1, visitors: v }),
    addCounters(pk, `p#${hit.path}`, { views: 1 }),
    addCounters(pk, `c#${hit.country}`, { views: 1, visitors: v }),
    addCounters(pk, `d#${hit.device}`, { views: 1, visitors: v }),
    addCounters(pk, `b#${hit.browser}`, { views: 1, visitors: v }),
    addCounters(pk, `o#${hit.os}`, { views: 1, visitors: v }),
  ];
  if (hit.referrer) writes.push(addCounters(pk, `r#${hit.referrer}`, { views: 1 }));
  await Promise.all(writes);
}

/**
 * 記錄一次 AI 呼叫（聊天、檔案處理等扣點的地方）。失敗只記 log，不影響呼叫端。
 */
export async function recordAiUsage(kind: 'member' | 'guest', userKey: string, totalTokens: number): Promise<void> {
  try {
    const day = utcDay();
    const isNewUser = await markFirstSeen(`V#ai#${day}`, `${kind}#${userKey}`);
    await addCounters(`D#ai#${day}`, 'total', {
      requests: 1,
      tokens: Math.max(0, Math.round(totalTokens || 0)),
      [`${kind}Requests`]: 1,
      [`${kind}Tokens`]: Math.max(0, Math.round(totalTokens || 0)),
      users: isNewUser ? 1 : 0,
      [`${kind}Users`]: isNewUser ? 1 : 0,
    });
  } catch (error) {
    console.error('[analytics] 記錄 AI 用量失敗:', error);
  }
}

export type DayItems = Array<Record<string, unknown> & { sk: string }>;

export async function readDay(site: TrackedSite | 'ai', day: string): Promise<DayItems> {
  const items: DayItems = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const result = await analyticsClient().send(
      new QueryCommand({
        TableName: ANALYTICS_TABLE,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': `D#${site}#${day}` },
        ExclusiveStartKey: startKey,
      })
    );
    items.push(...((result.Items || []) as DayItems));
    startKey = result.LastEvaluatedKey;
  } while (startKey);
  return items;
}

/** 以有限並行度執行，避免一次對 DynamoDB 發出上百個查詢。 */
export async function mapLimit<T, R>(list: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(list.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const index = next++;
      results[index] = await fn(list[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
