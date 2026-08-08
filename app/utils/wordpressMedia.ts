function getWordPressSiteUrl(): string {
  const explicit = process.env.WORDPRESS_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  // 若未特別設定，從既有的 NEXT_PUBLIC_API_BASE_URL 推導出網站根網域
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || '';
  const match = apiBase.match(/^https?:\/\/[^/]+/);
  return match ? match[0] : '';
}

export function getWordPressMediaConfig() {
  return {
    siteUrl: getWordPressSiteUrl(),
    username: process.env.WORDPRESS_MEDIA_USERNAME || '',
    appPassword: process.env.WORDPRESS_MEDIA_APP_PASSWORD || '',
  };
}

export async function uploadToWordPressMedia(params: {
  buffer: Buffer;
  fileName: string;
  contentType: string;
}): Promise<{ url: string }> {
  const { siteUrl, username, appPassword } = getWordPressMediaConfig();
  if (!siteUrl || !username || !appPassword) {
    throw new Error('WORDPRESS_MEDIA_NOT_CONFIGURED');
  }

  const authHeader = `Basic ${Buffer.from(`${username}:${appPassword}`).toString('base64')}`;

  const response = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': params.contentType,
      'Content-Disposition': `attachment; filename="${params.fileName}"`,
    },
    body: params.buffer,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`WordPress media upload failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const url = typeof data?.source_url === 'string' ? data.source_url : '';
  if (!url) {
    throw new Error('WordPress media upload response did not include source_url');
  }

  return { url };
}
