/**
 * 瀏覽紀錄的分類工具：機器人判定、裝置／瀏覽器／作業系統、來源網站、國家。
 *
 * 隱私原則：伺服器端只看 User-Agent 與瀏覽器回報的時區，不保存 IP；
 * 國家優先取 CDN 標頭（有的話），否則由時區推估，對不上的時區以「tz:時區」保存。
 */

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

const BOT_RE =
  /bot|crawl|spider|slurp|archiver|facebookexternalhit|embedly|preview|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|scan|python|curl|wget|httpclient|http-client|axios|node-fetch|undici|go-http|java\/|okhttp|libwww|phantom|selenium|puppeteer|playwright|electron/i;

export function isBot(ua: string): boolean {
  return !ua || ua.length < 20 || BOT_RE.test(ua);
}

export function deviceType(ua: string): DeviceType {
  if (/ipad|tablet|kindle|silk|playbook|android(?!.*mobile)/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android|windows phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

export function browserName(ua: string): string {
  if (/MicroMessenger/i.test(ua)) return 'WeChat';
  if (/\bLine\//i.test(ua)) return 'LINE';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/Edg(e|A|iOS)?\//i.test(ua)) return 'Edge';
  if (/OPR\/|Opera/i.test(ua)) return 'Opera';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung';
  if (/CriOS|Chrome\//i.test(ua)) return 'Chrome';
  if (/FxiOS|Firefox\//i.test(ua)) return 'Firefox';
  if (/Safari\//i.test(ua)) return 'Safari';
  return 'Other';
}

export function osName(ua: string): string {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Other';
}

/** 自家網域：從這些地方來的不算外部來源（站內瀏覽、或 app 被嵌在 WordPress 頁內）。 */
function isInternalHost(host: string, ownHosts: string[]): boolean {
  return (
    ownHosts.includes(host) ||
    host === 'ai4kingdom.org' ||
    host.endsWith('.ai4kingdom.org') ||
    host.endsWith('.amplifyapp.com') ||
    host === 'localhost' ||
    host === '127.0.0.1'
  );
}

const REFERRER_GROUPS: Array<[RegExp, string]> = [
  [/(^|\.)google\./, 'Google'],
  [/(^|\.)bing\.com$/, 'Bing'],
  [/(^|\.)baidu\.com$/, 'Baidu'],
  [/(^|\.)yahoo\./, 'Yahoo'],
  [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'Facebook'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, 'X (Twitter)'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
  [/(^|\.)line\.me$/, 'LINE'],
  [/(^|\.)(weixin\.qq\.com|wechat\.com)$/, 'WeChat'],
  [/(^|\.)linkedin\.com$/, 'LinkedIn'],
  [/(^|\.)(chatgpt\.com|openai\.com)$/, 'ChatGPT'],
];

/**
 * 外部來源名稱；沒有來源回傳 '(直接造訪)'，站內來源回傳 null（不計入來源統計）。
 */
export function referrerName(ref: string, ownHosts: string[]): string | null {
  if (!ref) return '(直接造訪)';
  let host: string;
  try {
    host = new URL(ref).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return '(直接造訪)';
  if (isInternalHost(host, ownHosts)) return null;
  for (const [re, name] of REFERRER_GROUPS) {
    if (re.test(host)) return name;
  }
  return host.replace(/^(www|m|l|lm)\./, '').slice(0, 80);
}

/** 常見時區 → ISO 國碼。未列出的時區以 'tz:<時區>' 保存，管理頁直接顯示時區名稱。 */
const TZ_COUNTRY: Record<string, string> = {
  'Asia/Taipei': 'TW',
  'Asia/Shanghai': 'CN',
  'Asia/Chongqing': 'CN',
  'Asia/Harbin': 'CN',
  'Asia/Urumqi': 'CN',
  'Asia/Hong_Kong': 'HK',
  'Asia/Macau': 'MO',
  'Asia/Singapore': 'SG',
  'Asia/Kuala_Lumpur': 'MY',
  'Asia/Kuching': 'MY',
  'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR',
  'Asia/Manila': 'PH',
  'Asia/Bangkok': 'TH',
  'Asia/Jakarta': 'ID',
  'Asia/Makassar': 'ID',
  'Asia/Ho_Chi_Minh': 'VN',
  'Asia/Saigon': 'VN',
  'Asia/Yangon': 'MM',
  'Asia/Phnom_Penh': 'KH',
  'Asia/Kolkata': 'IN',
  'Asia/Calcutta': 'IN',
  'Asia/Dubai': 'AE',
  'Asia/Jerusalem': 'IL',
  'Europe/London': 'GB',
  'Europe/Dublin': 'IE',
  'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE',
  'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE',
  'Europe/Zurich': 'CH',
  'Europe/Vienna': 'AT',
  'Europe/Madrid': 'ES',
  'Europe/Rome': 'IT',
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK',
  'Europe/Helsinki': 'FI',
  'Europe/Warsaw': 'PL',
  'Europe/Prague': 'CZ',
  'Europe/Lisbon': 'PT',
  'Europe/Athens': 'GR',
  'Europe/Istanbul': 'TR',
  'Europe/Moscow': 'RU',
  'Europe/Kiev': 'UA',
  'Europe/Kyiv': 'UA',
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Phoenix': 'US',
  'America/Los_Angeles': 'US',
  'America/Anchorage': 'US',
  'America/Detroit': 'US',
  'America/Boise': 'US',
  'Pacific/Honolulu': 'US',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/Edmonton': 'CA',
  'America/Winnipeg': 'CA',
  'America/Halifax': 'CA',
  'America/Regina': 'CA',
  'America/St_Johns': 'CA',
  'America/Mexico_City': 'MX',
  'America/Sao_Paulo': 'BR',
  'America/Bogota': 'CO',
  'America/Lima': 'PE',
  'America/Santiago': 'CL',
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU',
  'Australia/Adelaide': 'AU',
  'Pacific/Auckland': 'NZ',
  'Africa/Johannesburg': 'ZA',
  'Africa/Lagos': 'NG',
  'Africa/Nairobi': 'KE',
  'Africa/Cairo': 'EG',
};

export function countryFromTimezone(tz: string): string {
  if (!tz) return 'ZZ';
  const mapped = TZ_COUNTRY[tz];
  if (mapped) return mapped;
  if (/^America\/(Indiana|Kentucky|North_Dakota)\//.test(tz)) return 'US';
  if (/^America\/Argentina\//.test(tz)) return 'AR';
  if (/^Australia\//.test(tz)) return 'AU';
  if (/^[A-Za-z_]+\/[A-Za-z_\/-]+$/.test(tz)) return `tz:${tz.slice(0, 48)}`;
  return 'ZZ';
}

/** 頁面路徑正規化：去掉查詢字串與錨點、統一結尾斜線、限制長度。 */
export function normalizePath(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  if (raw === '(404)') return raw;
  let path = raw.split(/[?#]/)[0].trim();
  if (!path.startsWith('/')) return null;
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/$/, '');
  return path.slice(0, 160);
}
