'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import styles from './page.module.css';
import IframeAutoHeight from '../components/IframeAutoHeight';
import type { AiToolRecord, AiToolsCategoryGroup, AiToolsSubcategoryGroup } from '@/app/types/aiTools';

interface DirectoryResponse {
  success: boolean;
  error?: string;
  data?: {
    categories: AiToolsCategoryGroup[];
    tools: AiToolRecord[];
  };
}

interface ActiveFilter {
  category: string;
  subcategory: string;
}

function countTools(category: AiToolsCategoryGroup) {
  return category.subcategories.reduce((sum, subcategory) => sum + subcategory.tools.length, 0);
}

function ToolCard({ tool }: { tool: AiToolRecord }) {
  return (
    <Link className={styles.toolCard} href={`/ai-tools/${tool.id}`}>
      <div className={styles.toolHead}>
        <img className={styles.toolIcon} src={tool.iconUrl} alt={`${tool.name} 图标`} />
        <div className={styles.toolTitle}>
          <h4>{tool.name}</h4>
          {tool.featured && <span className={styles.featuredBadge}>精选</span>}
        </div>
      </div>
      <p className={styles.shortTitle}>{tool.shortTitle}</p>
      <p className={styles.description}>{tool.description}</p>
      <span className={styles.cardMore}>查看介绍 →</span>
    </Link>
  );
}

export default function AiToolsDirectoryPage() {
  const [categories, setCategories] = useState<AiToolsCategoryGroup[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState<ActiveFilter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadDirectory() {
      setLoading(true);
      setError('');

      try {
        const response = await fetch('/api/ai-tools', { cache: 'no-store' });
        const payload = (await response.json()) as DirectoryResponse;

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || '无法载入工具资料。');
        }

        if (cancelled) return;
        const nextCategories = payload.data?.categories || [];
        setCategories(nextCategories);
        setExpandedCategories(new Set(nextCategories.map((category) => category.name)));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '无法载入工具资料。');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDirectory();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalToolsCount = useMemo(
    () => categories.reduce((sum, category) => sum + countTools(category), 0),
    [categories]
  );

  const activeFilterGroup = useMemo(() => {
    if (!activeFilter) return null;
    const category = categories.find((item) => item.name === activeFilter.category);
    const subcategory = category?.subcategories.find((item) => item.name === activeFilter.subcategory);
    return category && subcategory ? { category, subcategory } : null;
  }, [categories, activeFilter]);

  const handleCategoryClick = (category: AiToolsCategoryGroup) => {
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(category.name)) {
        next.delete(category.name);
      } else {
        next.add(category.name);
      }
      return next;
    });
  };

  const handleSubcategoryClick = (category: AiToolsCategoryGroup, subcategory: AiToolsSubcategoryGroup) => {
    setActiveFilter({ category: category.name, subcategory: subcategory.name });
  };

  return (
    <main className={styles.page}>
      <IframeAutoHeight />

      <div className={styles.shell}>
        <header className={styles.hero}>
          <p className={styles.kicker}>
            <span>精选 AI 工具目录</span>
          </p>
          <h1>最新 AI 工具介绍</h1>
          <p className={styles.intro}>
            国度AI为教会、牧者与家庭整理实用的 AI 工具，并按用途分类。选择分类后，点选工具卡片即可查看介绍并前往官网。
          </p>
        </header>

        <div className={styles.directory}>
          <aside className={styles.sidebar} aria-label="AI 工具分类">
            <p className={styles.sidebarTitle}>分类浏览</p>

            {loading ? (
              <div className={styles.sidebarSkeleton}>
                {Array.from({ length: 5 }).map((_, index) => (
                  <span key={index} />
                ))}
              </div>
            ) : error ? (
              <p className={styles.sidebarHint}>分类暂时无法载入</p>
            ) : categories.length === 0 ? (
              <p className={styles.sidebarHint}>尚未建立分类</p>
            ) : (
              <nav className={styles.categoryNav}>
                <button
                  type="button"
                  className={`${styles.allButton} ${!activeFilterGroup ? styles.navItemActive : ''}`}
                  onClick={() => setActiveFilter(null)}
                >
                  <span>全部工具</span>
                  <small>{totalToolsCount}</small>
                </button>

                {categories.map((category) => {
                  const expanded = expandedCategories.has(category.name);
                  return (
                    <div key={category.name} className={styles.categoryGroup}>
                      <button
                        type="button"
                        className={styles.categoryButton}
                        aria-expanded={expanded}
                        onClick={() => handleCategoryClick(category)}
                      >
                        <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`} aria-hidden="true" />
                        <span className={styles.categoryName}>{category.name}</span>
                        <small>{countTools(category)}</small>
                      </button>

                      {expanded && (
                        <div className={styles.subcategoryList}>
                          {category.subcategories.map((subcategory) => {
                            const active =
                              activeFilter?.category === category.name && activeFilter?.subcategory === subcategory.name;
                            return (
                              <button
                                type="button"
                                key={`${category.name}-${subcategory.name}`}
                                className={`${styles.subcategoryItem} ${active ? styles.navItemActive : ''}`}
                                aria-current={active ? 'true' : undefined}
                                onClick={() => handleSubcategoryClick(category, subcategory)}
                              >
                                <span>{subcategory.name}</span>
                                <small>{subcategory.tools.length}</small>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>
            )}
          </aside>

          <section className={styles.content}>
            <div className={styles.contentHeader}>
              <div>
                <p className={styles.crumb}>
                  {activeFilterGroup ? `AI 工具 › ${activeFilterGroup.category.name}` : 'AI 工具'}
                </p>
                <h2>{activeFilterGroup ? activeFilterGroup.subcategory.name : '全部 AI 工具'}</h2>
              </div>
              {!loading && !error && (
                <span className={styles.countBadge}>
                  {activeFilterGroup ? activeFilterGroup.subcategory.tools.length : totalToolsCount} 个工具
                </span>
              )}
            </div>

            {loading ? (
              <div className={styles.toolGrid}>
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className={styles.toolSkeleton} />
                ))}
              </div>
            ) : error ? (
              <div className={styles.stateBox}>
                <strong>资料载入失败</strong>
                <p>{error}</p>
              </div>
            ) : totalToolsCount === 0 ? (
              <div className={styles.stateBox}>
                <strong>尚未建立任何工具</strong>
                <p>请稍后再回来查看。</p>
              </div>
            ) : activeFilterGroup ? (
              <div className={styles.toolGrid}>
                {activeFilterGroup.subcategory.tools.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} />
                ))}
              </div>
            ) : (
              categories.map((category) => (
                <section key={category.name} className={styles.categoryBlock}>
                  <h3 className={styles.categoryHeading}>
                    <span>{category.name}</span>
                    <small>{countTools(category)} 个工具</small>
                  </h3>
                  {category.subcategories.map((subcategory) => (
                    <div key={`${category.name}-${subcategory.name}`} className={styles.toolSection}>
                      <p className={styles.subcategoryHeading}>{subcategory.name}</p>
                      <div className={styles.toolGrid}>
                        {subcategory.tools.map((tool) => (
                          <ToolCard key={tool.id} tool={tool} />
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              ))
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
