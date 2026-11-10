import { NextResponse } from 'next/server';
import { QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { requireAdmin } from '@/app/lib/identity/admin';
import { isNonMemberUsageKey } from '@/app/lib/credits';
import { analyticsClient, mapLimit, readDay, TRACKED_SITES, utcDay, type DayItems, type TrackedSite } from '@/app/lib/analytics/store';

/**
 * 網站流量統計（/site-analytics 後台頁）。僅限管理員。
 *
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&site=all|wp|app （UTC 日，含頭尾，最多 366 天）
 *
 * 資料來源：
 * - 瀏覽量／訪客／頁面／來源／國家／裝置：DynamoDB SiteAnalytics（見 app/lib/analytics/store.ts）
 * - 新註冊：WordPress custom/v1/signup_stats（wp-mu-plugins/a4k-visit-stats.php，service token）
 * - AI 用量：SiteAnalytics 的每日計數（上線後才有）＋ MonthlyTokenUsage 的會員月用量
 *   與訪客每日預算列（__guest_budget__，歷史資料）
 */

export const dynamic = 'force-dynamic';

const MAX_DAYS = 366;
const DIMENSIONS = { p: 'pages', r: 'referrers', c: 'countries', d: 'devices', b: 'browsers', o: 'os' } as const;
type DimensionKey = keyof typeof DIMENSIONS;

interface Counter { views: number; visitors: number }
interface DimensionRow { key: string; views: number; visitors: number; site?: TrackedSite }

const SIGNUP_CACHE_MS = 10 * 60 * 1000;
const signupCache = new Map<string, { at: number; value: SignupResult }>();

type SignupResult =
  | { available: true; daily: Record<string, number>; totalUsers: number }
  | { available: false; reason: string };

function isDay(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

function num(value: unknown): number {
  return Number(value) || 0;
}

async function fetchSignups(from: string, to: string): Promise<SignupResult> {
  const cacheKey = `${from}|${to}`;
  const cached = signupCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SIGNUP_CACHE_MS) return cached.value;

  const token = process.env.WP_SERVICE_TOKEN;
  if (!token) return { available: false, reason: '伺服器未設定 WP_SERVICE_TOKEN' };
  const base = process.env.WP_API_BASE || process.env.NEXT_PUBLIC_WP_API_BASE || 'https://ai4kingdom.org/wp-json/custom/v1';

  try {
    const response = await fetch(`${base}/signup_stats?from=${from}&to=${to}`, {
      headers: { 'X-A4K-Service-Token': token },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) {
      return { available: false, reason: 'WordPress 尚未安裝 a4k-visit-stats.php（註冊統計端點）' };
    }
    if (!response.ok) return { available: false, reason: `WordPress 回應 ${response.status}` };
    const data = await response.json();
    const daily: Record<string, number> = {};
    for (const row of data.daily || []) daily[row.day] = num(row.signups);
    const value: SignupResult = { available: true, daily, totalUsers: num(data.totalUsers) };
    signupCache.set(cacheKey, { at: Date.now(), value });
    return value;
  } catch (error) {
    return { available: false, reason: `無法連線 WordPress：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** 會員每月 AI 用量（MonthlyTokenUsage，YearMonth = YYYY-MM）。表約數百列，掃描成本低。 */
async function fetchMonthlyAi(fromMonth: string, toMonth: string) {
  const client = analyticsClient();
  const months = new Map<string, { members: number; tokens: number }>();
  let startKey: Record<string, unknown> | undefined;
  do {
    const result = await client.send(
      new ScanCommand({
        TableName: 'MonthlyTokenUsage',
        ProjectionExpression: 'UserId, YearMonth, totalTokens',
        FilterExpression: 'YearMonth BETWEEN :from AND :to',
        ExpressionAttributeValues: { ':from': fromMonth, ':to': toMonth },
        ExclusiveStartKey: startKey,
      })
    );
    for (const item of result.Items || []) {
      if (!/^\d{4}-\d{2}$/.test(String(item.YearMonth)) || isNonMemberUsageKey(item.UserId)) continue;
      const tokens = num(item.totalTokens);
      if (tokens <= 0) continue;
      const entry = months.get(item.YearMonth) || { members: 0, tokens: 0 };
      entry.members += 1;
      entry.tokens += tokens;
      months.set(item.YearMonth, entry);
    }
    startKey = result.LastEvaluatedKey;
  } while (startKey);
  return [...months.entries()]
    .map(([month, value]) => ({ month, activeMembers: value.members, tokens: value.tokens }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

/** 訪客每日 AI 用量（credits.ts 的全站訪客預算列，早於本功能就有資料）。 */
async function fetchGuestDailyTokens(from: string, to: string): Promise<Record<string, number>> {
  const result = await analyticsClient().send(
    new QueryCommand({
      TableName: 'MonthlyTokenUsage',
      KeyConditionExpression: 'UserId = :id AND YearMonth BETWEEN :from AND :to',
      ExpressionAttributeValues: { ':id': '__guest_budget__', ':from': `day-${from}`, ':to': `day-${to}` },
    })
  );
  const daily: Record<string, number> = {};
  for (const item of result.Items || []) daily[String(item.YearMonth).slice(4)] = num(item.totalTokens);
  return daily;
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ('response' in auth) return auth.response;

  const url = new URL(request.url);
  const today = utcDay();
  const to = isDay(url.searchParams.get('to')) ? url.searchParams.get('to')! : today;
  const defaultFrom = utcDay(new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000));
  const from = isDay(url.searchParams.get('from')) ? url.searchParams.get('from')! : defaultFrom;
  if (from > to) return NextResponse.json({ success: false, error: '開始日期不可晚於結束日期' }, { status: 400 });

  const days = daysBetween(from, to);
  if (days.length > MAX_DAYS) {
    return NextResponse.json({ success: false, error: `日期區間最多 ${MAX_DAYS} 天` }, { status: 400 });
  }

  const siteParam = url.searchParams.get('site');
  const sites: TrackedSite[] = siteParam === 'wp' || siteParam === 'app' ? [siteParam] : TRACKED_SITES;

  try {
    const jobs = [
      ...sites.flatMap((site) => days.map((day) => ({ site: site as TrackedSite | 'ai', day }))),
      ...days.map((day) => ({ site: 'ai' as const, day })),
    ];
    const [dayResults, signups, monthlyAi, guestDailyTokens] = await Promise.all([
      mapLimit(jobs, 12, async (job) => ({ ...job, items: await readDay(job.site, job.day) })),
      fetchSignups(from, to),
      fetchMonthlyAi(from.slice(0, 7), to.slice(0, 7)).catch((error) => {
        console.error('[site-stats] 讀取 MonthlyTokenUsage 失敗:', error);
        return [];
      }),
      fetchGuestDailyTokens(from, to).catch(() => ({} as Record<string, number>)),
    ]);

    const daily = new Map(
      days.map((day) => [
        day,
        {
          day,
          wp: { views: 0, visitors: 0 } as Counter,
          app: { views: 0, visitors: 0 } as Counter,
          signups: signups.available ? signups.daily[day] || 0 : null,
          aiRequests: 0,
          aiUsers: 0,
          aiTokens: 0,
          aiGuestTokens: guestDailyTokens[day] || 0,
        },
      ])
    );
    const dims: Record<DimensionKey, Map<string, DimensionRow>> = {
      p: new Map(), r: new Map(), c: new Map(), d: new Map(), b: new Map(), o: new Map(),
    };

    for (const { site, day, items } of dayResults as Array<{ site: TrackedSite | 'ai'; day: string; items: DayItems }>) {
      const row = daily.get(day)!;
      for (const item of items) {
        if (site === 'ai') {
          if (item.sk === 'total') {
            row.aiRequests += num(item.requests);
            row.aiUsers += num(item.users);
            row.aiTokens += num(item.tokens);
          }
          continue;
        }
        if (item.sk === 'total') {
          row[site].views += num(item.views);
          row[site].visitors += num(item.visitors);
          continue;
        }
        const prefix = item.sk.slice(0, 1) as DimensionKey;
        if (!(prefix in dims) || item.sk[1] !== '#') continue;
        const name = item.sk.slice(2);
        // 頁面依網站分開（同路徑在兩邊是不同頁）；其他維度跨網站合併
        const mapKey = prefix === 'p' ? `${site}|${name}` : name;
        const entry = dims[prefix].get(mapKey) || { key: name, views: 0, visitors: 0, ...(prefix === 'p' ? { site } : {}) };
        entry.views += num(item.views);
        entry.visitors += num(item.visitors);
        dims[prefix].set(mapKey, entry);
      }
    }

    const dailyRows = [...daily.values()];
    const totals = dailyRows.reduce(
      (acc, row) => {
        acc.views += row.wp.views + row.app.views;
        acc.visitors += row.wp.visitors + row.app.visitors;
        acc.wpViews += row.wp.views;
        acc.appViews += row.app.views;
        acc.signups += row.signups || 0;
        acc.aiRequests += row.aiRequests;
        acc.aiUsers += row.aiUsers;
        acc.aiTokens += row.aiTokens;
        return acc;
      },
      { views: 0, visitors: 0, wpViews: 0, appViews: 0, signups: 0, aiRequests: 0, aiUsers: 0, aiTokens: 0 }
    );

    const sorted = (key: DimensionKey) =>
      [...dims[key].values()].sort((a, b) => b.views - a.views || a.key.localeCompare(b.key));

    return NextResponse.json({
      success: true,
      from,
      to,
      sites,
      totals,
      daily: dailyRows,
      pages: sorted('p'),
      referrers: sorted('r'),
      countries: sorted('c'),
      devices: sorted('d'),
      browsers: sorted('b'),
      os: sorted('o'),
      signups: signups.available
        ? { available: true, totalUsers: signups.totalUsers }
        : { available: false, reason: signups.reason },
      monthlyAi,
    });
  } catch (error) {
    console.error('[site-stats] 讀取統計失敗:', error);
    return NextResponse.json(
      { success: false, error: '讀取統計失敗', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
