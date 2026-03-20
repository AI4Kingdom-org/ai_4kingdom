'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useCredit } from '../contexts/CreditContext';
import styles from './page.module.css';

type ToneOption = 'inspiring' | 'urgent' | 'warm' | 'cinematic';
type VoiceGender = 'female' | 'male';

type ReferenceImage = {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
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

type CreativeDraft = {
  hook: string;
  body: string;
  cta: string;
  voiceover: string;
  visualPrompt: string;
  subtitleLines: SubtitleLine[];
  shots: PromoShot[];
};

type RenderResult = {
  renderPrompt: string;
  recommendedTools: string[];
  videoUrl: string | null;
  audioUrl?: string | null;
  thumbnailUrl: string | null;
  exportSpec: {
    aspectRatio: string;
    resolution: string;
    width: number;
    height: number;
    durationSec: number;
    fps: number;
  };
};

const MAX_IMAGES = 3;
const MAX_SUMMARY_LENGTH = 300;

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('讀取圖片失敗'));
    reader.readAsDataURL(file);
  });
}

async function optimizeImage(file: File): Promise<ReferenceImage> {
  const rawDataUrl = await readFileAsDataUrl(file);
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('圖片解析失敗'));
  });
  image.src = rawDataUrl;
  await loaded;

  const maxDimension = 1280;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('無法建立圖片壓縮畫布');

  context.drawImage(image, 0, 0, width, height);
  const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const dataUrl = canvas.toDataURL(mimeType, 0.86);

  return {
    id: makeId(),
    name: file.name,
    dataUrl,
    mimeType,
  };
}

