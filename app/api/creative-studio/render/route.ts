import { NextResponse } from 'next/server';

type ReferenceImageInput = {
  dataUrl?: string;
  name?: string;
  mimeType?: string;
};

type PromoShot = {
  tStart: number;
  tEnd: number;
  visual: string;
  overlayText: string;
  camera: string;
};

type SubtitleLine = {
  text: string;
  start: number;
  end: number;
};

type CreativeDraftPayload = {
  hook: string;
  body: string;
  cta: string;
  voiceover: string;
  visualPrompt: string;
  subtitleLines: SubtitleLine[];
  shots: PromoShot[];
};

type CreativeRenderRequest = {
  summary?: string;
  draft?: CreativeDraftPayload;
  durationSec?: number;
  aspectRatio?: '16:9';
  resolution?: '720p';
  voiceGender?: 'female' | 'male';
  language?: 'zh-TW' | 'zh-CN';
  referenceImages?: ReferenceImageInput[];
};

function buildInternalUrl(request: Request, pathname: string): string {
  const url = new URL(request.url);
  return `${url.origin}${pathname}`;
}

function normalizeReferenceImages(referenceImages?: ReferenceImageInput[]): ReferenceImageInput[] {
  return (referenceImages || [])
    .filter((image) => /^data:image\/(png|jpe?g|webp);base64,/i.test(image?.dataUrl || ''))
    .slice(0, 3);
}

function resolveProvider(): 'sora' | 'mock' {
  if (process.env.OPENAI_API_KEY) return 'sora';
  return 'mock';
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreativeRenderRequest;
    const draft = body.draft;
    const summary = String(body.summary || '').trim();
    const referenceImages = normalizeReferenceImages(body.referenceImages);
    const durationSec = Math.min(Math.max(body.durationSec || 10, 8), 15);

    if (!draft) {
      return NextResponse.json(
        { error: 'INVALID_DRAFT', message: '請先生成並確認創作草稿。' },
        { status: 400 },
      );
    }

    const provider = resolveProvider();
    const endpoint = buildInternalUrl(request, '/api/creative-studio/video');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        summary,
        script: {
          hook: draft.hook,
          body: draft.body,
          cta: draft.cta,
          voiceover: draft.voiceover,
          shots: draft.shots,
        },
        durationSec,
        aspectRatio: body.aspectRatio || '16:9',
        resolution: body.resolution || '720p',
        language: body.language || 'zh-TW',
        segmentPrompt: draft.visualPrompt,
        voiceoverText: draft.voiceover,
        voiceGender: body.voiceGender || 'female',
        referenceImages,
      }),
      cache: 'no-store',
    });

    const data = await response.json().catch(() => ({}));
    return NextResponse.json(
      {
        ...data,
        provider,
        pollUrl: data?.jobId ? `/api/creative-studio/render?jobId=${encodeURIComponent(String(data.jobId))}` : null,
      },
      { status: response.status },
    );
  } catch (error) {
    console.error('[creative-studio/render] POST Error:', error);
    return NextResponse.json(
      {
        error: 'CREATIVE_RENDER_CREATE_FAILED',
        message: error instanceof Error ? error.message : '建立創作影片任務失敗',
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const jobId = url.searchParams.get('jobId') || '';
    if (!jobId) {
      return NextResponse.json(
        { error: 'MISSING_JOB_ID', message: '請提供 jobId。' },
        { status: 400 },
      );
    }

    const endpoint = buildInternalUrl(request, `/api/creative-studio/video?jobId=${encodeURIComponent(jobId)}`);
    const response = await fetch(endpoint, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[creative-studio/render] GET Error:', error);
    return NextResponse.json(
      {
        error: 'CREATIVE_RENDER_STATUS_FAILED',
        message: error instanceof Error ? error.message : '查詢創作影片任務失敗',
      },
      { status: 500 },
    );
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;