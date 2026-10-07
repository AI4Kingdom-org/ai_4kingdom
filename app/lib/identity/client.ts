'use client';

/**
 * 前端身分：把會員 token 或訪客 token 自動帶到所有同源 /api/ 請求。
 *
 * 用 fetch 攔截而不是逐一改呼叫點：既有頁面有上百處 fetch('/api/...')，
 * 統一在這裡補標頭，伺服器端就能一律以 getRequestIdentity() 判定身分。
 *
 * - 會員 token 由 AuthContext 從 WP session 取得後呼叫 setMemberSession() 設定
 * - 沒有會員 token 時自動向 /api/identity/guest 領一組訪客 token（存 localStorage，一台裝置一組）
 */

const MEMBER_HEADER = 'x-a4k-auth';
const GUEST_HEADER = 'x-a4k-guest';
const GUEST_STORAGE_KEY = 'a4k_guest_identity';
const GUEST_ENDPOINT = '/api/identity/guest';
const AUTH_READY_TIMEOUT_MS = 10000;
const REFRESH_MARGIN_MS = 60000;

interface GuestIdentity { token: string; id: string }

let memberToken: string | null = null;
let memberTokenExp = 0;
let memberUserId: string | null = null;
let guest: GuestIdentity | null = null;
let guestRequest: Promise<GuestIdentity | null> | null = null;
let refresher: (() => Promise<void>) | null = null;
let installed = false;

let resolveAuthReady: () => void = () => {};
const authReady = new Promise<void>((resolve) => { resolveAuthReady = resolve; });

function decodeExp(token: string): number {
  try {
    const payload = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(payload)).exp || 0) * 1000;
  } catch {
    return 0;
  }
}

/** AuthContext 每次確認 session 後呼叫；未登入時傳 null。 */
export function setMemberSession(session: { token: string | null; userId: string | null }) {
  memberToken = session.token;
  memberTokenExp = session.token ? decodeExp(session.token) : 0;
  memberUserId = session.token ? session.userId : null;
  resolveAuthReady();
}

/** 會員 token 快到期時用來重新取得 session（AuthContext.checkAuth）。 */
export function registerSessionRefresher(fn: () => Promise<void>) {
  refresher = fn;
}

function readStoredGuest(): GuestIdentity | null {
  try {
    const raw = window.localStorage.getItem(GUEST_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.token && parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

async function ensureGuest(nativeFetch: typeof fetch): Promise<GuestIdentity | null> {
  if (guest) return guest;
  guest = readStoredGuest();
  if (guest) return guest;

  if (!guestRequest) {
    guestRequest = nativeFetch(GUEST_ENDPOINT, { method: 'POST' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.token || !data?.id) return null;
        guest = { token: data.token, id: data.id };
        try {
          window.localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(guest));
        } catch {
          // 無痕模式等情況存不進去，就只在本次瀏覽期間有效
        }
        return guest;
      })
      .catch(() => null)
      .finally(() => { guestRequest = null; });
  }
  return guestRequest;
}

async function waitForAuth() {
  await Promise.race([authReady, new Promise((r) => setTimeout(r, AUTH_READY_TIMEOUT_MS))]);
}

async function identityHeaders(nativeFetch: typeof fetch): Promise<Record<string, string>> {
  await waitForAuth();

  if (memberToken && memberTokenExp - Date.now() < REFRESH_MARGIN_MS && refresher) {
    await refresher().catch(() => {});
  }
  if (memberToken) return { [MEMBER_HEADER]: memberToken };

  const g = await ensureGuest(nativeFetch);
  return g ? { [GUEST_HEADER]: g.token } : {};
}

/** 目前身分的 id：會員為 WP userId，訪客為 guest_<hex>。對話紀錄等以此為 key。 */
export async function getIdentityId(): Promise<string | null> {
  await waitForAuth();
  if (memberToken && memberUserId) return memberUserId;
  const g = await ensureGuest(window.fetch);
  return g?.id ?? null;
}

function isOwnApiRequest(url: string): boolean {
  try {
    const u = new URL(url, window.location.href);
    return u.origin === window.location.origin && u.pathname.startsWith('/api/') && u.pathname !== GUEST_ENDPOINT;
  } catch {
    return false;
  }
}

/** 安裝一次即可；AuthProvider 掛載時呼叫。 */
export function installIdentityFetch() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isOwnApiRequest(url)) return nativeFetch(input, init);

    const extra = await identityHeaders(nativeFetch);
    if (input instanceof Request) {
      const headers = new Headers(input.headers);
      Object.entries(extra).forEach(([k, v]) => { if (!headers.has(k)) headers.set(k, v); });
      return nativeFetch(new Request(input, { headers }), init);
    }
    const headers = new Headers(init?.headers);
    Object.entries(extra).forEach(([k, v]) => { if (!headers.has(k)) headers.set(k, v); });
    return nativeFetch(input, { ...init, headers });
  };
}
