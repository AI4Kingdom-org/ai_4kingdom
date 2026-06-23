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

    // 嘗試抓取字幕：優先繁體中文 → 簡體中文 → 泛中文，最後才用 client 傳入的 lang 或預設語言
    // 重要：某些影片的中文字幕軌只覆蓋部分內容，預設軌才是完整的。
    // 因此在找到第一個有效字幕後，還會與預設軌比較，選用 segment 數量最多的（最完整的）。
    let transcriptItems;
    try {
      const langCandidates: Array<string | undefined> = ['zh-TW', 'zh-Hant', 'zh-Hans', 'zh'];
      if (lang && !langCandidates.includes(lang)) langCandidates.push(lang);

      type TranscriptItems = Awaited<ReturnType<typeof YoutubeTranscript.fetchTranscript>>;
      let bestItems: TranscriptItems | undefined;
      let lastErr: any;

      // 先嘗試中文語言候選
      for (const candidate of langCandidates) {
        try {
          const config: { lang?: string } = {};
          if (candidate) config.lang = candidate;
          const items = await YoutubeTranscript.fetchTranscript(videoId, config);
          if (items && items.length > 0) {
            if (!bestItems || items.length > bestItems.length) {
              bestItems = items;
            }
            console.log(`[youtube-transcript] Got ${items.length} segments with lang=${candidate}`);
            break; // 找到中文字幕，停止嘗試其他中文語言
          }
        } catch (e: any) {
          lastErr = e;
        }
      }

      // 一律也嘗試預設軌（無語言限制），比較哪個更完整
      try {
        const defaultItems = await YoutubeTranscript.fetchTranscript(videoId, {});
        if (defaultItems && defaultItems.length > 0) {
          console.log(`[youtube-transcript] Got ${defaultItems.length} segments with lang=default`);
          // 若預設軌 segment 數量多於中文軌 20% 以上，代表中文軌不完整，改用預設軌
          if (!bestItems || defaultItems.length > bestItems.length * 1.2) {
            console.log(`[youtube-transcript] Using default track (${defaultItems.length} segs > zh track ${bestItems?.length ?? 0} segs * 1.2)`);
            bestItems = defaultItems;
          }
        }
      } catch (e: any) {
        if (!bestItems) lastErr = e;
      }

      if (!bestItems) {
        throw lastErr ?? new Error('No transcript found for any language');
      }
      transcriptItems = bestItems;
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

    // 嘗試取得影片標題（oEmbed 公開端點，不需要 API Key）
    const videoTitle = await fetchVideoTitle(videoId);

    return NextResponse.json({
      transcript,
      source: 'caption',
      videoId,
      videoTitle: videoTitle ?? null,
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

async function fetchVideoTitle(videoId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.title === 'string' ? data.title : null;
  } catch {
    return null;
  }
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
