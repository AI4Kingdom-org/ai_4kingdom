import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import {
  browserName,
  countryFromTimezone,
  deviceType,
  isBot,
  normalizePath,
  osName,
  referrerName,
} from '@/app/lib/analytics/classify';
import { recordPageHit, utcDay, type TrackedSite } from '@/app/lib/analytics/store';

/**
 * 公開的瀏覽紀錄接收端（navigator.sendBeacon）。
 *
 * 來源：WordPress 頁尾腳本（wp-mu-plugins/a4k-visit-stats.php，site=wp）
 *       與 app 的 VisitTracker 元件（site=app）。
 *
 * - 只接受白名單 Origin，擋掉沒有 Origin 的直接呼叫
 * - 機器人 UA 不記錄
 * - 不保存 IP：訪客以 sha256(鹽 + 日期 + IP + UA) 前 16 碼去重，隔天無法對應
 * - 每個執行個體每 IP 每分鐘最多 60 筆，避免被灌爆寫入量
 */

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2048;
const RATE_LIMIT_PER_MINUTE = 60;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

const STATIC_ALLOWED_ORIGINS = [
  'https://ai4kingdom.org',
  'https://www.ai4kingdom.org',
  'https://main.d1b5nk0vz3t0hz.amplifyapp.com',
];

function allowedOrigins(request: Request): string[] {
  const extra = (process.env.ANALYTICS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const host = request.headers.get('host');
  const own = host ? [`https://${host}`, `http://${host}`] : [];
  return [...STATIC_ALLOWED_ORIGINS, ...extra, ...own];
}

function corsHeaders(origin: string | null): Record<string, string> {
  return origin
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        Vary: 'Origin',
      }
    : {};
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    if (rateBuckets.size > 5000) rateBuckets.clear();
    rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_PER_MINUTE;
}

function visitorHash(ip: string, ua: string, day: string): string {
  const salt = process.env.ANALYTICS_SALT || process.env.WP_SERVICE_TOKEN || 'a4k-analytics';
  return createHash('sha256').update(`${salt}|${day}|${ip}|${ua}`).digest('hex').slice(0, 16);
}

function headerCountry(request: Request): string | null {
  const value =
    request.headers.get('cloudfront-viewer-country') ||
    request.headers.get('cf-ipcountry') ||
    request.headers.get('x-vercel-ip-country');
  return value && /^[A-Z]{2}$/.test(value) && value !== 'XX' ? value : null;
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  const ok = origin && allowedOrigins(request).includes(origin);
  return new NextResponse(null, { status: 204, headers: corsHeaders(ok ? origin : null) });
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins(request).includes(origin)) {
    return new NextResponse(null, { status: 403 });
  }
  const headers = corsHeaders(origin);
  const done = () => new NextResponse(null, { status: 204, headers });

  const ua = request.headers.get('user-agent') || '';
  if (isBot(ua)) return done();

  const ip = clientIp(request);
  if (rateLimited(ip)) return new NextResponse(null, { status: 429, headers });

  let payload: { site?: unknown; path?: unknown; ref?: unknown; tz?: unknown };
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413, headers });
    payload = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400, headers });
  }

  const site = payload.site === 'wp' || payload.site === 'app' ? (payload.site as TrackedSite) : null;
  const path = normalizePath(String(payload.path ?? ''));
  if (!site || !path) return new NextResponse(null, { status: 400, headers });

  const host = (request.headers.get('host') || '').split(':')[0].toLowerCase();
  const ref = typeof payload.ref === 'string' ? payload.ref.slice(0, 500) : '';
  const tz = typeof payload.tz === 'string' ? payload.tz.slice(0, 64) : '';

  try {
    await recordPageHit({
      site,
      path,
      referrer: referrerName(ref, host ? [host] : []),
      country: headerCountry(request) || countryFromTimezone(tz),
      device: deviceType(ua),
      browser: browserName(ua),
      os: osName(ua),
      visitorHash: visitorHash(ip, ua, utcDay()),
    });
  } catch (error) {
    console.error('[analytics] 寫入瀏覽紀錄失敗:', error);
  }
  return done();
}
