'use client';

import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/app/contexts/AuthContext';
import styles from './page.module.css';
import type { AiToolRecord, AiToolStatus } from '@/app/types/aiTools';

interface FormState {
  id?: string;
  name: string;
  shortTitle: string;
  description: string;
  category: string;
  subcategory: string;
  iconUrl: string;
  websiteUrl: string;
  displayOrder: string;
  status: AiToolStatus;
  featured: boolean;
}

const emptyForm: FormState = {
  name: '',
  shortTitle: '',
  description: '',
  category: '',
  subcategory: '',
  iconUrl: '',
  websiteUrl: '',
  displayOrder: '0',
  status: 'active',
  featured: false,
};

const NEW_CATEGORY_OPTION = '__new_category__';

type FieldErrors = Partial<Record<keyof FormState, string>>;

// 依画面顺序排列，送出失败时聚焦第一个有错的栏位
const FIELD_ORDER: (keyof FormState)[] = ['name', 'shortTitle', 'description', 'websiteUrl', 'category', 'subcategory', 'iconUrl'];

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

interface AdminResponse {
  success: boolean;
  error?: string;
  items?: AiToolRecord[];
  item?: AiToolRecord;
  iconUrl?: string;
}

function statusLabel(status: AiToolStatus) {
  return status === 'active' ? '启用' : '停用';
}

function Field({
  id,
  label,
  required,
  hint,
  error,
  counter,
  full,
  children,
}: {
  id: keyof FormState;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  counter?: string;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`${styles.field} ${full ? styles.fullWidth : ''} ${error ? styles.fieldInvalid : ''}`}>
      <div className={styles.fieldLabelRow}>
        <label className={styles.fieldLabel} htmlFor={`ai-tool-${id}`}>
          {label}
          {required && <span className={styles.required}> *</span>}
        </label>
        {counter && <span className={styles.counter}>{counter}</span>}
      </div>
      {hint && <p className={styles.fieldHint}>{hint}</p>}
      {children}
      {error && <p className={styles.fieldError}>{error}</p>}
    </div>
  );
}

