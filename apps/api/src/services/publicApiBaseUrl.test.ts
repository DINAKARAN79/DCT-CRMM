import { describe, expect, it } from 'vitest';
import { PRIVATE_API_URL_WARNING, getPublicApiBaseUrl } from './publicApiBaseUrl';

describe('public API base URL', () => {
  it('uses PUBLIC_API_BASE_URL and preserves a configured proxy path', () => {
    const resolved = getPublicApiBaseUrl({
      nodeEnv: 'production',
      publicBaseUrl: 'https://api.yourdomain.com/api/proxy/',
      host: 'evil.example',
      protocol: 'http',
      forwardedHost: 'also-evil.example',
      forwardedProto: 'http',
      trustProxy: true,
    });
    expect(resolved).toMatchObject({
      baseUrl: 'https://api.yourdomain.com/api/proxy',
      source: 'env',
      privateHost: false,
      warning: null,
    });
    expect(resolved.baseUrl).not.toContain('evil.example');
  });

  it('uses forwarded host and proto behind a trusted proxy and omits port 443', () => {
    const resolved = getPublicApiBaseUrl({
      nodeEnv: 'production',
      allowedHosts: 'api.example.com',
      trustProxy: true,
      protocol: 'http',
      host: 'localhost:3001',
      forwardedProto: 'https,http',
      forwardedHost: 'api.example.com:443',
    });
    expect(resolved).toMatchObject({
      baseUrl: 'https://api.example.com',
      source: 'request',
      privateHost: false,
      warning: null,
    });
    expect(resolved.baseUrl).not.toContain(':443');
    expect(resolved.baseUrl).not.toContain('localhost');
  });

  it('detects a direct localhost request and shows the external warning', () => {
    const resolved = getPublicApiBaseUrl({
      nodeEnv: 'development',
      trustProxy: false,
      protocol: 'http',
      host: 'localhost:3001',
      forwardedHost: 'api.example.com',
      forwardedProto: 'https',
    });
    expect(resolved).toMatchObject({
      baseUrl: 'http://localhost:3001',
      source: 'request',
      privateHost: true,
      warning: PRIVATE_API_URL_WARNING,
    });
    expect(resolved.baseUrl).not.toContain('api.example.com');
  });

  it('never puts a spoofed production host into the URL', () => {
    const resolved = getPublicApiBaseUrl({
      nodeEnv: 'production',
      trustProxy: false,
      protocol: 'https',
      host: 'evil.example',
      forwardedHost: 'evil.example',
      forwardedProto: 'https',
    });
    expect(resolved.baseUrl).toBe('');
    expect(resolved.source).toBe('rejected');
    expect(JSON.stringify(resolved)).not.toContain('evil.example');
  });

  it('ignores forwarded headers when the proxy is not trusted', () => {
    const resolved = getPublicApiBaseUrl({
      nodeEnv: 'production',
      allowedHosts: 'crm.example.com',
      trustProxy: false,
      protocol: 'https',
      host: 'crm.example.com:443',
      forwardedHost: 'evil.example',
      forwardedProto: 'http',
    });
    expect(resolved.baseUrl).toBe('https://crm.example.com');
  });

  it('omits the default HTTP port and rejects private production hosts', () => {
    const publicOrigin = getPublicApiBaseUrl({
      nodeEnv: 'production',
      allowedHosts: 'crm.example.com',
      protocol: 'http',
      host: 'crm.example.com:80',
    });
    expect(publicOrigin.baseUrl).toBe('http://crm.example.com');

    const privateOrigin = getPublicApiBaseUrl({
      nodeEnv: 'production',
      allowedHosts: '192.168.1.12',
      protocol: 'https',
      host: '192.168.1.12',
    });
    expect(privateOrigin.privateHost).toBe(true);
    expect(privateOrigin.warning).toBe(PRIVATE_API_URL_WARNING);
  });

  it('does not allow a nonstandard port without an explicit allowlist entry', () => {
    const resolved = getPublicApiBaseUrl({
      nodeEnv: 'production',
      allowedHosts: 'crm.example.com',
      trustProxy: true,
      protocol: 'https',
      host: 'crm.example.com',
      forwardedHost: 'crm.example.com:444',
      forwardedProto: 'https',
    });
    expect(resolved.source).toBe('rejected');
    expect(resolved.baseUrl).toBe('');
  });
});