export default function CreativeStudioPage() {
  const { user } = useAuth();
  const { remainingCredits } = useCredit();
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [summary, setSummary] = useState('');
  const [tone, setTone] = useState<ToneOption>('inspiring');
  const [voiceGender, setVoiceGender] = useState<VoiceGender>('female');
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CreativeDraft | null>(null);
  const [renderCreating, setRenderCreating] = useState(false);
  const [renderPolling, setRenderPolling] = useState(false);
  const [renderStatus, setRenderStatus] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);

  const canGenerate = summary.trim().length >= 20 && referenceImages.length > 0;
  const subtitleCount = draft?.subtitleLines.length || 0;
  const remainingImageSlots = MAX_IMAGES - referenceImages.length;

  const helperText = useMemo(() => {
    if (remainingImageSlots <= 0) return '已達 3 張上限';
    return `還可加入 ${remainingImageSlots} 張參考圖`;
  }, [remainingImageSlots]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setRenderPolling(false);
  };

  const startPolling = (jobId: string) => {
    stopPolling();
    setRenderPolling(true);
    pollTimerRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/creative-studio/render?jobId=${encodeURIComponent(jobId)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setRenderStatus('error');
          setRenderError(data?.message || data?.error || '查詢創作任務失敗');
          stopPolling();
          return;
        }

        setRenderStatus(data?.status || 'processing');
        if (data?.status === 'done') {
          setRenderResult((data?.result || null) as RenderResult | null);
          stopPolling();
          return;
        }

        if (data?.status === 'error') {
          setRenderError(data?.error || '創作影片生成失敗');
          stopPolling();
        }
      } catch (error) {
        setRenderStatus('error');
        setRenderError(error instanceof Error ? error.message : '查詢創作任務失敗');
        stopPolling();
      }
    }, 2500);
  };

  const handleImageSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setImageError(null);
    const allowedFiles = files.slice(0, remainingImageSlots);
    if (allowedFiles.length < files.length) {
      setImageError(`最多只能上傳 ${MAX_IMAGES} 張圖片。`);
    }

    try {
      const nextImages = await Promise.all(
        allowedFiles.map(async (file) => {
          if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
            throw new Error(`${file.name} 不是支援的圖片格式`);
          }
          return optimizeImage(file);
        }),
      );
      setReferenceImages((current) => [...current, ...nextImages].slice(0, MAX_IMAGES));
    } catch (error) {
      setImageError(error instanceof Error ? error.message : '圖片處理失敗');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveImage = (id: string) => {
    setReferenceImages((current) => current.filter((image) => image.id !== id));
  };

  const handleDraftChange = (field: keyof Omit<CreativeDraft, 'subtitleLines' | 'shots'>, value: string) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  const handleSubtitleChange = (index: number, value: string) => {
    setDraft((current) => {
      if (!current) return current;
      const subtitleLines = current.subtitleLines.map((line, lineIndex) =>
        lineIndex === index ? { ...line, text: value } : line,
      );
      const shots = current.shots.map((shot, shotIndex) =>
        shotIndex === index ? { ...shot, overlayText: value } : shot,
      );
      return { ...current, subtitleLines, shots };
    });
  };

  const handleShotVisualChange = (index: number, value: string) => {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        shots: current.shots.map((shot, shotIndex) =>
          shotIndex === index ? { ...shot, visual: value } : shot,
        ),
      };
    });
  };

  const handleGenerateDraft = async () => {
    if (!canGenerate) return;

    setDraftLoading(true);
    setDraftError(null);
    setRenderError(null);
    setRenderResult(null);
    setRenderJobId(null);
    setRenderStatus(null);

    try {
      const response = await fetch('/api/creative-studio/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary,
          tone,
          durationSec: 10,
          language: 'zh-TW',
          aspectRatio: '16:9',
          resolution: '720p',
          voiceGender,
          referenceImages: referenceImages.map((image) => ({
            dataUrl: image.dataUrl,
            name: image.name,
            mimeType: image.mimeType,
          })),
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.draft) {
        throw new Error(data?.message || data?.error || `生成草稿失敗（${response.status}）`);
      }

      setDraft(data.draft as CreativeDraft);
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : '生成創作草稿失敗');
    } finally {
      setDraftLoading(false);
    }
  };

  const handleCreateRender = async () => {
    if (!draft) return;

    setRenderCreating(true);
    setRenderError(null);
    setRenderResult(null);
    setRenderStatus('queued');
    setRenderJobId(null);

    try {
      const response = await fetch('/api/creative-studio/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary,
          draft,
          durationSec: 10,
          language: 'zh-TW',
          aspectRatio: '16:9',
          resolution: '720p',
          voiceGender,
          referenceImages: referenceImages.map((image) => ({
            dataUrl: image.dataUrl,
            name: image.name,
            mimeType: image.mimeType,
          })),
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.jobId) {
        throw new Error(data?.message || data?.error || `建立創作任務失敗（${response.status}）`);
      }

      const jobId = String(data.jobId);
      setRenderJobId(jobId);
      setRenderStatus(String(data.status || 'queued'));
      startPolling(jobId);
    } catch (error) {
      setRenderStatus('error');
      setRenderError(error instanceof Error ? error.message : '建立創作任務失敗');
      stopPolling();
    } finally {
      setRenderCreating(false);
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>3 張圖片 + 一段摘要</span>
          <h1 className={styles.title}>AI 自動生成短影音</h1>
          <p className={styles.description}>
            自動產生 Hook、字幕、旁白與視覺 Prompt，快速生成可編輯影片草稿與 10 秒成片。
          </p>
          <div className={styles.metaBar}>
            <span>登入使用者：{user?.display_name || '訪客'}</span>
            <span>剩餘點數：{remainingCredits}</span>
            <span>輸出規格：16:9 / 720p / 10s</span>
          </div>
        </div>
        <div className={styles.heroCard}>
          <div className={styles.heroMetric}>MVP</div>
          <div className={styles.heroMetricLabel}>MVP 版本基於現有 Promo 生成流程，自動建立影片任務並輸出結果。</div>
        </div>
      </section>

      <section className={styles.grid}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>1. 輸入素材</h2>
            <span>{helperText}</span>
          </div>

          <label className={styles.fieldLabel}>參考圖片</label>
          <div className={styles.uploadPanel}>
            <input
              ref={fileInputRef}
              className={styles.hiddenInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={handleImageSelect}
            />
            <button
              type="button"
              className={styles.uploadButton}
              onClick={() => fileInputRef.current?.click()}
              disabled={referenceImages.length >= MAX_IMAGES}
            >
              選擇圖片
            </button>
            <p className={styles.helperText}>最多 3 張，前端會先壓縮到適合傳送的尺寸。</p>
            {imageError && <div className={styles.error}>{imageError}</div>}
          </div>

          <div className={styles.previewGrid}>
            {referenceImages.map((image) => (
              <div key={image.id} className={styles.previewCard}>
                <img src={image.dataUrl} alt={image.name} className={styles.previewImage} />
                <div className={styles.previewMeta}>
                  <span>{image.name}</span>
                  <button type="button" onClick={() => handleRemoveImage(image.id)}>
                    移除
                  </button>
                </div>
              </div>
            ))}
          </div>

          <label className={styles.fieldLabel}>創作摘要</label>
          <textarea
            className={styles.textarea}
            rows={6}
            maxLength={MAX_SUMMARY_LENGTH}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="輸入這支短影音的核心訊息、對象與想傳達的感受，至少 20 字。"
          />
          <div className={styles.inlineMeta}>
            <span>{summary.trim().length}/{MAX_SUMMARY_LENGTH}</span>
            <span>{summary.trim().length < 20 ? '至少 20 字才能生成' : '可生成草稿'}</span>
          </div>

          <div className={styles.inlineFields}>
            <label>
              <span className={styles.fieldLabel}>語氣</span>
              <select value={tone} onChange={(event) => setTone(event.target.value as ToneOption)}>
                <option value="inspiring">鼓舞</option>
                <option value="warm">溫暖</option>
                <option value="cinematic">電影感</option>
                <option value="urgent">強節奏</option>
              </select>
            </label>

            <label>
              <span className={styles.fieldLabel}>旁白聲線</span>
              <select value={voiceGender} onChange={(event) => setVoiceGender(event.target.value as VoiceGender)}>
                <option value="female">女聲</option>
                <option value="male">男聲</option>
              </select>
            </label>
          </div>

          <button
            type="button"
            className={styles.primaryButton}
            disabled={!canGenerate || draftLoading}
            onClick={handleGenerateDraft}
          >
            {draftLoading ? '生成草稿中...' : '2. 生成可編輯草稿'}
          </button>
          {draftError && <div className={styles.error}>{draftError}</div>}
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>2. 編輯草稿</h2>
            <span>{subtitleCount > 0 ? `${subtitleCount} 段字幕` : '尚未生成'}</span>
          </div>

          {!draft && <div className={styles.placeholder}>先在左側產生草稿，這裡會出現可編輯內容。</div>}

          {draft && (
            <div className={styles.editorStack}>
              <label>
                <span className={styles.fieldLabel}>Hook</span>
                <input
                  className={styles.input}
                  value={draft.hook}
                  onChange={(event) => handleDraftChange('hook', event.target.value)}
                />
              </label>

              <label>
                <span className={styles.fieldLabel}>主文案</span>
                <textarea
                  className={styles.textarea}
                  rows={3}
                  value={draft.body}
                  onChange={(event) => handleDraftChange('body', event.target.value)}
                />
              </label>

              <label>
                <span className={styles.fieldLabel}>旁白</span>
                <textarea
                  className={styles.textarea}
                  rows={3}
                  value={draft.voiceover}
                  onChange={(event) => handleDraftChange('voiceover', event.target.value)}
                />
              </label>

              <label>
                <span className={styles.fieldLabel}>視覺 Prompt</span>
                <textarea
                  className={styles.textarea}
                  rows={6}
                  value={draft.visualPrompt}
                  onChange={(event) => handleDraftChange('visualPrompt', event.target.value)}
                />
              </label>

              <div className={styles.subtitleBlock}>
                <span className={styles.fieldLabel}>字幕分段</span>
                {draft.subtitleLines.map((line, index) => (
                  <div key={`${line.start}-${line.end}-${index}`} className={styles.subtitleRow}>
                    <div className={styles.subtitleTiming}>{line.start}s - {line.end}s</div>
                    <input
                      className={styles.input}
                      value={line.text}
                      onChange={(event) => handleSubtitleChange(index, event.target.value)}
                    />
                    <textarea
                      className={styles.smallTextarea}
                      rows={2}
                      value={draft.shots[index]?.visual || ''}
                      onChange={(event) => handleShotVisualChange(index, event.target.value)}
                    />
                  </div>
                ))}
              </div>

              <button
                type="button"
                className={styles.primaryButton}
                disabled={renderCreating}
                onClick={handleCreateRender}
              >
                {renderCreating ? '建立任務中...' : '3. 生成 10 秒影片'}
              </button>
            </div>
          )}
        </div>
      </section>

      <section className={styles.resultPanel}>
        <div className={styles.panelHeader}>
          <h2>3. 任務結果</h2>
          <span>{renderPolling ? '輪詢中' : renderStatus || '待命'}</span>
        </div>

        {(renderStatus || renderJobId) && (
          <div className={styles.statusBar}>
            <span>狀態：{renderStatus || 'queued'}</span>
            {renderJobId && <span>Job ID：{renderJobId}</span>}
          </div>
        )}

        {renderError && <div className={styles.error}>{renderError}</div>}

        {!renderResult && !renderError && (
          <div className={styles.placeholder}>建立任務後，這裡會顯示影片、音訊與最終輸出資訊。</div>
        )}

        {renderResult && (
          <div className={styles.resultGrid}>
            <div className={styles.resultCard}>
              <h3>影片預覽</h3>
              {renderResult.videoUrl ? (
                <video className={styles.video} controls src={renderResult.videoUrl} />
              ) : (
                <div className={styles.placeholder}>目前 provider 尚未返回影片檔，請檢查任務狀態或 provider 設定。</div>
              )}
              {renderResult.audioUrl && <audio className={styles.audio} controls src={renderResult.audioUrl} />}
            </div>

            <div className={styles.resultCard}>
              <h3>輸出資訊</h3>
              <p>
                {renderResult.exportSpec.aspectRatio} / {renderResult.exportSpec.resolution} / {renderResult.exportSpec.durationSec}s / {renderResult.exportSpec.fps}fps
              </p>
              <p>建議工具：{renderResult.recommendedTools.join(' / ')}</p>
              <pre className={styles.promptPreview}>{renderResult.renderPrompt}</pre>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}