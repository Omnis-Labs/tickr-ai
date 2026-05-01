import { NextResponse, type NextRequest } from 'next/server';

/**
 * Jupiter Trigger v2 server-side proxy.
 *
 * Browser CAN'T call api.jup.ag directly: Jupiter's CORS preflight
 * doesn't allow the `x-api-key` header from cross-origin clients,
 * which is also Jupiter's intended design — the api key is meant to
 * stay server-side. So the web app calls /api/jupiter/<path> on its
 * own origin, and this proxy forwards everything (with the api key
 * attached server-side) to api.jup.ag.
 *
 * Auth flow:
 *   - Challenge / verify endpoints need only x-api-key. The browser's
 *     auth lib POSTs the signed challenge through here; the proxy
 *     adds x-api-key and forwards.
 *   - User-scoped endpoints (vault, deposit/craft, orders/price,
 *     cancel, history) need x-api-key + Authorization Bearer JWT.
 *     The browser obtains the JWT after challenge/verify and sends it
 *     in Authorization on each request; we add x-api-key alongside
 *     and forward.
 *
 * Path: every Trigger v2 path is preserved 1:1, e.g.
 *   browser:  POST /api/jupiter/trigger/v2/orders/price
 *   proxy →   POST https://api.jup.ag/trigger/v2/orders/price
 */

const JUPITER_BASE = process.env.NEXT_PUBLIC_JUPITER_API_BASE_V2 ?? 'https://api.jup.ag';

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const apiKey = process.env.NEXT_PUBLIC_JUPITER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'NEXT_PUBLIC_JUPITER_API_KEY not configured on server' },
      { status: 500 },
    );
  }

  const { path } = await ctx.params;
  if (!path?.length) {
    return NextResponse.json({ error: 'missing path' }, { status: 400 });
  }
  // Lock down the proxy to Trigger v2 — we don't want to inadvertently
  // proxy arbitrary Jupiter URLs from a malicious client.
  if (path[0] !== 'trigger') {
    return NextResponse.json({ error: 'unsupported path' }, { status: 400 });
  }

  const targetPath = '/' + path.join('/');
  const search = req.nextUrl.search;
  const targetUrl = `${JUPITER_BASE}${targetPath}${search}`;

  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    accept: 'application/json',
  };
  const auth = req.headers.get('authorization');
  if (auth) headers.authorization = auth;
  const contentType = req.headers.get('content-type');
  if (contentType) headers['content-type'] = contentType;

  const init: RequestInit = {
    method: req.method,
    headers,
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text();
  }

  let res: Response;
  try {
    res = await fetch(targetUrl, init);
  } catch (err) {
    console.warn(`[jupiter-proxy] ${req.method} ${targetPath} fetch failed`, err);
    return NextResponse.json({ error: 'upstream unreachable' }, { status: 502 });
  }

  const body = await res.text();
  const responseContentType = res.headers.get('content-type') ?? 'application/json';
  return new NextResponse(body, {
    status: res.status,
    headers: { 'content-type': responseContentType },
  });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
