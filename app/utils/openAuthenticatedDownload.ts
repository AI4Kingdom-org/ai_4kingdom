'use client';

/**
 * 以 fetch 取得需身分驗證的下載內容後在新分頁開啟。
 * window.open(url) 不會帶身分標頭（伺服器端會回 401/403），所以改成：
 * 先同步開空白分頁（避免被彈窗攔截），fetch 完成後把 blob 網址指給它。
 */
export async function openAuthenticatedDownload(url: string): Promise<void> {
  const win = window.open('', '_blank');
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `下載失敗（HTTP ${res.status}）`);
    }
    const blobUrl = URL.createObjectURL(await res.blob());
    if (win) win.location.href = blobUrl;
    else window.location.href = blobUrl;
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (err) {
    win?.close();
    throw err;
  }
}
