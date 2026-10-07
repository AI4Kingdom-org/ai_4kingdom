import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { updateMonthlyTokenUsage } from '@/app/utils/monthlyTokenUsage';
import { GUEST_TOKEN_LIMIT, TOKEN_TO_CREDIT_RATIO, getTokenLimit, tokensToCredits } from '@/app/config/plans';
import type { Identity } from '@/app/lib/identity/server';

/**
 * 伺服器端額度檢查與記帳。
 *
 * 以前額度只在前端計算（上傳按鈕在 0 點時停用），聊天完全不檢查；
 * 現在每次呼叫 OpenAI 之前都先在這裡檢查，用完後在這裡記帳。
 *
 * 訪客額外有兩道防線（皆存於 MonthlyTokenUsage，不需新表）：
 * - 每個 IP 每日上限：清掉 localStorage 就能重拿 50 點，靠這個擋重複領取
 * - 全站訪客每日總預算：被灌爆時的總開關
 */

const TABLE = 'MonthlyTokenUsage';
const GUEST_LIFETIME_KEY = 'lifetime';
const GUEST_BUDGET_PARTITION = '__guest_budget__';

// 以 credit 為單位設定，方便在 Amplify 環境變數直接調整
const GUEST_IP_DAILY_CREDITS = Number(process.env.GUEST_IP_DAILY_CREDITS) || 150;
const GUEST_DAILY_BUDGET_CREDITS = Number(process.env.GUEST_DAILY_BUDGET_CREDITS) || 5000;

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  retrieval_tokens: number;
}

export interface CreditStatus {
  kind: Identity['kind'];
  plan: string;
  limitTokens: number;
  usedTokens: number;
  remainingCredits: number;
  totalCredits: number;
}

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function todayKey(): string {
  return `day-${new Date().toISOString().slice(0, 10)}`;
}

/** 取得用戶端 IP（Amplify / CloudFront 會放在 x-forwarded-for 第一個）。 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

async function readTotalTokens(userId: string, yearMonth: string): Promise<number> {
  const doc = await createDynamoDBClient();
  const res = await doc.send(new GetCommand({ TableName: TABLE, Key: { UserId: userId, YearMonth: yearMonth } }));
  return Number(res.Item?.totalTokens) || 0;
}

async function addTotalTokens(userId: string, yearMonth: string, usage: TokenUsage): Promise<void> {
  const doc = await createDynamoDBClient();
  await doc.send(new UpdateCommand({
    TableName: TABLE,
    Key: { UserId: userId, YearMonth: yearMonth },
    UpdateExpression: `
      SET promptTokens = if_not_exists(promptTokens, :zero) + :prompt,
          completionTokens = if_not_exists(completionTokens, :zero) + :completion,
          totalTokens = if_not_exists(totalTokens, :zero) + :total,
          retrievalTokens = if_not_exists(retrievalTokens, :zero) + :retrieval,
          lastUpdated = :now
    `,
    ExpressionAttributeValues: {
      ':zero': 0,
      ':prompt': usage.prompt_tokens || 0,
      ':completion': usage.completion_tokens || 0,
      ':total': usage.total_tokens || 0,
      ':retrieval': usage.retrieval_tokens || 0,
      ':now': new Date().toISOString(),
    },
  }));
}

export async function getCreditStatus(identity: Identity): Promise<CreditStatus> {
  const limitTokens = identity.kind === 'member' ? getTokenLimit(identity.plan) : GUEST_TOKEN_LIMIT;
  const usedTokens = identity.kind === 'member'
    ? await readTotalTokens(identity.userId, currentYearMonth())
    : await readTotalTokens(identity.id, GUEST_LIFETIME_KEY);

  return {
    kind: identity.kind,
    plan: identity.kind === 'member' ? identity.plan : 'guest',
    limitTokens,
    usedTokens,
    remainingCredits: tokensToCredits(Math.max(0, limitTokens - usedTokens)),
    totalCredits: Math.floor(limitTokens / TOKEN_TO_CREDIT_RATIO),
  };
}

function insufficientCredits(identity: Identity, message: string) {
  return NextResponse.json(
    {
      success: false,
      code: 'INSUFFICIENT_CREDITS',
      loginRequired: identity.kind === 'guest',
      error: message,
    },
    { status: 402 }
  );
}

/**
 * 呼叫 OpenAI 前檢查額度。可以花用時回傳 null，否則回傳 402 回應。
 * 只檢查「還有剩」，單次回覆可能小幅超出上限，這是可接受的取捨（不必預估回覆長度）。
 */
export async function checkCredits(identity: Identity, request: Request): Promise<NextResponse | null> {
  try {
    const status = await getCreditStatus(identity);
    if (status.usedTokens >= status.limitTokens) {
      return insufficientCredits(
        identity,
        identity.kind === 'guest'
          ? '訪客試用額度（50 點）已用完，免費註冊即可獲得每月 300 點。'
          : '本月額度已用完，請於下月重置後再使用，或升級方案。'
      );
    }

    if (identity.kind === 'guest') {
      const day = todayKey();
      const ipTokens = await readTotalTokens(`guestip_${getClientIp(request)}`, day);
      if (ipTokens >= GUEST_IP_DAILY_CREDITS * TOKEN_TO_CREDIT_RATIO) {
        return insufficientCredits(identity, '今日訪客試用次數已達上限，免費註冊即可繼續使用。');
      }
      const budgetTokens = await readTotalTokens(GUEST_BUDGET_PARTITION, day);
      if (budgetTokens >= GUEST_DAILY_BUDGET_CREDITS * TOKEN_TO_CREDIT_RATIO) {
        return insufficientCredits(identity, '今日訪客試用名額已滿，免費註冊即可繼續使用。');
      }
    }
    return null;
  } catch (e) {
    // DynamoDB 暫時不可用時不擋會員（與既有「記帳失敗不中斷請求」一致），但訪客一律擋下以控成本
    console.error('[credits] 額度檢查失敗:', e);
    return identity.kind === 'guest'
      ? insufficientCredits(identity, '目前無法確認試用額度，請稍後再試或登入使用。')
      : null;
  }
}

/** 記錄用量。記帳失敗只記 log，不影響已完成的回應。 */
export async function recordUsage(identity: Identity, usage: TokenUsage, request: Request): Promise<void> {
  try {
    if (identity.kind === 'member') {
      await updateMonthlyTokenUsage(identity.userId, usage);
      return;
    }
    const day = todayKey();
    await Promise.all([
      addTotalTokens(identity.id, GUEST_LIFETIME_KEY, usage),
      addTotalTokens(`guestip_${getClientIp(request)}`, day, usage),
      addTotalTokens(GUEST_BUDGET_PARTITION, day, usage),
    ]);
  } catch (e) {
    console.error('[credits] 記錄用量失敗:', { id: identity.id, usage, error: e });
  }
}

/** MonthlyTokenUsage 中屬於訪客／系統計數的列，不是真實會員。 */
export function isNonMemberUsageKey(userId: unknown): boolean {
  const id = String(userId || '');
  return id.startsWith('guest') || id.startsWith('__');
}
