import { NextResponse } from 'next/server';

type CreativeVideoRequest = {
  summary?: string;
  script?: {
    hook?: string;
    body?: string;
    cta?: string;
    voiceover?: string;
    shots?: Array<{
      tStart?: number;
      tEnd?: number;
      visual?: string;
      overlayText?: string;
      camera?: string;
    }>;
  };
  provider?: 'mock' | 'sora';
  durationSec?: number;
  segmentPrompt?: string;
  voiceoverText?: string;
  voiceGender?: 'female' | 'male';
  referenceImages?: Array<{
    dataUrl?: string;
    name?: string;
    mimeType?: string;
  }>;
  aspectRatio?: '16:9';
  resolution?: '720p';
  language?: 'zh-TW' | 'zh-CN';
};

type JobStatus = 'queued' | 'processing' | 'done' | 'error';

type CreativeVideoJob = {
  id: string;
  status: JobStatus;
  provider: 'mock' | 'sora';
  providerJobId?: string;
  createdAt: number;
  updatedAt: number;
  request: CreativeVideoRequest;
  result?: {
    renderPrompt: string;
    recommendedTools: string[];
    videoUrl: string | null;
    audioUrl?: string | null;
    thumbnailUrl: string | null;
    exportSpec: {
      aspectRatio: '16:9';
      resolution: '720p';
      width: 1280;
      height: 720;
      durationSec: number;
      fps: 24;
    };
  };
  error?: string;
};

const jobs = new Map<string, CreativeVideoJob>();

const OPENAI_VIDEO_MODEL = process.env.OPENAI_VIDEO_MODEL || 'sora-2';
const OPENAI_VIDEO_MODEL_FALLBACKS = [
  'sora-2',
  'sora-2-pro',
  'sora-2-pro-2025-10-06',
  'sora-2-2025-10-06',
  'sora-2-2025-12-08',
];
const TTS_VOICE_MAP: Record<'female' | 'male', string> = {
  female: 'nova',
  male: 'onyx',
};

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeReferenceImages(referenceImages?: CreativeVideoRequest['referenceImages']): string[] {
  return (referenceImages || [])
    .map((image) => image?.dataUrl?.trim() || '')
    .filter((dataUrl) => /^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl));
}

async function createSoraVideoTask(prompt: string, durationSec: number): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const normalizedDuration = Math.min(Math.max(durationSec, 4), 12);
  const soraSeconds: '4' | '8' | '12' = normalizedDuration <= 6 ? '4' : normalizedDuration <= 9 ? '8' : '12';
  const configuredModel = (OPENAI_VIDEO_MODEL || '').trim();
  const modelCandidates = Array.from(new Set([configuredModel, ...OPENAI_VIDEO_MODEL_FALLBACKS].filter(Boolean)));
  const requestCandidates: Array<{ endpoint: string; payload: Record<string, unknown> }> = [];

  for (const model of modelCandidates) {
    requestCandidates.push(
      {
        endpoint: 'https://api.openai.com/v1/videos',
        payload: { model, prompt, seconds: soraSeconds },
      },
      {
        endpoint: 'https://api.openai.com/v1/videos',
        payload: { model, prompt, seconds: Number(soraSeconds) },
      },
    );
  }

  const errors: string[] = [];
  for (const candidate of requestCandidates) {
    const response = await fetch(candidate.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(candidate.payload),
    });

    const raw = await response.text();
    let data: any = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { raw };
    }

    if (!response.ok) {
      const reason = data?.error?.message || data?.message || JSON.stringify(data);
      errors.push(`${candidate.endpoint} payload=${JSON.stringify(candidate.payload)} -> ${response.status}: ${reason}`);
      continue;
    }

    const taskId = data?.id || data?.request_id || data?.data?.id || data?.job_id;
    if (taskId) return String(taskId);
    errors.push(`${candidate.endpoint} payload=${JSON.stringify(candidate.payload)} -> 200 but missing task id`);
  }

  throw new Error(`Creative Studio Sora API error: ${errors.slice(0, 3).join(' | ')}`);
}

async function getSoraVideoTask(taskId: string): Promise<{ status: JobStatus; videoUrl: string | null; error?: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const endpointCandidates = [
    `https://api.openai.com/v1/video/generations/${encodeURIComponent(taskId)}`,
    `https://api.openai.com/v1/videos/${encodeURIComponent(taskId)}`,
    `https://api.openai.com/v1/videos/generations/${encodeURIComponent(taskId)}`,
  ];

  const errors: string[] = [];
  for (const endpoint of endpointCandidates) {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const raw = await response.text();
    let data: any = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }

    if (!response.ok) {
      const reason = data?.error?.message || data?.message || `status=${response.status}`;
      errors.push(`${endpoint} -> ${reason}`);
      continue;
    }

    const statusRaw = String(data?.status || data?.state || '').toLowerCase();
    const status: JobStatus = ['succeeded', 'completed', 'done'].includes(statusRaw)
      ? 'done'
      : ['failed', 'error', 'cancelled'].includes(statusRaw)
        ? 'error'
        : 'processing';

    const videoUrl = status === 'done'
      ? `/api/creative-studio/video-content?videoId=${encodeURIComponent(taskId)}`
      : null;

    return {
      status,
      videoUrl,
      error: status === 'error' ? (data?.error?.message || data?.message || 'Creative Studio Sora generation failed') : undefined,
    };
  }

  return {
    status: 'error',
    videoUrl: null,
    error: `Creative Studio Sora status check failed. ${errors.slice(0, 3).join(' | ')}`,
  };
}

