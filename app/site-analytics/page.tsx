'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import styles from './SiteAnalytics.module.css';
import { TOKEN_TO_CREDIT_RATIO } from '../config/plans';

type SiteFilter = 'all' | 'wp' | 'app';
type Granularity = 'day' | 'month';

interface Counter { views: number; visitors: number }
interface DailyRow {
  day: string;
  wp: Counter;
  app: Counter;
  signups: number | null;
  aiRequests: number;
  aiUsers: number;
  aiTokens: number;
  aiGuestTokens: number;
}
interface DimensionRow { key: string; views: number; visitors: number; site?: 'wp' | 'app' }
interface StatsResponse {
  success: boolean;
  error?: string;
  from: string;
  to: string;
  totals: {
    views: number; visitors: number; wpViews: number; appViews: number;
    signups: number; aiRequests: number; aiUsers: number; aiTokens: number;
  };
  daily: DailyRow[];
  pages: DimensionRow[];
  referrers: DimensionRow[];
  countries: DimensionRow[];
  devices: DimensionRow[];
  browsers: DimensionRow[];
  os: DimensionRow[];
  signups: { available: true; totalUsers: number } | { available: false; reason: string };
  monthlyAi: Array<{ month: string; activeMembers: number; tokens: number }>;
}

const SITE_LABEL: Record<'wp' | 'app', string> = { wp: 'WordPress', app: 'App' };
const DEVICE_LABEL: Record<string, string> = { mobile: '手機', tablet: '平板', desktop: '桌機' };

function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
function shiftDays(day: string, delta: number) {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000));
}
function fmt(n: number) {
  return n.toLocaleString('zh-TW');
}
function credits(tokens: number) {
  return fmt(Math.round(tokens / TOKEN_TO_CREDIT_RATIO));
}

const PRESETS: Array<{ label: string; range: () => [string, string] }> = [
  { label: '今天', range: () => [utcDay(), utcDay()] },
  { label: '近 7 天', range: () => [shiftDays(utcDay(), -6), utcDay()] },
  { label: '近 30 天', range: () => [shiftDays(utcDay(), -29), utcDay()] },
  { label: '近 90 天', range: () => [shiftDays(utcDay(), -89), utcDay()] },
  {
    label: '本月',
    range: () => [`${utcDay().slice(0, 7)}-01`, utcDay()],
  },
  {
    label: '上月',
    range: () => {
      const firstOfThisMonth = `${utcDay().slice(0, 7)}-01`;
      const lastOfPrev = shiftDays(firstOfThisMonth, -1);
      return [`${lastOfPrev.slice(0, 7)}-01`, lastOfPrev];
    },
  },
];

let regionNames: Intl.DisplayNames | null = null;
function countryLabel(code: string) {
  if (code === 'ZZ') return '未知';
  if (code.startsWith('tz:')) return `時區 ${code.slice(3)}`;
  try {
    regionNames ??= new Intl.DisplayNames(['zh-TW'], { type: 'region' });
    return `${regionNames.of(code) || code}（${code}）`;
  } catch {
    return code;
  }
}

/** 與 /token-management 相同的分頁列。 */
function Pagination({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const start = (page - 1) * pageSize;
  // 頁數多時只列出目前頁附近
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (n) => n === 1 || n === totalPages || Math.abs(n - page) <= 2
  );
  return (
    <nav className={styles.pagination} aria-label="分頁">
      <button onClick={() => onChange(page - 1)} disabled={page === 1} aria-label="上一頁">‹</button>
      {pages.map((n, i) => (
        <span key={n} className={styles.pageGroup}>
          {i > 0 && n - pages[i - 1] > 1 && <span className={styles.pageGap}>…</span>}
          <button
            onClick={() => onChange(n)}
            className={n === page ? styles.pageActive : undefined}
            aria-current={n === page ? 'page' : undefined}
          >
            {n}
          </button>
        </span>
      ))}
      <button onClick={() => onChange(page + 1)} disabled={page === totalPages} aria-label="下一頁">›</button>
      <span className={styles.pageInfo}>
        第 {start + 1}–{Math.min(start + pageSize, total)} 筆，共 {total} 筆
      </span>
    </nav>
  );
}

