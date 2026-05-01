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
  // Jupiter Trigger v2 auth endpoints. The user has a Privy session
  // but no Jupiter JWT yet (the whole point of these calls is to
  // obtain one), so we can't enforce Bearer here. Other
  // /api/jupiter/* paths still get gated because by then the browser
  // does have the Jupiter JWT and sends it in Authorization. The
  // catch-all proxy already locks the upstream to /trigger/v2/* so
  // it can't be abused as an open relay beyond that namespace.
  '/api/jupiter/trigger/v2/auth/',
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
