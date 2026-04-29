import { NextResponse, type NextRequest } from 'next/server';

/**
 * Vercel Cron entrypoint helper. Each /api/cron/* route is a thin
 * forwarder to the ws-server, which is where the actual job runs (it has
 * the Socket.IO server, Prisma client, and Pyth/Jupiter/LLM clients
 * already wired). We keep the cron schedule in vercel.json but the
 * compute on the long-lived ws host.
 *
 * Two layers of auth:
 *   1. The public Vercel URL is gated by CRON_SECRET. Vercel adds
 *      `Authorization: Bearer $CRON_SECRET` to every triggered cron call
 *      (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 *      In dev / when CRON_SECRET is unset, we accept anything.
 *   2. The forwarded request to ws-server carries WS_CRON_SECRET, which
 *      the ws-server verifies. That secret is shared between Vercel and
 *      the ws host and never sees the public internet directly.
 */
export function verifyVercelCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${expected}`;
}

export interface ForwardOptions {
  path: `/${string}`;
  body?: Record<string, unknown>;
}

export async function forwardToWsServer(req: NextRequest, opts: ForwardOptions): Promise<NextResponse> {
  if (!verifyVercelCron(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Server-side cron forwarding uses the container-internal URL when set
  // (e.g. http://ws-server:4000 inside docker compose); falls back to the
  // public NEXT_PUBLIC_WS_URL the browser uses. Same code path works for
  // Cloud Run / Vercel because the public URL also resolves server-side.
  const wsUrl =
    process.env.WS_URL_INTERNAL ?? process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000';
  const secret = process.env.WS_CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'WS_CRON_SECRET not configured' }, { status: 500 });
  }

  const r = await fetch(`${wsUrl}${opts.path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(opts.body ?? {}),
  });

  const text = await r.text();
  const contentType = r.headers.get('content-type') ?? 'application/json';
  return new NextResponse(text, { status: r.status, headers: { 'content-type': contentType } });
}
