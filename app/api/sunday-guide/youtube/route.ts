// 此路由已被以下路由取代，不再使用 python-shell：
// - /api/sunday-guide/youtube-transcript （字幕擷取）
// - /api/sunday-guide/youtube-audio      （音源下載 + Whisper 轉錄）
import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error: 'DEPRECATED',
      message: '此路由已停用。請使用 /api/sunday-guide/youtube-transcript 或 /api/sunday-guide/youtube-audio。',
    },
    { status: 410 }
  );
}

export const dynamic = 'force-dynamic';
