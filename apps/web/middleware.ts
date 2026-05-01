import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge middleware:
 *   - Gate /api/* with a Privy access token unless the route is explicitly
 *     public. The token itself is only *verified* inside route handlers
 *     (via lib/auth/context.ts) — middleware can't run @privy-io/server-auth
 *     on the Edge runtime, so we settle for a presence check + format sanity
 *     here and rely on each route to call requireAuth().
 *   - Hide /dev-tools/* in production builds so the manual debug surface
 *     never reaches end users. Dev (`NODE_ENV !== 'production'`) renders it.
 *
 * Demo mode (`NEXT_PUBLIC_DEMO_MODE=true`) bypasses the API auth check so the
 * zero-cred UX path keeps working without a Privy session. The dev-tools gate
 * is independent of demo mode — production is production.
 */

const PUBLIC_API_PREFIXES = [
  '/api/bars/', // historical price proxy — read-only public data
];

function isPublicApi(path: string): boolean {
  return PUBLIC_API_PREFIXES.some((p) => path.startsWith(p));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/dev-tools')) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.rewrite(new URL('/404', req.url));
    }
    return NextResponse.next();
  }

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
  matcher: ['/api/:path*', '/dev-tools/:path*'],
};
