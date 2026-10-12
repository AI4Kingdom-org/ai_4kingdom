import { NextRequest, NextResponse } from 'next/server';
import { isAiToolsDesignatedManager } from '@/app/utils/aiToolsDirectory';
import { getRequestIdentity } from '@/app/lib/identity/server';

// 前台用来决定是否显示「AI 工具后台」按钮；访客或未登入一律回 false，不回错误
export async function GET(request: NextRequest) {
  try {
    const identity = getRequestIdentity(request);
    if (!identity || identity.kind !== 'member') {
      return NextResponse.json({ success: true, canManage: false });
    }
    const canManage = await isAiToolsDesignatedManager(identity.userId);
    return NextResponse.json({ success: true, canManage });
  } catch (error) {
    console.error('[AiToolsDirectory] Access check failed:', error);
    return NextResponse.json({ success: true, canManage: false });
  }
}
