export const PRIVATE_API_URL_WARNING =
  'The API base URL is not set correctly for this server. Set PUBLIC_API_BASE_URL.';

export interface PublicApiBaseInput {
  nodeEnv?: string;
  publicBaseUrl?: string;
  allowedHosts?: string;
  trustProxy?: boolean;
  protocol?: string;
  host?: string;
  forwardedProto?: string;
  forwardedHost?: string;
}

export interface PublicApiBaseUrl {
  baseUrl: string;
  source: 'env' | 'request' | 'rejected';
  privateHost: boolean;
  warning: string | null;
}

interface HostParts {
  hostname: string;
  port?: string;
}

function firstHeaderValue(value?: string) {
  return (value || '').split(',')[0]?.trim() || '';
}

function splitHost(value: string): HostParts | null {
  const raw = value.trim();
  if (!raw || raw.includes('/') || raw.includes(' ') || raw.includes('@')) return null;
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end <= 1) return null;
    const hostname = raw.slice(1, end);
    const rest = raw.slice(end + 1);
    if (rest && !rest.startsWith(':')) return null;
    const port = rest.slice(1);
    if (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) return null;
    return { hostname, port: port || undefined };
  }
  const colon = raw.lastIndexOf(':');
  if (colon > -1 && raw.indexOf(':') === colon) {
    const hostname = raw.slice(0, colon);
    const port = raw.slice(colon + 1);
    if (!hostname || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) return null;
    return { hostname, port };
  }
  if (!/^[a-zA-Z0-9.-]+$/.test(raw)) return null;
  return { hostname: raw };
}

function protocolOf(value?: string) {
  const protocol = firstHeaderValue(value).toLowerCase().replace(/:$/, '');
  return protocol === 'https' ? 'https' : 'http';
}

function originFrom(protocol: string, parts: HostParts) {
  const proto = protocol === 'https' ? 'https' : 'http';
  const defaultPort = proto === 'https' ? '443' : '80';
  const port = parts.port && parts.port !== defaultPort ? `:${parts.port}` : '';
  const hostname = parts.hostname.includes(':') ? `[${parts.hostname}]` : parts.hostname;
  return `${proto}://${hostname}${port}`;
}

export function isPrivateApiHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true;
  if (host.endsWith('.local')) return true;
  const mappedIpv4 = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (mappedIpv4) return isPrivateApiHost(mappedIpv4);
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b, c, d] = ipv4.slice(1).map(Number);
    if ([a, b, c, d].some((part) => part > 255)) return true;
    return a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || a === 0;
  }
  if (host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  return false;
}

function envOrigin(value?: string): { baseUrl: string; parts: HostParts } | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (
      url.username
      || url.password
      || url.search
      || url.hash
      || (url.protocol !== 'http:' && url.protocol !== 'https:')
    ) return null;
    const parts = splitHost(url.host);
    if (!parts) return null;
    const path = url.pathname.replace(/\/+$/, '');
    return { baseUrl: `${originFrom(url.protocol.replace(':', ''), parts)}${path}`, parts };
  } catch {
    return null;
  }
}

function allowlistEntries(input: PublicApiBaseInput) {
  const entries = (input.allowedHosts || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const fromEnv = envOrigin(input.publicBaseUrl);
  if (fromEnv) entries.push(fromEnv.parts.port ? `${fromEnv.parts.hostname.toLowerCase()}:${fromEnv.parts.port}` : fromEnv.parts.hostname.toLowerCase());
  return entries;
}

function hostAllowed(parts: HostParts, input: PublicApiBaseInput, protocol: string) {
  const hostname = parts.hostname.toLowerCase();
  const development = input.nodeEnv !== 'production';
  if (development && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.local') || isPrivateApiHost(hostname))) {
    return true;
  }
  return allowlistEntries(input).some((entry) => {
    const allowed = splitHost(entry);
    if (!allowed) return false;
    if (allowed.hostname.toLowerCase() !== hostname) return false;
    if (allowed.port) return allowed.port === parts.port;
    if (!parts.port) return true;
    return parts.port === (protocol === 'https' ? '443' : '80');
  });
}

function rejected(warning: string): PublicApiBaseUrl {
  return { baseUrl: '', source: 'rejected', privateHost: false, warning };
}

export function getPublicApiBaseUrl(input: PublicApiBaseInput): PublicApiBaseUrl {
  const configured = envOrigin(input.publicBaseUrl);
  if ((input.publicBaseUrl || '').trim()) {
    if (!configured) return rejected('PUBLIC_API_BASE_URL is not a valid http(s) origin.');
    const privateHost = isPrivateApiHost(configured.parts.hostname);
    return {
      baseUrl: configured.baseUrl,
      source: 'env',
      privateHost,
      warning: privateHost ? PRIVATE_API_URL_WARNING : null,
    };
  }

  const trustForwarded = Boolean(input.trustProxy);
  const hostHeader = trustForwarded
    ? firstHeaderValue(input.forwardedHost) || input.host || ''
    : input.host || '';
  const protocol = trustForwarded
    ? protocolOf(firstHeaderValue(input.forwardedProto) || input.protocol)
    : protocolOf(input.protocol);
  const parts = splitHost(hostHeader);
  if (!parts || !parts.hostname) {
    return rejected('Set PUBLIC_API_BASE_URL before sharing links.');
  }
  if (!hostAllowed(parts, input, protocol)) {
    return rejected('The detected host is not on the allowlist. Set PUBLIC_API_BASE_URL before sharing links.');
  }
  const privateHost = isPrivateApiHost(parts.hostname);
  return {
    baseUrl: originFrom(protocol, parts),
    source: 'request',
    privateHost,
    warning: privateHost ? PRIVATE_API_URL_WARNING : null,
  };
}
