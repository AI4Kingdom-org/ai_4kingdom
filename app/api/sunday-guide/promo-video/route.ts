import { NextResponse } from 'next/server';

type PromoVideoRequest = {
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
  provider?: 'mock' | 'runway' | 'luma' | 'sora' | 'openai';
  durationSec?: number;
  segmentIndex?: number;
  segmentPrompt?: string;
  voiceoverText?: string;
  aspectRatio?: '16:9';
  resolution?: '720p';
};

type JobStatus = 'queued' | 'processing' | 'done' | 'error';

type PromoVideoJob = {
  id: string;
  status: JobStatus;
  provider: 'mock' | 'runway' | 'luma' | 'sora' | 'openai';
  providerJobId?: string;
  segmentIndex?: number;
  createdAt: number;
  updatedAt: number;
  request: PromoVideoRequest;
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

const jobs = new Map<string, PromoVideoJob>();

const RUNWAY_API_BASE = (process.env.RUNWAY_API_BASE || 'https://api.dev.runwayml.com').replace(/\/$/, '');
const RUNWAY_API_VERSION = process.env.RUNWAY_API_VERSION || '2024-11-06';
const RUNWAY_MODEL = process.env.RUNWAY_MODEL || 'gen4_turbo';
const OPENAI_VIDEO_MODEL = process.env.OPENAI_VIDEO_MODEL || 'sora-2';
const OPENAI_VIDEO_MODEL_FALLBACKS = [
  'sora-2',
  'sora-2-pro',
  'sora-2-pro-2025-10-06',
  'sora-2-2025-10-06',
  'sora-2-2025-12-08',
];
const DEFAULT_PROMPT_IMAGE_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X8W0AAAAASUVORK5CYII=';

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---- Sora/OpenAI Video Generation ----
async function createSoraVideoTask(soraPrompt: string, durationSec: number): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const normalizedDuration = Math.min(Math.max(durationSec, 8), 60);
  const configuredModel = (OPENAI_VIDEO_MODEL || '').trim();
  const modelCandidates = Array.from(new Set([configuredModel, ...OPENAI_VIDEO_MODEL_FALLBACKS].filter(Boolean)));

  const parseSupportedModels = (reason: string): string[] => {
    const marker = 'Supported values are:';
    const idx = reason.indexOf(marker);
    if (idx === -1) return [];
    const tail = reason.slice(idx + marker.length).trim();
    return tail
      .split(',')
      .map((s) => s.replace(/['.]/g, '').trim())
      .filter((s) => s.startsWith('sora-'));
  };
  // OpenAI video endpoints/payload schema may vary by account rollout.
  // Try endpoint+payload combinations from most likely to least likely.
  const requestCandidates: Array<{ endpoint: string; payload: Record<string, unknown> }> = [];
  for (const model of modelCandidates) {
    requestCandidates.push(
      {
        endpoint: 'https://api.openai.com/v1/videos',
        payload: {
          model,
          prompt: soraPrompt,
        },
      },
      {
        endpoint: 'https://api.openai.com/v1/videos',
        payload: {
          model,
          prompt: soraPrompt,
          seconds: normalizedDuration,
        },
      },
    );
  }

  const errors: string[] = [];

  for (const candidate of requestCandidates) {
    const client = await fetch(candidate.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(candidate.payload),
    });

    const raw = await client.text();
    let data: any = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { raw };
    }

    if (!client.ok) {
      const reason = data?.error?.message || data?.message || JSON.stringify(data);
      errors.push(`${candidate.endpoint} payload=${JSON.stringify(candidate.payload)} -> ${client.status}: ${reason}`);

      // If API explicitly returns supported model list, prioritize retrying with those models.
      const supported = parseSupportedModels(String(reason));
      if (supported.length > 0) {
        for (const supportedModel of supported) {
          const alreadyTried = requestCandidates.some((c) => c.payload.model === supportedModel);
          if (!alreadyTried) {
            requestCandidates.push(
              {
                endpoint: 'https://api.openai.com/v1/videos',
                payload: { model: supportedModel, prompt: soraPrompt },
              },
              {
                endpoint: 'https://api.openai.com/v1/videos',
                payload: { model: supportedModel, prompt: soraPrompt, seconds: normalizedDuration },
              },
            );
          }
        }
      }
      continue;
    }

    const taskId = data?.id || data?.request_id || data?.data?.id || data?.job_id;
    if (taskId) return String(taskId);

    errors.push(`${candidate.endpoint} payload=${JSON.stringify(candidate.payload)} -> 200 but missing task id`);
  }

  throw new Error(
    `Sora API error: could not create video task. model=${OPENAI_VIDEO_MODEL}. ${errors.slice(0, 3).join(' | ')}`,
  );
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
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const raw = await res.text();
    let data: any = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }

    if (!res.ok) {
      const reason = data?.error?.message || data?.message || `status=${res.status}`;
      errors.push(`${endpoint} -> ${reason}`);
      continue;
    }

    const statusRaw = data?.status || data?.state || '';
    let status: JobStatus = 'processing';
    if (['succeeded', 'completed', 'done'].includes(String(statusRaw).toLowerCase())) status = 'done';
    if (['failed', 'error', 'cancelled'].includes(String(statusRaw).toLowerCase())) status = 'error';

    // OpenAI /videos/{id} returns job metadata. The actual MP4 must be fetched from /videos/{id}/content.
    const videoUrl =
      status === 'done'
        ? `/api/sunday-guide/promo-video-content?videoId=${encodeURIComponent(taskId)}`
        : null;

    return {
      status,
      videoUrl,
      error: status === 'error' ? (data?.error?.message || data?.message || 'Sora generation failed') : undefined,
    };
  }

  return {
    status: 'error',
    videoUrl: null,
    error: `Sora status check failed. ${errors.slice(0, 3).join(' | ')}`,
  };
}

