import { NextResponse } from 'next/server';
import { getRequestIdentity, unauthorized } from '@/app/lib/identity/server';
import { getCreditStatus } from '@/app/lib/credits';

export const dynamic = 'force-dynamic';

/** 目前身分（會員或訪客）的額度狀態，供 CreditContext 顯示。 */
export async function GET(request: Request) {
  const identity = getRequestIdentity(request);
  if (!identity) return unauthorized();

  try {
    const status = await getCreditStatus(identity);
    return NextResponse.json({ success: true, ...status }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[credits/me] 讀取額度失敗:', error);
    return NextResponse.json({ success: false, error: '無法讀取額度' }, { status: 500 });
  }
}
