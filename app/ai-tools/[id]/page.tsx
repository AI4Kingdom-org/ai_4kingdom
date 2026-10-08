'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import styles from './page.module.css';
import IframeAutoHeight from '../../components/IframeAutoHeight';
import type { AiToolRecord } from '@/app/types/aiTools';

interface DetailResponse {
  success: boolean;
  error?: string;
  data?: {
    tool: AiToolRecord;
  };
}

export default function AiToolDetailPage() {
  const params = useParams<{ id: string }>();
  const [tool, setTool] = useState<AiToolRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadTool() {
      setLoading(true);
      setError('');

      try {
        const response = await fetch(`/api/ai-tools/${encodeURIComponent(params.id)}`, { cache: 'no-store' });
        const payload = (await response.json()) as DetailResponse;

        if (!response.ok || !payload.success || !payload.data?.tool) {
          throw new Error(payload.error || '找不到这个工具。');
        }

        if (!cancelled) setTool(payload.data.tool);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '无法载入工具资料。');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (params.id) loadTool();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  return (
    <main className={styles.page}>
      <IframeAutoHeight />

      <div className={styles.shell}>
        <Link className={styles.backLink} href="/ai-tools">
          ← 返回 AI 工具目录
        </Link>

        {loading ? (
          <div className={styles.stateBox}>载入中…</div>
        ) : error || !tool ? (
          <div className={styles.stateBox}>
            <strong>资料载入失败</strong>
            <p>{error || '找不到这个工具。'}</p>
          </div>
        ) : (
          <article>
            <header className={styles.hero}>
              <p className={styles.kicker}>
                <span>
                  {tool.category} › {tool.subcategory}
                </span>
              </p>
              <div className={styles.titleRow}>
                <img className={styles.icon} src={tool.iconUrl} alt={`${tool.name} 图标`} />
                <div className={styles.titleText}>
                  <h1>{tool.name}</h1>
                  {tool.featured && <span className={styles.featuredBadge}>精选</span>}
                </div>
              </div>
            </header>

            <div className={styles.body}>
              <p className={styles.shortTitle}>{tool.shortTitle}</p>
              <p className={styles.description}>{tool.description}</p>

              {tool.websiteUrl && (
                <a className={styles.websiteLink} href={tool.websiteUrl} target="_blank" rel="noreferrer">
                  前往工具官网 ↗
                </a>
              )}
            </div>
          </article>
        )}
      </div>
    </main>
  );
}