// ---- TTS (Text-to-Speech) ----
async function generateTTS(text: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

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
        voice: 'nova',
        response_format: 'mp3',
      }),
    });

    if (!response.ok) {
      console.error('[TTS] Error:', await response.text());
      return null;
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return `data:audio/mp3;base64,${base64}`;
  } catch (error) {
    console.error('[TTS] Exception:', error);
    return null;
  }
}

function buildRenderPrompt(payload: PromoVideoRequest): string {
  const summary = payload.summary?.trim() || '';
  const script = payload.script;
  const hook = script?.hook?.trim() || '';
  const body = script?.body?.trim() || '';
  const cta = script?.cta?.trim() || '';
  const voiceover = script?.voiceover?.trim() || '';

  const shotsText = (script?.shots || [])
    .map((s, i) => {
      const start = typeof s.tStart === 'number' ? s.tStart : 0;
      const end = typeof s.tEnd === 'number' ? s.tEnd : 0;
      const visual = s.visual || 'clean cinematic church visual';
      const overlay = s.overlayText || '';
      const camera = s.camera || 'steady';
      return `Shot ${i + 1} (${start}s-${end}s): ${visual}; camera=${camera}; overlay='${overlay}'`;
    })
    .join('\n');

  return [
    'Create a cinematic 5-second Christian sermon promo video.',
    'Output style: modern inspirational, high contrast, warm highlights, subtle particles.',
    'Format: 16:9, 1280x720, 24fps, duration 5s.',
    `Hook: ${hook}`,
    `Body: ${body}`,
    `CTA: ${cta}`,
    `Voiceover (zh-TW/zh-CN): ${voiceover}`,
    summary ? `Summary context: ${summary}` : '',
    shotsText ? `Storyboard:\n${shotsText}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function mapRunwayStatus(statusRaw: string | undefined): JobStatus {
  const status = (statusRaw || '').toUpperCase();
  if (['SUCCEEDED', 'COMPLETED', 'DONE'].includes(status)) return 'done';
  if (['FAILED', 'ERROR', 'CANCELLED', 'CANCELED'].includes(status)) return 'error';
  if (['PENDING', 'RUNNING', 'IN_PROGRESS', 'PROCESSING', 'QUEUED', 'STARTED'].includes(status)) {
    return 'processing';
  }
  return 'processing';
}

function tryExtractVideoUrl(taskData: any): string | null {
  const output = taskData?.output;
  if (typeof taskData?.video_url === 'string') return taskData.video_url;
  if (typeof taskData?.videoUrl === 'string') return taskData.videoUrl;
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0];
    if (typeof first === 'string') return first;
    if (typeof first?.url === 'string') return first.url;
    if (typeof first?.video_url === 'string') return first.video_url;
  }
  if (typeof output?.url === 'string') return output.url;
  if (typeof output?.video_url === 'string') return output.video_url;
  if (typeof output?.videoUrl === 'string') return output.videoUrl;
  return null;
}

async function createRunwayTask(renderPrompt: string, durationSec: number): Promise<string> {
  const apiKey = process.env.RUNWAY_API_KEY;
  if (!apiKey) throw new Error('RUNWAY_API_KEY is not set');

  let modelCandidates = Array.from(new Set([
    RUNWAY_MODEL,
    'gen4_turbo',
    'gen4',
    'gen3a_turbo',
    'gen3a',
  ].filter(Boolean)));

  // Try discovering enabled models from Runway API to avoid entitlement mismatch.
  try {
    const modelRes = await fetch(`${RUNWAY_API_BASE}/v1/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Runway-Version': RUNWAY_API_VERSION,
      },
    });
    const modelRaw = await modelRes.text();
    let modelData: any = {};
    try { modelData = modelRaw ? JSON.parse(modelRaw) : {}; } catch { modelData = {}; }
    const list = Array.isArray(modelData)
      ? modelData
      : Array.isArray(modelData?.data)
        ? modelData.data
        : [];
    const discovered = list
      .map((m: any) => String(m?.id || m?.name || '').trim())
      .filter(Boolean);
    if (discovered.length > 0) {
      modelCandidates = Array.from(new Set([...discovered, ...modelCandidates]));
    }
  } catch {
    // Ignore discovery failure; fallback candidates still apply.
  }

  const errorLogs: string[] = [];

  for (const model of modelCandidates) {
    const imagePayloadVariants = [
      {
        model,
        promptImage: DEFAULT_PROMPT_IMAGE_DATA_URI,
        promptText: renderPrompt,
        ratio: '1280:720',
        duration: durationSec,
      },
      {
        model,
        promptImage: [{ uri: DEFAULT_PROMPT_IMAGE_DATA_URI, position: 'first' }],
        promptText: renderPrompt,
        ratio: '1280:720',
        duration: durationSec,
      },
    ];

    for (const payload of imagePayloadVariants) {
      const res = await fetch(`${RUNWAY_API_BASE}/v1/image_to_video`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Runway-Version': RUNWAY_API_VERSION,
        },
        body: JSON.stringify(payload),
      });

      const raw = await res.text();
      let data: any = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }

      if (res.ok) {
        const taskId = data?.id || data?.taskId || data?.uuid;
        if (taskId) return String(taskId);
        errorLogs.push(`model=${model} payloadKeys=${Object.keys(payload).join(',')} => missing task id`);
        continue;
      }

      const reason = data?.error || data?.message || data?.details || JSON.stringify(data);
      if (String(reason).toLowerCase().includes('not have enough credits')) {
        throw new Error(`Runway credits insufficient: ${reason}`);
      }
      errorLogs.push(`model=${model} payload=${JSON.stringify(payload)} status=${res.status} reason=${reason}`);
    }
  }

  throw new Error(`Runway create task failed. ${errorLogs.slice(0, 3).join(' | ')}`);
}

