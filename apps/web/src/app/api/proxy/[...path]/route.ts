import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3001';

async function proxyRequest(
  method: string,
  path: string,
  request: NextRequest
) {
  const cookieHeader = request.headers.get('cookie') || '';

  const headers: Record<string, string> = {
    cookie: cookieHeader,
  };
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.replace(':', '');
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedHost) headers['x-forwarded-host'] = forwardedHost;
  if (forwardedProto) headers['x-forwarded-proto'] = forwardedProto;
  if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;
  const authorizationHeader = request.headers.get('authorization');
  if (authorizationHeader) {
    headers.authorization = authorizationHeader;
  }
  const sessionAuthHeader = request.headers.get('x-session-auth');
  if (sessionAuthHeader) {
    headers['x-session-auth'] = sessionAuthHeader;
  }

  const contentType = request.headers.get('content-type');
  if (contentType) {
    headers['content-type'] = contentType;
  }

  const greSessionHeader = request.headers.get('x-gre-session');
  if (greSessionHeader) {
    headers['x-gre-session'] = greSessionHeader;
  }

  const init: RequestInit = {
    method,
    headers,
    cache: 'no-store',
  };

  if (method !== 'GET' && method !== 'HEAD') {
    // Forward the body as raw bytes. Decoding it with request.text() would
    // reinterpret binary payloads (e.g. multipart file uploads) as UTF-8 and
    // replace invalid sequences with U+FFFD, corrupting the uploaded file.
    init.body = Buffer.from(await request.arrayBuffer());
  }

  const url = new URL(request.url);
  const searchParams = url.searchParams.toString();
  const targetUrl = `${BACKEND_URL}/${path}${searchParams ? `?${searchParams}` : ''}`;

  const response = await fetch(targetUrl, init);

  const responseDataContentType = response.headers.get('content-type') || '';
  if (responseDataContentType.includes('text/event-stream') && response.body) {
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }
  const isBinary = responseDataContentType.startsWith('image/') ||
    responseDataContentType.startsWith('application/octet-stream') ||
    responseDataContentType.includes('pdf') ||
    responseDataContentType.includes('zip');

  let res: NextResponse;

  if (isBinary) {
    const buffer = Buffer.from(await response.arrayBuffer());
    res = new NextResponse(buffer, {
      status: response.status,
      statusText: response.statusText,
    });
  } else {
    const data = await response.text();
    res = new NextResponse(data, {
      status: response.status,
      statusText: response.statusText,
    });
  }

  const setCookieHeader = response.headers.get('set-cookie');
  if (setCookieHeader) {
    res.headers.set('set-cookie', setCookieHeader);
  }

  if (responseDataContentType) {
    res.headers.set('content-type', responseDataContentType);
  }
  const upstreamCache = response.headers.get('cache-control');
  if (path.includes('api-key') || path.includes('api-reference/base-url')) {
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.headers.set('Pragma', 'no-cache');
  } else if (path.includes('active-users')) {
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  } else if (upstreamCache) {
    res.headers.set('Cache-Control', upstreamCache);
  }

  return res;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    return await proxyRequest('GET', path, request);
  } catch (error) {
    console.error('Proxy GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Unable to connect to backend service' },
      { status: 502 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    return await proxyRequest('POST', path, request);
  } catch (error) {
    console.error('Proxy POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Unable to connect to backend service' },
      { status: 502 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    return await proxyRequest('PUT', path, request);
  } catch (error) {
    console.error('Proxy PUT error:', error);
    return NextResponse.json(
      { success: false, error: 'Unable to connect to backend service' },
      { status: 502 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    return await proxyRequest('DELETE', path, request);
  } catch (error) {
    console.error('Proxy DELETE error:', error);
    return NextResponse.json(
      { success: false, error: 'Unable to connect to backend service' },
      { status: 502 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    return await proxyRequest('PATCH', path, request);
  } catch (error) {
    console.error('Proxy PATCH error:', error);
    return NextResponse.json(
      { success: false, error: 'Unable to connect to backend service' },
      { status: 502 }
    );
  }
}