async function generateTTS(text: string, voiceGender: CreativeVideoRequest['voiceGender'] = 'female'): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const voice = TTS_VOICE_MAP[voiceGender || 'female'] || TTS_VOICE_MAP.female;
  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1-hd',
        input: text,
        voice,
        response_format: 'mp3',
      }),
    });

    if (!response.ok) {
      console.error('[creative-studio/TTS] Error:', await response.text());
      return null;
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return `data:audio/mp3;base64,${base64}`;
  } catch (error) {
    console.error('[creative-studio/TTS] Exception:', error);
    return null;
  }
}

function buildRenderPrompt(payload: CreativeVideoRequest): string {
  const summary = payload.summary?.trim() || '';
  const script = payload.script;
  const durationSec = Math.min(Math.max(payload.durationSec || 10, 8), 15);
  const hook = script?.hook?.trim() || '';
  const body = script?.body?.trim() || '';
  const cta = script?.cta?.trim() || '';
  const voiceover = script?.voiceover?.trim() || '';
  const referenceImages = normalizeReferenceImages(payload.referenceImages);
  const language = payload.language || 'zh-TW';
  const imageNames = (payload.referenceImages || [])
    .map((image) => image?.name?.trim())
    .filter(Boolean)
    .join(', ');

  const shotsText = (script?.shots || [])
    .map((shot, index) => {
      const start = typeof shot.tStart === 'number' ? shot.tStart : 0;
      const end = typeof shot.tEnd === 'number' ? shot.tEnd : 0;
      const visual = shot.visual || 'clean cinematic visual';
      const overlay = shot.overlayText || '';
      const camera = shot.camera || 'steady';
      return `Shot ${index + 1} (${start}s-${end}s): ${visual}; camera=${camera}; overlay='${overlay}'`;
    })
    .join('\n');

  const subtitleLines = (script?.shots || [])
    .map((shot) => String(shot.overlayText || '').trim())
    .filter(Boolean)
    .slice(0, 6);

  const subtitleBlock = subtitleLines.length > 0
    ? subtitleLines.map((line, idx) => `${idx + 1}. ${line}`).join('\n')
    : '';

  return [
    `Create a cinematic ${durationSec}-second Chinese creative promo video.`,
    'Output style: polished, cinematic, visually consistent with the uploaded reference photos.',
    `Format: 16:9, 1280x720, 24fps, duration ${durationSec}s.`,
    `Language default: ${language}. All on-screen text and narration must be Chinese.`,
    'Burn in readable Chinese subtitles on the video (hard subtitles), centered near bottom within title-safe area.',
    `Hook: ${hook}`,
    `Body: ${body}`,
    `CTA: ${cta}`,
    `Voiceover (${language}): ${voiceover}`,
    summary ? `Summary context: ${summary}` : '',
    referenceImages.length > 0
      ? `Reference images provided: ${referenceImages.length}. Preserve visual identity, subjects, and lighting mood.`
      : '',
    imageNames ? `Reference image names: ${imageNames}` : '',
    subtitleBlock ? `Subtitle lines (Chinese, in order):\n${subtitleBlock}` : '',
    shotsText ? `Storyboard:\n${shotsText}` : '',
    `Important: target total runtime must be ${durationSec} seconds (not shorter than ${Math.max(durationSec - 1, 8)}s).`,
  ]
    .filter(Boolean)
    .join('\n');
}