export default function AdminAiToolsPage() {
  const { user, loading: authLoading } = useAuth();
  const [tools, setTools] = useState<AiToolRecord[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const requestHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      'x-user-id': user?.user_id || '',
    }),
    [user?.user_id]
  );

  const loadTools = async () => {
    if (!user?.user_id) return;
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/ai-tools?userId=${encodeURIComponent(user.user_id)}`, {
        headers: { 'x-user-id': user.user_id },
        cache: 'no-store',
      });
      const payload = (await response.json()) as AdminResponse;

      if (response.status === 403) {
        setAccessDenied(true);
      }

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '无法载入工具资料。');
      }

      setAccessDenied(false);
      setTools(payload.items || []);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '无法载入工具资料。' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user?.user_id) {
      loadTools();
    }
  }, [authLoading, user?.user_id]);

  const categories = useMemo(
    () => Array.from(new Set(tools.map((tool) => tool.category).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [tools]
  );

  const subcategoriesByCategory = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const tool of tools) {
      if (!tool.category || !tool.subcategory) continue;
      if (!map.has(tool.category)) map.set(tool.category, new Set());
      map.get(tool.category)!.add(tool.subcategory);
    }
    return map;
  }, [tools]);

  const subcategorySuggestions = useMemo(() => {
    const subcategories = subcategoriesByCategory.get(form.category.trim());
    return subcategories ? Array.from(subcategories).sort((a, b) => a.localeCompare(b)) : [];
  }, [subcategoriesByCategory, form.category]);

  const isNewCategory = Boolean(form.category.trim()) && !categories.includes(form.category.trim());

  const existingSubcategoryNames = useMemo(
    () => new Set(tools.filter((tool) => tool.id !== form.id).map((tool) => tool.subcategory).filter(Boolean)),
    [tools, form.id]
  );

  const fieldErrors = useMemo(() => {
    const errors: FieldErrors = {};
    if (!form.name.trim()) errors.name = '请填写工具名称。';
    if (!form.shortTitle.trim()) errors.shortTitle = '请填写简短标题。';
    if (!form.description.trim()) errors.description = '请填写说明。';
    if (form.websiteUrl.trim() && !isHttpUrl(form.websiteUrl.trim())) {
      errors.websiteUrl = '网址需以 http:// 或 https:// 开头。';
    }
    if (!form.category.trim()) errors.category = showNewCategoryInput ? '请输入新分类名称。' : '请选择分类。';
    if (!form.subcategory.trim()) {
      errors.subcategory = '请填写子分类。';
    } else if (isNewCategory && existingSubcategoryNames.has(form.subcategory.trim())) {
      errors.subcategory = '新增分类时，子分类必须是全新名称，不可以跟既有子分类重复。';
    }
    if (!form.iconUrl.trim()) errors.iconUrl = '请上传工具图标。';
    return errors;
  }, [form, showNewCategoryInput, isNewCategory, existingSubcategoryNames]);

  const visibleErrors: FieldErrors = attempted ? fieldErrors : {};

  const filteredTools = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return tools.filter((tool) => {
      const matchesSearch =
        !normalizedSearch ||
        [tool.name, tool.shortTitle, tool.description, tool.category, tool.subcategory]
          .join(' ')
          .toLowerCase()
          .includes(normalizedSearch);
      const matchesCategory = !categoryFilter || tool.category === categoryFilter;
      const matchesStatus = !statusFilter || tool.status === statusFilter;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [tools, search, categoryFilter, statusFilter]);

  const setField = (field: keyof FormState, value: string | boolean) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const setCategoryField = (value: string) => {
    setForm((current) => (current.category === value ? current : { ...current, category: value, subcategory: '' }));
  };

  const resetForm = () => {
    setForm(emptyForm);
    setShowNewCategoryInput(false);
    setAttempted(false);
    setMessage(null);
  };

  const editTool = (tool: AiToolRecord) => {
    setForm({
      id: tool.id,
      name: tool.name,
      shortTitle: tool.shortTitle,
      description: tool.description,
      category: tool.category,
      subcategory: tool.subcategory,
      iconUrl: tool.iconUrl,
      websiteUrl: tool.websiteUrl || '',
      displayOrder: String(tool.displayOrder ?? 0),
      status: tool.status,
      featured: Boolean(tool.featured),
    });
    setShowNewCategoryInput(false);
    setAttempted(false);
    setMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const uploadIcon = async (file: File) => {
    if (!user?.user_id) return;

    setUploading(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', user.user_id);

      const response = await fetch('/api/admin/ai-tools/upload-icon', {
        method: 'POST',
        headers: { 'x-user-id': user.user_id },
        body: formData,
      });
      const payload = (await response.json()) as AdminResponse;

      if (response.status === 403) {
        setAccessDenied(true);
      }

      if (!response.ok || !payload.success || !payload.iconUrl) {
        throw new Error(payload.error || '图标上传失败。');
      }

      setField('iconUrl', payload.iconUrl);
      setMessage({ type: 'success', text: '图标已上传。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '图标上传失败。' });
    } finally {
      setUploading(false);
    }
  };

  const saveTool = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user?.user_id) return;

    const invalidFields = FIELD_ORDER.filter((field) => fieldErrors[field]);
    if (invalidFields.length) {
      setAttempted(true);
      setMessage({ type: 'error', text: `还有 ${invalidFields.length} 个栏位需要修正，请查看标红的栏位。` });
      document.getElementById(`ai-tool-${invalidFields[0]}`)?.focus();
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const payload = {
        ...form,
        userId: user.user_id,
        displayOrder: Number(form.displayOrder || 0),
      };
      const response = await fetch('/api/admin/ai-tools', {
        method: form.id ? 'PUT' : 'POST',
        headers: requestHeaders,
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as AdminResponse;

      if (response.status === 403) {
        setAccessDenied(true);
      }

      if (!response.ok || !data.success) {
        throw new Error(data.error || '无法储存工具。');
      }

      setMessage({ type: 'success', text: form.id ? '工具已更新。' : '工具已建立。' });
      setForm(emptyForm);
      setShowNewCategoryInput(false);
      setAttempted(false);
      await loadTools();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '无法储存工具。' });
    } finally {
      setSaving(false);
    }
  };

  const deleteTool = async (tool: AiToolRecord) => {
    if (!user?.user_id) return;
    if (!confirm(`确定要删除「${tool.name}」吗？`)) return;

    setMessage(null);

    try {
      const response = await fetch('/api/admin/ai-tools', {
        method: 'DELETE',
        headers: requestHeaders,
        body: JSON.stringify({ id: tool.id, userId: user.user_id }),
      });
      const payload = (await response.json()) as AdminResponse;

      if (response.status === 403) {
        setAccessDenied(true);
      }

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '无法删除工具。');
      }

      setMessage({ type: 'success', text: '工具已删除。' });
      if (form.id === tool.id) resetForm();
      await loadTools();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '无法删除工具。' });
    }
  };

  if (authLoading) {
    return <main className={styles.page}>正在检查权限...</main>;
  }

  if (!user?.user_id) {
    return (
      <main className={styles.page}>
        <div className={styles.accessDenied}>请先登入后再进入 AI 工具管理。</div>
      </main>
    );
  }

  if (accessDenied) {
    return (
      <main className={styles.page}>
        <div className={styles.accessDenied}>没有权限进入此管理页面，请先在用户权限管理中完成授权。</div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>后台管理</p>
          <h1>AI 工具管理</h1>
          <p>维护前台「AI 工具」目录中的工具资料、分类与图标。</p>
        </div>
        <Link className={styles.publicLink} href="/ai-tools">
          查看前台
        </Link>
      </header>

      <section className={styles.editorPanel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>{form.id ? '编辑工具' : '新增工具'}</h2>
            <p className={styles.panelHint}>
              标示 <span className={styles.required}>*</span> 的栏位为必填。
            </p>
          </div>
          {form.id && (
            <button type="button" className={styles.secondaryButton} onClick={resetForm}>
              新增另一笔
            </button>
          )}
        </div>

        <form className={styles.form} onSubmit={saveTool} noValidate>
          <fieldset className={styles.formSection}>
            <legend>
              <span className={styles.stepNumber}>1</span>
              基本资料
            </legend>
            <div className={styles.fieldGrid}>
              <Field id="name" label="工具名称" required hint="工具的正式名称，例如 ChatGPT。" error={visibleErrors.name}>
                <input
                  id="ai-tool-name"
                  value={form.name}
                  maxLength={120}
                  placeholder="例如：ChatGPT"
                  aria-invalid={Boolean(visibleErrors.name)}
                  onChange={(event) => setField('name', event.target.value)}
                />
              </Field>

              <Field
                id="shortTitle"
                label="简短标题"
                required
                hint="一句话点出特色，显示在卡片的工具名称下方。"
                error={visibleErrors.shortTitle}
              >
                <input
                  id="ai-tool-shortTitle"
                  value={form.shortTitle}
                  maxLength={160}
                  placeholder="例如：OpenAI 推出的多功能 AI 助手"
                  aria-invalid={Boolean(visibleErrors.shortTitle)}
                  onChange={(event) => setField('shortTitle', event.target.value)}
                />
              </Field>

              <Field
                id="description"
                label="说明"
                required
                full
                hint="介绍工具能做什么、适合谁使用，显示在卡片与工具详情页。"
                error={visibleErrors.description}
                counter={`${form.description.length} / 1000`}
              >
                <textarea
                  id="ai-tool-description"
                  value={form.description}
                  maxLength={1000}
                  aria-invalid={Boolean(visibleErrors.description)}
                  onChange={(event) => setField('description', event.target.value)}
                />
              </Field>

              <Field
                id="websiteUrl"
                label="网站网址"
                full
                hint="选填。工具详情页的「前往网站」按钮会连到这里。"
                error={visibleErrors.websiteUrl}
              >
                <input
                  id="ai-tool-websiteUrl"
                  type="url"
                  inputMode="url"
                  value={form.websiteUrl}
                  placeholder="https://"
                  aria-invalid={Boolean(visibleErrors.websiteUrl)}
                  onChange={(event) => setField('websiteUrl', event.target.value)}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset className={styles.formSection}>
            <legend>
              <span className={styles.stepNumber}>2</span>
              目录位置
            </legend>
            <div className={styles.fieldGrid}>
              <Field
                id="category"
                label="分类"
                required
                hint="工具的大类，显示在目录左侧第一层。请按「用途」划分，例如：聊天助手、写作文案、图像设计、影音制作、办公效率。请优先选择既有分类，没有合适的再新增。"
                error={visibleErrors.category}
              >
                <select
                  id={showNewCategoryInput ? undefined : 'ai-tool-category'}
                  value={showNewCategoryInput ? NEW_CATEGORY_OPTION : form.category}
                  aria-invalid={Boolean(visibleErrors.category) && !showNewCategoryInput}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === NEW_CATEGORY_OPTION) {
                      setShowNewCategoryInput(true);
                      setCategoryField('');
                    } else {
                      setShowNewCategoryInput(false);
                      setCategoryField(value);
                    }
                  }}
                >
                  <option value="" disabled>
                    请选择分类
                  </option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                  <option value={NEW_CATEGORY_OPTION}>+ 新增分类…</option>
                </select>
                {showNewCategoryInput && (
                  <input
                    id="ai-tool-category"
                    value={form.category}
                    maxLength={100}
                    placeholder="输入新分类名称，例如：图像设计"
                    autoFocus
                    aria-invalid={Boolean(visibleErrors.category)}
                    onChange={(event) => setCategoryField(event.target.value)}
                  />
                )}
              </Field>

              <Field
                id="subcategory"
                label="子分类"
                required
                hint={
                  isNewCategory
                    ? '分类下更具体的用途。这是新分类，子分类必须是全新名称，不可与既有子分类重复。'
                    : '分类下更具体的用途，用户展开分类后点选的第二层。不要重复分类名称或工具名称，例如「图像设计」下可分为「AI 绘图」「图片编辑」「Logo 设计」。'
                }
                error={visibleErrors.subcategory}
              >
                <input
                  id="ai-tool-subcategory"
                  value={form.subcategory}
                  list="ai-tool-subcategories"
                  maxLength={100}
                  disabled={!form.category.trim()}
                  placeholder={form.category.trim() ? '例如：AI 绘图、图片编辑' : '请先选择分类'}
                  aria-invalid={Boolean(visibleErrors.subcategory)}
                  onChange={(event) => setField('subcategory', event.target.value)}
                />
                <datalist id="ai-tool-subcategories">
                  {subcategorySuggestions.map((subcategory) => (
                    <option key={subcategory} value={subcategory} />
                  ))}
                </datalist>
                {subcategorySuggestions.length > 0 && (
                  <div className={styles.chips} aria-label="既有子分类">
                    {subcategorySuggestions.map((subcategory) => (
                      <button
                        key={subcategory}
                        type="button"
                        className={`${styles.chip} ${form.subcategory === subcategory ? styles.chipActive : ''}`}
                        onClick={() => setField('subcategory', subcategory)}
                      >
                        {subcategory}
                      </button>
                    ))}
                  </div>
                )}
              </Field>
            </div>

            <div className={styles.pathPreview}>
              <span>前台显示位置</span>
              <strong>
                AI 工具 › {form.category.trim() || '分类'} › {form.subcategory.trim() || '子分类'}
              </strong>
            </div>
          </fieldset>

          <fieldset className={styles.formSection}>
            <legend>
              <span className={styles.stepNumber}>3</span>
              工具图标 <span className={styles.required}>*</span>
            </legend>
            <div className={`${styles.iconUploadRow} ${visibleErrors.iconUrl ? styles.iconUploadRowInvalid : ''}`}>
              <div className={styles.iconPreview}>
                {form.iconUrl ? <img src={form.iconUrl} alt="AI 工具图标预览" /> : <span>尚未上传</span>}
              </div>
              <div className={styles.iconControls}>
                <div className={styles.uploadLine}>
                  <label className={`${styles.uploadButton} ${uploading ? styles.uploadButtonBusy : ''}`}>
                    <input
                      id="ai-tool-iconUrl"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      disabled={uploading}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) uploadIcon(file);
                        event.currentTarget.value = '';
                      }}
                    />
                    {uploading ? '上传中…' : form.iconUrl ? '更换图标' : '选择图片上传'}
                  </label>
                  <small>建议使用正方形图片，PNG、JPG、WEBP、GIF，不超过 3MB。</small>
                </div>
                <input
                  className={styles.iconUrlInput}
                  value={form.iconUrl}
                  placeholder="或贴上图片网址"
                  aria-label="图标网址"
                  onChange={(event) => setField('iconUrl', event.target.value)}
                />
                {visibleErrors.iconUrl && <p className={styles.fieldError}>{visibleErrors.iconUrl}</p>}
              </div>
            </div>
          </fieldset>

          <fieldset className={styles.formSection}>
            <legend>
              <span className={styles.stepNumber}>4</span>
              显示设定
            </legend>
            <div className={styles.settingsGrid}>
              <Field id="displayOrder" label="显示顺序" hint="同一子分类内，数字越小越靠前。">
                <input
                  id="ai-tool-displayOrder"
                  type="number"
                  min={0}
                  value={form.displayOrder}
                  onChange={(event) => setField('displayOrder', event.target.value)}
                />
              </Field>

              <div className={styles.field}>
                <span className={styles.fieldLabel}>状态</span>
                <p className={styles.fieldHint}>停用后前台不会显示此工具。</p>
                <div className={styles.segmented} role="radiogroup" aria-label="状态">
                  {(['active', 'inactive'] as AiToolStatus[]).map((status) => (
                    <button
                      key={status}
                      type="button"
                      role="radio"
                      aria-checked={form.status === status}
                      className={form.status === status ? styles.segmentActive : ''}
                      onClick={() => setField('status', status)}
                    >
                      {statusLabel(status)}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.field}>
                <span className={styles.fieldLabel}>精选工具</span>
                <p className={styles.fieldHint}>在前台卡片加上「精选」标签。</p>
                <label className={styles.switch}>
                  <input
                    type="checkbox"
                    checked={form.featured}
                    onChange={(event) => setField('featured', event.target.checked)}
                  />
                  <span className={styles.switchTrack} aria-hidden="true" />
                  <span>{form.featured ? '已设为精选' : '未设为精选'}</span>
                </label>
              </div>
            </div>
          </fieldset>

          <div className={styles.formActions}>
            <button type="button" className={styles.secondaryButton} onClick={resetForm} disabled={saving}>
              清空
            </button>
            <button type="submit" className={styles.primaryButton} disabled={saving || uploading}>
              {saving ? '储存中…' : form.id ? '更新工具' : '建立工具'}
            </button>
          </div>

          {message && (
            <div
              className={`${styles.message} ${message.type === 'success' ? styles.success : styles.error}`}
              role={message.type === 'error' ? 'alert' : 'status'}
            >
              {message.text}
            </div>
          )}
        </form>
      </section>

      <section className={styles.listPanel}>
        <div className={styles.panelHeader}>
          <h2>工具清单</h2>
          <button type="button" className={styles.secondaryButton} onClick={loadTools} disabled={loading}>
            {loading ? '载入中...' : '重新载入'}
          </button>
        </div>

        <div className={styles.filters}>
          <input placeholder="搜寻名称、分类或说明" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="">全部分类</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">全部状态</option>
            <option value="active">启用</option>
            <option value="inactive">停用</option>
          </select>
        </div>

        {loading ? (
          <div className={styles.stateBox}>工具载入中...</div>
        ) : filteredTools.length === 0 ? (
          <div className={styles.stateBox}>没有符合条件的工具。</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>工具</th>
                  <th>分类</th>
                  <th>状态</th>
                  <th>顺序</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredTools.map((tool) => (
                  <tr key={tool.id}>
                    <td>
                      <div className={styles.toolCell}>
                        <img src={tool.iconUrl} alt="" />
                        <div>
                          <strong>{tool.name}</strong>
                          <span>{tool.shortTitle}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong>{tool.category}</strong>
                      <span className={styles.subText}>{tool.subcategory}</span>
                    </td>
                    <td>
                      <span className={`${styles.statusBadge} ${tool.status === 'active' ? styles.active : styles.inactive}`}>
                        {statusLabel(tool.status)}
                      </span>
                    </td>
                    <td>{tool.displayOrder ?? 0}</td>
                    <td>{tool.updatedAt ? new Date(tool.updatedAt).toLocaleDateString('zh-CN') : '-'}</td>
                    <td>
                      <div className={styles.rowActions}>
                        <button type="button" onClick={() => editTool(tool)}>
                          编辑
                        </button>
                        <button type="button" className={styles.deleteButton} onClick={() => deleteTool(tool)}>
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