async function getRunwayTask(taskId: string): Promise<{ status: JobStatus; videoUrl: string | null; error?: string }> {
  const apiKey = process.env.RUNWAY_API_KEY;
  if (!apiKey) throw new Error('RUNWAY_API_KEY is not set');

  const res = await fetch(`${RUNWAY_API_BASE}/v1/tasks/${encodeURIComponent(taskId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-Runway-Version': RUNWAY_API_VERSION,
    },
  });

  const raw = await res.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }

  if (!res.ok) {
    return {
      status: 'error',
      videoUrl: null,
      error: data?.error || data?.message || `Runway task status failed (${res.status})`,
    };
  }

  const status = mapRunwayStatus(data?.status || data?.state);
  return {
    status,
    videoUrl: tryExtractVideoUrl(data),
    error: status === 'error' ? (data?.error || data?.message || 'Runway task failed') : undefined,
  };
}

function enqueueMockRender(job: PromoVideoJob): void {
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

    const durationSec = current.request.durationSec || 5;
    current.status = 'done';
    current.updatedAt = Date.now();
    current.result = {
      renderPrompt: buildRenderPrompt(current.request),
      recommendedTools: ['Runway Gen-3 API', 'Luma Dream Machine API', 'Pika API'],
      videoUrl: null,
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
    const body = (await request.json()) as PromoVideoRequest;
    const envProvider = process.env.PROMO_VIDEO_PROVIDER as 'mock' | 'runway' | 'luma' | 'sora' | 'openai' | undefined;
    const provider = body.provider || envProvider || 'mock';

    if (provider === 'sora' && !body.segmentPrompt) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', message: '提供 Sora 生成須指定 segmentPrompt。' },
        { status: 400 },
      );
    }

    if (!body.script && !body.summary && !body.segmentPrompt) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', message: '請至少提供 summary、script 或 segmentPrompt。' },
        { status: 400 },
      );
    }

    const durationSec = body.durationSec || 8;
    if (durationSec < 8 || durationSec > 15) {
      return NextResponse.json(
        { error: 'INVALID_DURATION', message: 'durationSec 需介於 8 到 15 秒。' },
        { status: 400 },
      );
    }

    const id = makeId();
    const now = Date.now();
    const job: PromoVideoJob = {
      id,
      status: 'queued',
      provider,
      segmentIndex: body.segmentIndex,
      createdAt: now,
      updatedAt: now,
      request: {
        ...body,
        aspectRatio: '16:9',
        resolution: '720p',
        durationSec,
      },
    };

    jobs.set(id, job);

    if (provider === 'sora' || provider === 'openai') {
      const soraPrompt = body.segmentPrompt || buildRenderPrompt(job.request);
      const providerJobId = await createSoraVideoTask(soraPrompt, durationSec);
      job.providerJobId = providerJobId;
      job.status = 'processing';
      job.updatedAt = Date.now();
      job.result = {
        renderPrompt: soraPrompt,
        recommendedTools: ['Sora API'],
        videoUrl: null,
        audioUrl: body.voiceoverText ? await generateTTS(body.voiceoverText) : null,
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
      jobs.set(id, job);
    } else if (provider === 'runway') {
      const renderPrompt = buildRenderPrompt(job.request);
      const providerJobId = await createRunwayTask(renderPrompt, durationSec);
      job.providerJobId = providerJobId;
      job.status = 'processing';
      job.updatedAt = Date.now();
      job.result = {
        renderPrompt,
        recommendedTools: ['Runway Gen-3 API'],
        videoUrl: null,
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
      jobs.set(id, job);
    } else {
      // Luma not wired yet in this patch; keep skeleton behavior for local flow.
      enqueueMockRender(job);
    }

    return NextResponse.json({
      success: true,
      jobId: id,
      status: job.status,
      provider,
      pollUrl: `/api/sunday-guide/promo-video?jobId=${id}`,
    });
  } catch (error) {
    console.error('[promo-video] POST Error:', error);
    return NextResponse.json(
      {
        error: 'PROMO_VIDEO_CREATE_FAILED',
        message: error instanceof Error ? error.message : '建立影片任務失敗',
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
        { error: 'JOB_NOT_FOUND', message: '找不到對應的影片任務。' },
        { status: 404 },
      );
    }

    if ((job.provider === 'sora' || job.provider === 'openai') && job.providerJobId && job.status !== 'done' && job.status !== 'error') {
      const sora = await getSoraVideoTask(job.providerJobId);
      job.status = sora.status;
      job.updatedAt = Date.now();
      if (job.result) {
        job.result.videoUrl = sora.videoUrl;
      }
      if (sora.status === 'error') {
        job.error = sora.error || 'Sora generation failed';
      }
      jobs.set(job.id, job);
    } else if (job.provider === 'runway' && job.providerJobId && job.status !== 'done' && job.status !== 'error') {
      const runway = await getRunwayTask(job.providerJobId);
      job.status = runway.status;
      job.updatedAt = Date.now();
      if (job.result) {
        job.result.videoUrl = runway.videoUrl;
      }
      if (runway.status === 'error') {
        job.error = runway.error || 'Runway generation failed';
      }
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
    console.error('[promo-video] GET Error:', error);
    return NextResponse.json(
      {
        error: 'PROMO_VIDEO_STATUS_FAILED',
        message: error instanceof Error ? error.message : '查詢影片任務失敗',
      },
      { status: 500 },
    );
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