function PagedTable<T>({
  rows, pageSize, head, renderRow, empty, resetKey,
}: {
  rows: T[];
  pageSize: number;
  head: ReactNode;
  renderRow: (row: T, index: number) => ReactNode;
  empty: string;
  resetKey: string;
}) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [resetKey]);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * pageSize;
  const colCount = 20; // 大於任何表格的欄數，讓空白列跨滿整列
  return (
    <>
      <div className={styles.tableScroll}>
        <table className={styles.statsTable}>
          <thead>{head}</thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={colCount} className={styles.empty}>{empty}</td></tr>
            ) : (
              rows.slice(start, start + pageSize).map((row, i) => renderRow(row, start + i))
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={current} total={rows.length} pageSize={pageSize} onChange={setPage} />
    </>
  );
}

interface TrendRow extends DailyRow { label: string }

function groupTrend(daily: DailyRow[], granularity: Granularity): TrendRow[] {
  if (granularity === 'day') return daily.map((row) => ({ ...row, label: row.day }));
  const months = new Map<string, TrendRow>();
  for (const row of daily) {
    const month = row.day.slice(0, 7);
    const acc = months.get(month) || {
      label: month, day: month,
      wp: { views: 0, visitors: 0 }, app: { views: 0, visitors: 0 },
      signups: row.signups === null ? null : 0,
      aiRequests: 0, aiUsers: 0, aiTokens: 0, aiGuestTokens: 0,
    };
    acc.wp.views += row.wp.views;
    acc.wp.visitors += row.wp.visitors;
    acc.app.views += row.app.views;
    acc.app.visitors += row.app.visitors;
    if (acc.signups !== null && row.signups !== null) acc.signups += row.signups;
    acc.aiRequests += row.aiRequests;
    acc.aiUsers += row.aiUsers;
    acc.aiTokens += row.aiTokens;
    acc.aiGuestTokens += row.aiGuestTokens;
    months.set(month, acc);
  }
  return [...months.values()];
}

