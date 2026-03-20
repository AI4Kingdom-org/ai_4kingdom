import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId') || '';
    const variant = searchParams.get('variant') || 'video';

    if (!videoId) {
      return NextResponse.json(
        { error: 'MISSING_VIDEO_ID', message: '請提供 videoId。' },
        { status: 400 },
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'MISSING_OPENAI_API_KEY', message: 'OPENAI_API_KEY 未設定。' },
        { status: 500 },
      );
    }

    const upstream = await fetch(
      `https://api.openai.com/v1/videos/${encodeURIComponent(videoId)}/content?variant=${encodeURIComponent(variant)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    if (!upstream.ok) {
      const raw = await upstream.text();
      let data: any = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { raw };
      }

      return NextResponse.json(
        {
          error: 'CREATIVE_VIDEO_CONTENT_FAILED',
          message: data?.error?.message || data?.message || `讀取 Creative Studio 影片內容失敗 (${upstream.status})`,
        },
        { status: upstream.status },
      );
    }

    const body = await upstream.arrayBuffer();
    const contentType = upstream.headers.get('content-type') || 'video/mp4';
    const contentLength = upstream.headers.get('content-length');

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=300',
        ...(contentLength ? { 'Content-Length': contentLength } : {}),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'CREATIVE_VIDEO_CONTENT_EXCEPTION',
        message: error instanceof Error ? error.message : '讀取 Creative Studio 影片內容失敗',
      },
      { status: 500 },
    );
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;