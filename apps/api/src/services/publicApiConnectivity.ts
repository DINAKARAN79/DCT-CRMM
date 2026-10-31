import { isPrivateApiHost } from './publicApiBaseUrl';

export interface PublicApiConnectivityResult {
  ok: boolean;
  status: number | null;
  reason: string;
}

export async function testPublicApiConnectivity(
  baseUrl: string,
  nodeEnv: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<PublicApiConnectivityResult> {
  let healthUrl: URL;
  try {
    const origin = new URL(baseUrl);
    if (
      (origin.protocol !== 'https:' && origin.protocol !== 'http:')
      || origin.username
      || origin.password
      || origin.search
      || origin.hash
    ) {
      return { ok: false, status: null, reason: 'The resolved API base URL is invalid.' };
    }
    if (nodeEnv === 'production' && isPrivateApiHost(origin.hostname)) {
      return { ok: false, status: null, reason: 'The resolved API host is private and cannot be tested as a public endpoint.' };
    }
    const basePath = origin.pathname.replace(/\/+$/, '');
    healthUrl = new URL(`${basePath}/api/health`, origin.origin);
  } catch {
    return { ok: false, status: null, reason: 'No valid public API base URL is available.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetcher(healthUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, status: response.status, reason: 'The API health route redirected; redirects are not followed.' };
    }
    return response.ok
      ? { ok: true, status: response.status, reason: 'API health check succeeded.' }
      : { ok: false, status: response.status, reason: `The API health route returned HTTP ${response.status}.` };
  } catch {
    return {
      ok: false,
      status: null,
      reason: controller.signal.aborted
        ? 'The API health check timed out after 5 seconds.'
        : 'The API health endpoint could not be reached.',
    };
  } finally {
    clearTimeout(timeout);
  }
}
