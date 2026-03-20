'use client';

import { useState } from 'react';
import styles from './PromoSegmentEditor.module.css';

interface PromoSegment {
  segmentIndex: number;
  durationSec: number;
  aspectRatio: '16:9';
  chineseCaption: string;
  voiceoverText: string;
  soraPrompt: string;
  editableFields: {
    caption?: string;
    voiceover?: string;
    soraPrompt?: string;
  };
}

interface PromoVideoResult {
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
}

interface PromoSegmentEditorProps {
  segments: PromoSegment[];
  onSegmentChange: (index: number, field: string, value: string) => void;
  onGenerateSegment: (index: number) => Promise<void>;
  segmentResults: Record<number, PromoVideoResult | null>;
  loadingSegments: Record<number, boolean>;
  audioUrls: Record<number, string | null>;
}

export default function PromoSegmentEditor({
  segments,
  onSegmentChange,
  onGenerateSegment,
  segmentResults,
  loadingSegments,
  audioUrls,
}: PromoSegmentEditorProps) {
  const [expandedSegment, setExpandedSegment] = useState<number | null>(0);

  const handleDownload = async (videoUrl: string, segmentIndex: number) => {
    try {
      const response = await fetch(videoUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `promo-segment-${segmentIndex + 1}.mp4`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download error:', error);
      alert('下載失敗');
    }
  };

  return (
    <div className={styles.segmentEditorContainer}>
      <div className={styles.segmentList}>
        {segments.map((segment, idx) => {
          const isExpanded = expandedSegment === idx;
          const result = segmentResults[idx];
          const isLoading = loadingSegments[idx];
          const audioUrl = audioUrls[idx];

          return (
            <div key={idx} className={`${styles.segmentCard} ${isExpanded ? styles.expanded : ''}`}>
              <div
                className={styles.segmentHeader}
                onClick={() => setExpandedSegment(isExpanded ? null : idx)}
              >
                <span className={styles.segmentIndex}>
                  {idx + 1}. {segment.editableFields.caption || segment.chineseCaption}
                </span>
                <span className={styles.segmentStatus}>
                  {isLoading && '⏳ 生成中...'}
                  {!isLoading && result?.videoUrl && '✅ 完成'}
                  {!isLoading && !result?.videoUrl && !result && '⏹️ 待生成'}
                </span>
              </div>

              {isExpanded && (
                <div className={styles.segmentContent}>
                  {/* Edit fields */}
                  <div className={styles.editSection}>
                    <div className={styles.editField}>
                      <label>字幕</label>
                      <input
                        type="text"
                        maxLength={30}
                        value={segment.editableFields.caption || segment.chineseCaption}
                        onChange={(e) => onSegmentChange(idx, 'caption', e.target.value)}
                        placeholder="編輯字幕"
                      />
                      <small>{(segment.editableFields.caption || segment.chineseCaption).length}/30</small>
                    </div>

                    <div className={styles.editField}>
                      <label>旁白配音文字</label>
                      <textarea
                        maxLength={100}
                        value={segment.editableFields.voiceover || segment.voiceoverText}
                        onChange={(e) => onSegmentChange(idx, 'voiceover', e.target.value)}
                        placeholder="編輯旁白"
                        rows={2}
                      />
                      <small>{(segment.editableFields.voiceover || segment.voiceoverText).length}/100</small>
                    </div>

                    <div className={styles.editField}>
                      <label>Sora Prompt (視覺描述)</label>
                      <textarea
                        maxLength={1000}
                        value={segment.editableFields.soraPrompt || segment.soraPrompt}
                        onChange={(e) => onSegmentChange(idx, 'soraPrompt', e.target.value)}
                        placeholder="編輯 Sora 提示符"
                        rows={4}
                      />
                      <small>{(segment.editableFields.soraPrompt || segment.soraPrompt).length}/1000</small>
                    </div>
                  </div>

                  {/* Generate button */}
                  <div className={styles.actionSection}>
                    <button
                      className={styles.generateBtn}
                      onClick={() => onGenerateSegment(idx)}
                      disabled={isLoading}
                    >
                      {isLoading ? '⏳ 生成中...' : '▶️ 生成此段影片'}
                    </button>
                  </div>

                  {/* Result preview */}
                  {result && (
                    <div className={styles.resultSection}>
                      <h4>影片結果</h4>
                      {result.videoUrl ? (
                        <div className={styles.videoPreview}>
                          <video controls src={result.videoUrl} />
                          <button
                            className={styles.downloadBtn}
                            onClick={() => handleDownload(result.videoUrl!, idx)}
                          >
                            📥 下載影片 (MP4)
                          </button>
                        </div>
                      ) : (
                        <div className={styles.processingStatus}>
                          ⏳ 影片生成中，建議每 10 秒重新查詢一次...
                        </div>
                      )}

                      {audioUrl && (
                        <div className={styles.audioPreview}>
                          <label>配音預覽</label>
                          <audio controls src={audioUrl} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
