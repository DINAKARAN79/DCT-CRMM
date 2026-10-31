import { describe, expect, it, vi } from 'vitest';
import { testPublicApiConnectivity } from './publicApiConnectivity';

describe('public API connectivity', () => {
  it('only requests the fixed health path and does not follow redirects', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));

    const result = await testPublicApiConnectivity('https://crm.example.com', 'production', fetcher);

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(fetcher).toHaveBeenCalledWith(
      new URL('https://crm.example.com/api/health'),
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    );
  });

  it('rejects private production hosts before making a request', async () => {
    const fetcher = vi.fn(async () => new Response(null));

    const result = await testPublicApiConnectivity('http://127.0.0.1:3001', 'production', fetcher);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('private');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not follow a health-route redirect', async () => {
    const fetcher = vi.fn(async () => (
      new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/admin' } })
    ));

    const result = await testPublicApiConnectivity('https://crm.example.com', 'production', fetcher);

    expect(result).toMatchObject({ ok: false, status: 302 });
    expect(result.reason).toContain('redirected');
  });

  it('keeps an explicitly configured web-proxy prefix on the health URL', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));

    await testPublicApiConnectivity('https://crm.example.com/api/proxy', 'production', fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      new URL('https://crm.example.com/api/proxy/api/health'),
      expect.any(Object),
    );
  });
});
