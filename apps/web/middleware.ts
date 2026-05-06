import { NextResponse, type NextRequest } from 'next/server';
import { REQUEST_PATHNAME_HEADER } from './lib/auth/page-gate';

/**
 * Edge middleware: gate /api/* with a Privy access token unless the route is
 * explicitly public, and pass page pathnames into the server render so the
 * RootLayout can enforce SessionGate before protected pages render. The token
 * itself is only *verified* inside route handlers and server components (via
 * lib/auth/context.ts and lib/auth/session.ts) — middleware can't run
 * @privy-io/server-auth on the Edge runtime.
 *
 * Demo mode (`NEXT_PUBLIC_DEMO_MODE=true`) bypasses entirely so the zero-cred
 * UX path keeps working without a Privy session.
 */

const PUBLIC_API_PREFIXES = [
  '/api/bars/', // historical price proxy — read-only public data
  '/api/me/state', // SessionGate state resolver returns SIGNED_OUT without a bearer
];

function isPublicApi(path: string): boolean {
  return PUBLIC_API_PREFIXES.some((p) => path.startsWith(p));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith('/api/')) {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set(REQUEST_PATHNAME_HEADER, pathname);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (isPublicApi(pathname)) return NextResponse.next();

  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return NextResponse.next();

  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*', '/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
