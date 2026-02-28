import { NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';

/**
 * POST /api/sunday-guide/youtube-transcript
 * 從 YouTube 影片抓取字幕（優先官方字幕，其次自動生成字幕）
 * 純 Node.js，Serverless 安全，不需要下載影片
 *
 * Body: { url: string, lang?: string }
 * Response: { transcript: string, source: 'caption', videoId: string, charCount: number }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url, lang, startTime, endTime } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: '请提供有效的 YouTube URL' },
        { status: 400 }
      );
    }

    // 從 URL 提取 videoId
    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: '无法识别 YouTube 影片 ID，请检查 URL 格式' },
        { status: 400 }
      );
    }

    console.log('[youtube-transcript] Fetching captions for:', videoId, 'lang:', lang || 'auto');

    // 嘗試抓取字幕
    let transcriptItems;
    try {
      const config: { lang?: string } = {};
      if (lang) config.lang = lang;

      transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, config);
    } catch (err: any) {
      const msg = err?.message || '';
      console.error('[youtube-transcript] Failed:', msg);

      // 常見錯誤分類
      if (msg.includes('disabled') || msg.includes('Transcript is disabled')) {
        return NextResponse.json(
          {
            error: 'NO_CAPTIONS',
            message: '此影片已停用字幕功能，无法获取字幕。请改为上传音频文件进行转录。',
          },
          { status: 404 }
        );
      }

      if (msg.includes('No transcript') || msg.includes('Could not')) {
        return NextResponse.json(
          {
            error: 'NO_CAPTIONS',
            message: '此影片没有可用字幕（官方或自动生成均无），请改为上传音频文件进行转录。',
          },
          { status: 404 }
        );
      }

      return NextResponse.json(
        {
          error: 'FETCH_FAILED',
          message: `获取字幕失败：${msg}`,
        },
        { status: 500 }
      );
    }

    if (!transcriptItems || transcriptItems.length === 0) {
      return NextResponse.json(
        {
          error: 'NO_CAPTIONS',
          message: '未取得任何字幕内容，请改为上传音频文件进行转录。',
        },
        { status: 404 }
      );
    }

    // 時段過濾
    const startSec = parseTimestamp(startTime);
    const endSec = parseTimestamp(endTime);
    let filtered = transcriptItems;
    if (startSec !== null || endSec !== null) {
      filtered = transcriptItems.filter((item) => {
        const offsetSec = (item.offset ?? 0) / 1000;
        if (startSec !== null && offsetSec < startSec) return false;
        if (endSec !== null && offsetSec >= endSec) return false;
        return true;
      });
      if (filtered.length === 0) {
        return NextResponse.json(
          { error: 'NO_CAPTIONS', message: `指定時段（${startTime || '00:00:00'} → ${endTime || '結尾'}）內沒有字幕內容。` },
          { status: 404 }
        );
      }
      console.log(`[youtube-transcript] Segment filter: ${startTime || '0'} → ${endTime || 'end'}, kept ${filtered.length}/${transcriptItems.length} segments`);
    }

    // 拼接成純文字段落
    const transcript = filtered
      .map((item) => item.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    console.log(
      '[youtube-transcript] Success. chars:',
      transcript.length,
      'segments:',
      transcriptItems.length
    );

    return NextResponse.json({
      transcript,
      source: 'caption',
      videoId,
      charCount: transcript.length,
    });
  } catch (error: any) {
    console.error('[youtube-transcript] Unexpected error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: error?.message || '服务器内部错误' },
      { status: 500 }
    );
  }
}

// ----- Helpers -----

function parseTimestamp(s?: string): number | null {
  if (!s?.trim()) return null;
  const parts = s.trim().split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

function extractVideoId(url: string): string | null {
  // 支援多種 YouTube URL 格式
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/, // 直接輸入 video ID
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}