function enqueueMockRender(job: CreativeVideoJob): void {
  setTimeout(() => {
    const current = jobs.get(job.id);
    if (!current) return;
    current.status = 'processing';
    current.updatedAt = Date.now();
    jobs.set(job.id, current);
  }, 300);

  setTimeout(() => {
    const current = jobs.get(job.id);
    if (!current) return;

    const durationSec = current.request.durationSec || 10;
    current.status = 'done';
    current.updatedAt = Date.now();
    current.result = {
      renderPrompt: buildRenderPrompt(current.request),
      recommendedTools: ['Sora API'],
      videoUrl: null,
      audioUrl: current.result?.audioUrl || null,
      thumbnailUrl: null,
      exportSpec: {
        aspectRatio: '16:9',
        resolution: '720p',
        width: 1280,
        height: 720,
        durationSec,
        fps: 24,
      },
    };
    jobs.set(job.id, current);
  }, 1400);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreativeVideoRequest;
    const envProvider = process.env.CREATIVE_STUDIO_VIDEO_PROVIDER as 'mock' | 'sora' | undefined;
    const requestedProvider = body.provider || envProvider;
    const provider: 'mock' | 'sora' = process.env.OPENAI_API_KEY && requestedProvider !== 'mock' ? 'sora' : (requestedProvider || (process.env.OPENAI_API_KEY ? 'sora' : 'mock'));

    if (provider === 'sora' && !body.segmentPrompt) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', message: 'Creative Studio 的 Sora 生成需提供 visualPrompt。' },
        { status: 400 },
      );
    }

    if (!body.script && !body.summary && !body.segmentPrompt) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', message: '請至少提供 summary、draft script 或 visualPrompt。' },
        { status: 400 },
      );
    }

    const durationSec = body.durationSec || 10;
    if (durationSec < 8 || durationSec > 15) {
      return NextResponse.json(
        { error: 'INVALID_DURATION', message: 'durationSec 需介於 8 到 15 秒。' },
        { status: 400 },
      );
    }

    const soraDurationSec: 8 | 12 = durationSec <= 9 ? 8 : 12;

    const id = makeId();
    const now = Date.now();
    const job: CreativeVideoJob = {
      id,
      status: 'queued',
      provider,
      createdAt: now,
      updatedAt: now,
      request: {
        ...body,
        aspectRatio: '16:9',
        resolution: '720p',
        language: body.language || 'zh-TW',
        durationSec: soraDurationSec,
      },
    };

    jobs.set(id, job);

    if (provider === 'sora') {
      const prompt = [body.segmentPrompt?.trim() || '', buildRenderPrompt(job.request)].filter(Boolean).join('\n\n');
      const providerJobId = await createSoraVideoTask(prompt, soraDurationSec);
      job.providerJobId = providerJobId;
      job.status = 'processing';
      job.updatedAt = Date.now();
      job.result = {
        renderPrompt: prompt,
        recommendedTools: ['Sora API'],
        videoUrl: null,
        audioUrl: body.voiceoverText ? await generateTTS(body.voiceoverText, body.voiceGender) : null,
        thumbnailUrl: null,
        exportSpec: {
          aspectRatio: '16:9',
          resolution: '720p',
          width: 1280,
          height: 720,
          durationSec: soraDurationSec,
          fps: 24,
        },
      };
      jobs.set(id, job);
    } else {
      job.result = {
        renderPrompt: buildRenderPrompt(job.request),
        recommendedTools: ['Sora API'],
        videoUrl: null,
        audioUrl: body.voiceoverText ? await generateTTS(body.voiceoverText, body.voiceGender) : null,
        thumbnailUrl: null,
        exportSpec: {
          aspectRatio: '16:9',
          resolution: '720p',
          width: 1280,
          height: 720,
          durationSec: soraDurationSec,
          fps: 24,
        },
      };
      jobs.set(id, job);
      enqueueMockRender(job);
    }

    return NextResponse.json({
      success: true,
      jobId: id,
      status: job.status,
      provider,
      pollUrl: `/api/creative-studio/video?jobId=${id}`,
    });
  } catch (error) {
    console.error('[creative-studio/video] POST Error:', error);
    return NextResponse.json(
      {
        error: 'CREATIVE_VIDEO_CREATE_FAILED',
        message: error instanceof Error ? error.message : '建立 Creative Studio 影片任務失敗',
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId') || '';
    if (!jobId) {
      return NextResponse.json(
        { error: 'MISSING_JOB_ID', message: '請提供 jobId。' },
        { status: 400 },
      );
    }

    const job = jobs.get(jobId);
    if (!job) {
      return NextResponse.json(
        { error: 'JOB_NOT_FOUND', message: '找不到 Creative Studio 對應的影片任務。' },
        { status: 404 },
      );
    }

    if (job.provider === 'sora' && job.providerJobId && job.status !== 'done' && job.status !== 'error') {
      const sora = await getSoraVideoTask(job.providerJobId);
      job.status = sora.status;
      job.updatedAt = Date.now();
      if (job.result) job.result.videoUrl = sora.videoUrl;
      if (sora.status === 'error') job.error = sora.error || 'Creative Studio Sora generation failed';
      jobs.set(job.id, job);
    }

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: job.status,
      provider: job.provider,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      result: job.result || null,
      error: job.error || null,
    });
  } catch (error) {
    console.error('[creative-studio/video] GET Error:', error);
    return NextResponse.json(
      {
        error: 'CREATIVE_VIDEO_STATUS_FAILED',
        message: error instanceof Error ? error.message : '查詢 Creative Studio 影片任務失敗',
      },
      { status: 500 },
    );
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;