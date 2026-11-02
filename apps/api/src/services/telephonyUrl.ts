export const DEFAULT_CLICK_TO_CALL_URL = 'https://bizcall.cxteletech.com/api/integration/click2call';
export const DEFAULT_DIALPAD_URL = process.env.DIALPAD_URL?.trim() || 'https://bizcall.cxteletech.com/embed/dialpad';

export class TelephonyUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelephonyUrlError';
  }
}

export function isPrivateHostname(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '::1' ||
    host === '0.0.0.0'
  ) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((part) => part > 255)) return true;
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (host.includes(':')) {
    const head = host.split(':')[0] || '';
    if (head === 'fc' || head === 'fd' || head.startsWith('fc') || head.startsWith('fd') || head.startsWith('fe80')) {
      return true;
    }
  }
  return false;
}

export function migrateClickToCallUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_CLICK_TO_CALL_URL;
  if (/\/api\/(?:dialer|integration)\/click2call$/i.test(trimmed)) return trimmed;
  return `${trimmed}/api/integration/click2call`;
}

export function assertClickToCallUrl(
  value: string,
  options: { env?: string; allowTestUrl?: boolean } = {},
) {
  const env = options.env ?? process.env.NODE_ENV;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new TelephonyUrlError('Enter the full click-to-call URL.');
  }
  if (url.username || url.password) {
    throw new TelephonyUrlError('The click-to-call URL cannot include a username or password.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TelephonyUrlError('Enter the full click-to-call URL.');
  }
  if ([...url.searchParams.keys()].some((key) => key.toLowerCase() === 'api_key')) {
    throw new TelephonyUrlError('Do not put the Bizcall API key in the URL. Configure it in the API-key header.');
  }
  if (env === 'production' && url.protocol !== 'https:') {
    throw new TelephonyUrlError('The click-to-call URL must use HTTPS.');
  }
  const blockedHost = isPrivateHostname(url.hostname);
  const testException = env === 'development' && options.allowTestUrl === true && blockedHost;
  if (blockedHost && !testException) {
    throw new TelephonyUrlError('The click-to-call URL cannot use localhost or a private network address.');
  }
  return url.toString();
}

export function assertDialpadUrl(value: string, options: { env?: string } = {}) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new TelephonyUrlError('Enter the full dialpad URL.');
  }
  if (url.username || url.password || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    throw new TelephonyUrlError('Enter a valid dialpad URL.');
  }
  if (url.hostname.toLowerCase() !== 'bizcall.cxteletech.com') {
    throw new TelephonyUrlError('The dialpad URL must use the approved Bizcall host.');
  }
  const env = options.env ?? process.env.NODE_ENV;
  if (env === 'production' && (url.protocol !== 'https:' || isPrivateHostname(url.hostname))) {
    throw new TelephonyUrlError('The dialpad URL must use HTTPS and a public host.');
  }
  if (url.protocol === 'http:' && !(env === 'development' && isPrivateHostname(url.hostname))) {
    throw new TelephonyUrlError('The dialpad URL must use HTTPS.');
  }
  return url.toString();
}

export function dialpadOrigin(value: string) {
  return new URL(value).origin;
}
