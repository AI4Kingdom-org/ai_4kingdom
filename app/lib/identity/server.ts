import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import type { SubscriptionType } from '@/app/config/plans';

/**
 * 伺服器端身分驗證。
 *
 * 過去每支 API 都直接相信前端帶來的 userId（query / body），任何人都能冒用他人身分。
 * 現在改由兩種簽章 token 判定身分：
 * - 會員：WordPress /hello-biz/v1/session 回傳的 app_token（mu-plugin a4k-app-identity.php 簽發）
 * - 訪客：本服務 /api/identity/guest 簽發的 guest token（每台裝置一組，試用額度綁在上面）
 *
 * 兩者共用同一把衍生金鑰：HMAC-SHA256(WP_SERVICE_TOKEN, 'a4k-identity-v1')，
 * PHP 端以 hash_hmac('sha256', 'a4k-identity-v1', A4K_SERVICE_TOKEN, true) 算出同一把。
 */

export const MEMBER_TOKEN_HEADER = 'x-a4k-auth';
export const GUEST_TOKEN_HEADER = 'x-a4k-guest';
export const INTERNAL_TOKEN_HEADER = 'x-a4k-internal';

export type Identity =
  | { kind: 'member'; id: string; userId: string; plan: SubscriptionType }
  | { kind: 'guest'; id: string; guestId: string };

const VALID_PLANS: SubscriptionType[] = ['free', 'pro', 'ultimate'];

function getSigningKey(): Buffer {
  const secret = process.env.WP_SERVICE_TOKEN;
  if (!secret) {
    throw new Error('WP_SERVICE_TOKEN 未設定，無法驗證身分');
  }
  return createHmac('sha256', secret).update('a4k-identity-v1').digest();
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(payloadB64: string): string {
  return b64url(createHmac('sha256', getSigningKey()).update(payloadB64).digest());
}

/** 驗證 `<payload>.<signature>` 格式並回傳 payload；簽章不符回傳 null。 */
function verify(token: string): Record<string, any> | null {
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;

  const expected = Buffer.from(sign(payloadB64));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    return JSON.parse(fromB64url(payloadB64).toString('utf8'));
  } catch {
    return null;
  }
}

export function verifyMemberToken(token: string): Identity | null {
  const p = verify(token);
  if (!p || p.t !== 'm' || !p.uid) return null;
  if (typeof p.exp !== 'number' || p.exp * 1000 < Date.now()) return null;

  const userId = String(p.uid);
  const plan = VALID_PLANS.includes(p.plan) ? (p.plan as SubscriptionType) : 'free';
  return { kind: 'member', id: userId, userId, plan };
}

export function verifyGuestToken(token: string): Identity | null {
  const p = verify(token);
  if (!p || p.t !== 'g' || typeof p.gid !== 'string' || !/^[a-f0-9]{32}$/.test(p.gid)) return null;
  return { kind: 'guest', id: `guest_${p.gid}`, guestId: p.gid };
}

export function issueGuestToken(): { token: string; id: string } {
  const gid = randomBytes(16).toString('hex');
  const payloadB64 = b64url(JSON.stringify({ t: 'g', gid, iat: Math.floor(Date.now() / 1000) }));
  return { token: `${payloadB64}.${sign(payloadB64)}`, id: `guest_${gid}` };
}

/**
 * 從請求標頭判定身分。帶了會員 token 卻驗不過時不退回訪客，
 * 讓前端知道要重新取得 session，而不是悄悄把會員當訪客扣試用額度。
 */
export function getRequestIdentity(request: Request): Identity | null {
  const memberToken = request.headers.get(MEMBER_TOKEN_HEADER);
  if (memberToken) return verifyMemberToken(memberToken);

  const guestToken = request.headers.get(GUEST_TOKEN_HEADER);
  if (guestToken) return verifyGuestToken(guestToken);

  return null;
}

/** 伺服器對伺服器的內部呼叫（例如 documents → process-document）。 */
export function isInternalRequest(request: Request): boolean {
  const sent = request.headers.get(INTERNAL_TOKEN_HEADER);
  const secret = process.env.WP_SERVICE_TOKEN;
  if (!sent || !secret) return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function internalRequestHeaders(): Record<string, string> {
  return process.env.WP_SERVICE_TOKEN ? { [INTERNAL_TOKEN_HEADER]: process.env.WP_SERVICE_TOKEN } : {};
}

export function unauthorized(message = '請重新整理頁面後再試') {
  return NextResponse.json({ success: false, code: 'UNAUTHORIZED', error: message }, { status: 401 });
}

export function membersOnly(message = '此功能需要登入會員') {
  return NextResponse.json({ success: false, code: 'LOGIN_REQUIRED', error: message }, { status: 403 });
}

/** 需要已登入會員；回傳 Identity 或要直接回應的錯誤。 */
export function requireMember(request: Request): { identity: Extract<Identity, { kind: 'member' }> } | { response: NextResponse } {
  const identity = getRequestIdentity(request);
  if (!identity) return { response: unauthorized() };
  if (identity.kind !== 'member') return { response: membersOnly() };
  return { identity };
}
