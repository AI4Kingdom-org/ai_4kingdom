import { NextResponse } from 'next/server';
import { issueGuestToken } from '@/app/lib/identity/server';

export const dynamic = 'force-dynamic';

/**
 * 簽發訪客 token。試用額度綁在 token 上（每台裝置一組，前端存 localStorage）。
 * 刻意不做限流：重複領取的濫用由 lib/credits 的「每 IP 每日上限」擋下。
 */
export async function POST() {
  const { token, id } = issueGuestToken();
  return NextResponse.json({ success: true, token, id }, { headers: { 'Cache-Control': 'no-store' } });
}
