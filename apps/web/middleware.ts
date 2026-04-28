import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge middleware: gate /api/* with a Privy access token unless the route is
 * explicitly public. The token itself is only *verified* inside route handlers
 * (via lib/auth/context.ts) — middleware can't run @privy-io/server-auth on
 * the Edge runtime, so we settle for a presence check + format sanity here
 * and rely on each route to call requireAuth().
 *
 * Demo mode (`NEXT_PUBLIC_DEMO_MODE=true`) bypasses entirely so the zero-cred
 * UX path keeps working without a Privy session.
 */

const PUBLIC_API_PREFIXES = [
  '/api/bars/', // historical price proxy — read-only public data
  '/api/cron/', // server-to-server cron, gated by WS_CRON_SECRET inside the handler
];

function isPublicApi(path: string): boolean {
  return PUBLIC_API_PREFIXES.some((p) => path.startsWith(p));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith('/api/')) return NextResponse.next();
  if (isPublicApi(pathname)) return NextResponse.next();

  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return NextResponse.next();

  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