/** 瀏覽量長條圖（單一數列，滑過顯示明細）。表格版本就是下方的趨勢表。 */
function TrendChart({ rows, site }: { rows: TrendRow[]; site: SiteFilter }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = rows.map((row) =>
    site === 'wp' ? row.wp.views : site === 'app' ? row.app.views : row.wp.views + row.app.views
  );
  const max = Math.max(1, ...values);
  // 約 4 格、刻度落在 1/2/5 的整數倍
  const tickStep = (() => {
    const raw = Math.max(1, max / 4);
    const pow = 10 ** Math.floor(Math.log10(raw));
    const mult = [1, 2, 5, 10].find((m) => m * pow >= raw) || 10;
    return Math.max(1, mult * pow);
  })();
  const niceMax = tickStep * Math.ceil(max / tickStep);
  const width = 900;
  const height = 220;
  const pad = { top: 12, right: 8, bottom: 26, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const slot = plotW / Math.max(1, rows.length);
  const barW = Math.max(2, Math.min(28, slot - 2));
  const ticks = Array.from({ length: Math.round(niceMax / tickStep) + 1 }, (_, i) => i * tickStep);
  const labelEvery = Math.ceil(rows.length / 10);
  const hovered = hover !== null ? rows[hover] : null;

  return (
    <div className={styles.chartWrap}>
      <svg viewBox={`0 0 ${width} ${height}`} className={styles.chart} role="img" aria-label="瀏覽量趨勢圖" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => {
          const y = pad.top + plotH - (t / niceMax) * plotH;
          return (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} className={styles.gridLine} />
              <text x={pad.left - 6} y={y + 4} textAnchor="end" className={styles.axisText}>{fmt(t)}</text>
            </g>
          );
        })}
        {rows.map((row, i) => {
          const h = (values[i] / niceMax) * plotH;
          const x = pad.left + i * slot + (slot - barW) / 2;
          const y = pad.top + plotH - h;
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={row.label} onMouseEnter={() => setHover(i)}>
              <rect x={pad.left + i * slot} y={pad.top} width={slot} height={plotH} fill="transparent" />
              {h > 0 && (
                <path
                  className={hover === i ? styles.barActive : styles.bar}
                  d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z`}
                />
              )}
              {i % labelEvery === 0 && (
                <text x={pad.left + i * slot + slot / 2} y={height - 8} textAnchor="middle" className={styles.axisText}>
                  {row.label.length > 7 ? row.label.slice(5) : row.label}
                </text>
              )}
            </g>
          );
        })}
        <line x1={pad.left} x2={width - pad.right} y1={pad.top + plotH} y2={pad.top + plotH} className={styles.baseLine} />
      </svg>
      {hovered && (
        <div
          className={styles.tooltip}
          style={{ left: `${((pad.left + (hover! + 0.5) * slot) / width) * 100}%` }}
        >
          <strong>{hovered.label}</strong>
          {site !== 'app' && <div>WordPress：{fmt(hovered.wp.views)} 次瀏覽・{fmt(hovered.wp.visitors)} 訪客</div>}
          {site !== 'wp' && <div>App：{fmt(hovered.app.views)} 次瀏覽・{fmt(hovered.app.visitors)} 訪客</div>}
          {hovered.signups !== null && <div>新註冊：{fmt(hovered.signups)}</div>}
        </div>
      )}
    </div>
  );
}

function DimensionTable({ title, rows, label, resetKey, showVisitors = true }: {
  title: string;
  rows: DimensionRow[];
  label: (key: string) => string;
  resetKey: string;
  showVisitors?: boolean;
}) {
  const totalViews = rows.reduce((sum, row) => sum + row.views, 0) || 1;
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{title}</h2>
      <PagedTable
        rows={rows}
        pageSize={10}
        resetKey={resetKey}
        empty="此區間沒有資料"
        head={
          <tr>
            <th>{title}</th>
            <th className={styles.num}>瀏覽</th>
            {showVisitors && <th className={styles.num}>訪客</th>}
            <th className={styles.num}>占比</th>
          </tr>
        }
        renderRow={(row) => (
          <tr key={row.key}>
            <td className={styles.nowrap}>{label(row.key)}</td>
            <td className={styles.num}>{fmt(row.views)}</td>
            {showVisitors && <td className={styles.num}>{fmt(row.visitors)}</td>}
            <td className={styles.num}>
              <span className={styles.share}>
                <span className={styles.shareBar} style={{ width: `${(row.views / totalViews) * 100}%` }} />
              </span>
              {((row.views / totalViews) * 100).toFixed(1)}%
            </td>
          </tr>
        )}
      />
    </section>
  );
}

export default function SiteAnalyticsPage() {
  const [from, setFrom] = useState(() => shiftDays(utcDay(), -29));
  const [to, setTo] = useState(() => utcDay());
  const [site, setSite] = useState<SiteFilter>('all');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [pageFilter, setPageFilter] = useState('');
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to, site, _: String(Date.now()) });
      const response = await fetch(`/api/admin/site-stats?${params}`);
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.success) {
        throw new Error(
          response.status === 401 || response.status === 403
            ? '此頁僅限管理員，請以管理員帳號登入'
            : json.error || `讀取失敗（${response.status}）`
        );
      }
      setData(json);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : '讀取統計時發生錯誤');
    } finally {
      setLoading(false);
    }
  }, [from, to, site]);

  useEffect(() => {
    load();
  }, [load]);

  const trend = useMemo(() => (data ? groupTrend(data.daily, granularity) : []), [data, granularity]);
  const trendDesc = useMemo(() => [...trend].reverse(), [trend]);
  const pages = useMemo(() => {
    const q = pageFilter.trim().toLowerCase();
    return (data?.pages || []).filter((row) => !q || row.key.toLowerCase().includes(q));
  }, [data, pageFilter]);
  const resetKey = `${data?.from}|${data?.to}|${site}`;
  const showWp = site !== 'app';
  const showApp = site !== 'wp';
  const hasAnyVisits = !!data && data.totals.views > 0;

  return (
    <div className={styles.container}>
      <Link href="/management" className={styles.backButton}>返回後台管理</Link>
      <h1 className={styles.title}>網站流量統計</h1>

      <div className={styles.filterBar}>
        <label className={styles.field}>
          <span>網站</span>
          <select value={site} onChange={(e) => setSite(e.target.value as SiteFilter)}>
            <option value="all">全部（WordPress＋App）</option>
            <option value="wp">WordPress 網站</option>
            <option value="app">App 頁面</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>開始</span>
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>結束</span>
          <input type="date" value={to} min={from} max={utcDay()} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <div className={styles.presets}>
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              className={styles.presetButton}
              onClick={() => {
                const [f, t] = preset.range();
                setFrom(f);
                setTo(t);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <button className={styles.refreshButton} onClick={load} disabled={loading}>
          {loading ? '載入中…' : '刷新數據'}
        </button>
      </div>

      <p className={styles.note}>
        日期以 UTC 計。訪客數為「每日不重複訪客」的加總（為了隱私，不同日期無法辨認同一人）。
        App 頁面多半嵌在 WordPress 頁內，選「全部」時同一次瀏覽會在兩邊各算一次。
        管理員、編輯與機器人不計入。
        {lastRefresh && <> 最後更新：{lastRefresh.toLocaleString('zh-TW')}</>}
      </p>

      {error && <div className={styles.error}>{error}</div>}

      {data && (
        <>
          {!hasAnyVisits && (
            <div className={styles.info}>
              此區間還沒有瀏覽紀錄。流量統計從部署後開始收集；WordPress 網站需安裝 a4k-visit-stats.php 才會開始計數。
            </div>
          )}
          {!data.signups.available && (
            <div className={styles.info}>新註冊數暫時無法取得：{data.signups.reason}</div>
          )}

          <div className={styles.cards}>
            <div className={styles.card}>
              <div className={styles.cardLabel}>瀏覽量</div>
              <div className={styles.cardValue}>{fmt(data.totals.views)}</div>
              {site === 'all' && (
                <div className={styles.cardSub}>WordPress {fmt(data.totals.wpViews)}・App {fmt(data.totals.appViews)}</div>
              )}
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>訪客（每日加總）</div>
              <div className={styles.cardValue}>{fmt(data.totals.visitors)}</div>
              <div className={styles.cardSub}>
                平均每位 {data.totals.visitors ? (data.totals.views / data.totals.visitors).toFixed(1) : '0'} 頁
              </div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>新註冊</div>
              <div className={styles.cardValue}>{data.signups.available ? fmt(data.totals.signups) : '—'}</div>
              {data.signups.available && <div className={styles.cardSub}>目前共 {fmt(data.signups.totalUsers)} 個帳號</div>}
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>AI 呼叫</div>
              <div className={styles.cardValue}>{fmt(data.totals.aiRequests)}</div>
              <div className={styles.cardSub}>使用 {credits(data.totals.aiTokens)} 點・{fmt(data.totals.aiUsers)} 人次</div>
            </div>
          </div>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>瀏覽量趨勢</h2>
              <div className={styles.segmented} role="group" aria-label="時間單位">
                <button className={granularity === 'day' ? styles.segActive : undefined} onClick={() => setGranularity('day')}>按日</button>
                <button className={granularity === 'month' ? styles.segActive : undefined} onClick={() => setGranularity('month')}>按月</button>
              </div>
            </div>
            <TrendChart rows={trend} site={site} />
            <PagedTable
              rows={trendDesc}
              pageSize={granularity === 'day' ? 31 : 12}
              resetKey={`${resetKey}|${granularity}`}
              empty="沒有資料"
              head={
                <tr>
                  <th>{granularity === 'day' ? '日期' : '月份'}</th>
                  {showWp && <th className={styles.num}>WordPress 瀏覽</th>}
                  {showWp && <th className={styles.num}>WordPress 訪客</th>}
                  {showApp && <th className={styles.num}>App 瀏覽</th>}
                  {showApp && <th className={styles.num}>App 訪客</th>}
                  <th className={styles.num}>新註冊</th>
                  <th className={styles.num}>AI 呼叫</th>
                  <th className={styles.num}>AI 使用者</th>
                  <th className={styles.num}>AI 點數</th>
                  <th className={styles.num} title="訪客試用的 AI 點數（全站訪客預算紀錄，含本功能上線前的歷史）">訪客試用點數</th>
                </tr>
              }
              renderRow={(row) => (
                <tr key={row.label}>
                  <td className={styles.nowrap}>{row.label}</td>
                  {showWp && <td className={styles.num}>{fmt(row.wp.views)}</td>}
                  {showWp && <td className={styles.num}>{fmt(row.wp.visitors)}</td>}
                  {showApp && <td className={styles.num}>{fmt(row.app.views)}</td>}
                  {showApp && <td className={styles.num}>{fmt(row.app.visitors)}</td>}
                  <td className={styles.num}>{row.signups === null ? '—' : fmt(row.signups)}</td>
                  <td className={styles.num}>{fmt(row.aiRequests)}</td>
                  <td className={styles.num}>{fmt(row.aiUsers)}</td>
                  <td className={styles.num}>{credits(row.aiTokens)}</td>
                  <td className={styles.num}>{credits(row.aiGuestTokens)}</td>
                </tr>
              )}
            />
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>熱門頁面</h2>
              <input
                className={styles.search}
                type="search"
                placeholder="搜尋頁面路徑…"
                value={pageFilter}
                onChange={(e) => setPageFilter(e.target.value)}
              />
            </div>
            <PagedTable
              rows={pages}
              pageSize={20}
              resetKey={`${resetKey}|${pageFilter}`}
              empty={pageFilter ? '沒有符合的頁面' : '此區間沒有資料'}
              head={
                <tr>
                  <th className={styles.num}>#</th>
                  <th>頁面</th>
                  {site === 'all' && <th>網站</th>}
                  <th className={styles.num}>瀏覽</th>
                </tr>
              }
              renderRow={(row, index) => (
                <tr key={`${row.site}|${row.key}`}>
                  <td className={styles.num}>{index + 1}</td>
                  <td className={styles.path}>
                    {row.key === '(404)' ? (
                      '找不到頁面（404）'
                    ) : row.site === 'wp' ? (
                      <a href={`https://ai4kingdom.org${row.key}`} target="_blank" rel="noreferrer">{row.key}</a>
                    ) : (
                      row.key
                    )}
                  </td>
                  {site === 'all' && <td className={styles.nowrap}>{row.site ? SITE_LABEL[row.site] : ''}</td>}
                  <td className={styles.num}>{fmt(row.views)}</td>
                </tr>
              )}
            />
          </section>

          <div className={styles.grid}>
            <DimensionTable title="來源" rows={data.referrers} label={(k) => k} resetKey={resetKey} showVisitors={false} />
            <DimensionTable title="國家／地區" rows={data.countries} label={countryLabel} resetKey={resetKey} />
            <DimensionTable title="裝置" rows={data.devices} label={(k) => DEVICE_LABEL[k] || k} resetKey={resetKey} />
            <DimensionTable title="瀏覽器" rows={data.browsers} label={(k) => (k === 'Other' ? '其他' : k)} resetKey={resetKey} />
            <DimensionTable title="作業系統" rows={data.os} label={(k) => (k === 'Other' ? '其他' : k)} resetKey={resetKey} />
            <section className={styles.panel}>
              <h2 className={styles.panelTitle}>會員每月 AI 用量</h2>
              <PagedTable
                rows={data.monthlyAi}
                pageSize={12}
                resetKey={resetKey}
                empty="此區間沒有會員用量"
                head={
                  <tr>
                    <th>月份</th>
                    <th className={styles.num}>使用會員</th>
                    <th className={styles.num}>使用點數</th>
                  </tr>
                }
                renderRow={(row) => (
                  <tr key={row.month}>
                    <td className={styles.nowrap}>{row.month}</td>
                    <td className={styles.num}>{fmt(row.activeMembers)}</td>
                    <td className={styles.num}>{credits(row.tokens)}</td>
                  </tr>
                )}
              />
            </section>
          </div>
        </>
      )}

      {loading && !data && <div className={styles.loadingOverlay}>載入中，請稍候...</div>}
    </div>
  );
}
