'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import styles from './page.module.css';
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
    () =>
      categories.reduce(
        (sum, category) => sum + category.subcategories.reduce((subSum, subcategory) => subSum + subcategory.tools.length, 0),
        0
      ),
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
    setActiveFilter(null);
  };

  const handleSubcategoryClick = (category: AiToolsCategoryGroup, subcategory: AiToolsSubcategoryGroup) => {
    setActiveFilter({ category: category.name, subcategory: subcategory.name });
  };

  return (
    <main className={styles.page}>
      <header className={styles.header} />

      <section className={styles.directoryShell}>
        <aside className={styles.sidebar} aria-label="AI 工具分类">
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
            categories.map((category) => (
              <div key={category.name} className={styles.categoryGroup}>
                <button
                  type="button"
                  className={`${styles.categoryButton} ${
                    expandedCategories.has(category.name) ? styles.categoryButtonActive : ''
                  }`}
                  onClick={() => handleCategoryClick(category)}
                >
                  <span>{category.name}</span>
                  <small>{category.subcategories.reduce((sum, item) => sum + item.tools.length, 0)}</small>
                </button>

                {expandedCategories.has(category.name) && (
                  <div className={styles.subcategoryList}>
                    {category.subcategories.map((subcategory) => (
                      <button
                        type="button"
                        key={`${category.name}-${subcategory.name}`}
                        className={`${styles.subcategoryItem} ${
                          activeFilter?.category === category.name && activeFilter?.subcategory === subcategory.name
                            ? styles.subcategoryItemActive
                            : ''
                        }`}
                        onClick={() => handleSubcategoryClick(category, subcategory)}
                      >
                        <span>{subcategory.name}</span>
                        <small>{subcategory.tools.length}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </aside>

        <section className={styles.contentPanel}>
          <div className={styles.contentHeader}>
            <div>
              <p>{activeFilterGroup ? activeFilterGroup.category.name : '目录'}</p>
              <h2>{activeFilterGroup ? activeFilterGroup.subcategory.name : '全部 AI 工具'}</h2>
            </div>
            <span>{(activeFilterGroup ? activeFilterGroup.subcategory.tools.length : totalToolsCount)} 个工具</span>
          </div>

          {loading ? (
            <div className={styles.toolGrid}>
              {Array.from({ length: 8 }).map((_, index) => (
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
              <p>请稍后再回来查看，或到后台新增工具资料。</p>
            </div>
          ) : activeFilterGroup ? (
            <div className={styles.toolGrid}>
              {activeFilterGroup.subcategory.tools.map((tool) => (
                <Link key={tool.id} className={styles.toolCard} href={`/ai-tools/${tool.id}`}>
                  <img className={styles.toolIcon} src={tool.iconUrl} alt={`${tool.name} 图标`} />
                  <div className={styles.toolBody}>
                    <div className={styles.toolTitleRow}>
                      <h3>{tool.name}</h3>
                      {tool.featured && <span>精选</span>}
                    </div>
                    <p className={styles.shortTitle}>{tool.shortTitle}</p>
                    <p className={styles.description}>{tool.description}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            categories.map((category) => (
              <div key={category.name} className={styles.categoryBlock}>
                <h2 className={styles.categoryDivider}>{category.name}</h2>
                {category.subcategories.map((subcategory) => (
                  <section key={`${category.name}-${subcategory.name}`} className={styles.toolSection}>
                    <div className={styles.toolSectionHeading}>
                      <h3>{subcategory.name}</h3>
                      <span>{subcategory.tools.length} 个工具</span>
                    </div>
                    <div className={styles.toolGrid}>
                      {subcategory.tools.map((tool) => (
                        <Link key={tool.id} className={styles.toolCard} href={`/ai-tools/${tool.id}`}>
                          <img className={styles.toolIcon} src={tool.iconUrl} alt={`${tool.name} 图标`} />
                          <div className={styles.toolBody}>
                            <div className={styles.toolTitleRow}>
                              <h3>{tool.name}</h3>
                              {tool.featured && <span>精选</span>}
                            </div>
                            <p className={styles.shortTitle}>{tool.shortTitle}</p>
                            <p className={styles.description}>{tool.description}</p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ))
          )}
        </section>
      </section>
    </main>
  );
}
