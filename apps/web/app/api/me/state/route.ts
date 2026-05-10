import { NextResponse, type NextRequest } from 'next/server';
import {
  PRIVY_ACCESS_TOKEN_COOKIE,
  privyAccessTokenFromAuthorization,
  resolveSession,
} from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

const PRIVY_COOKIE_MAX_AGE_SECONDS = 60 * 60;

export async function GET(req: NextRequest) {
  const state = await resolveSession(req);
  const res = NextResponse.json(state, {
    headers: { 'Cache-Control': 'no-store' },
  });
  const token = privyAccessTokenFromAuthorization(req);

  if (token && state.stage !== 'SIGNED_OUT') {
    res.cookies.set(PRIVY_ACCESS_TOKEN_COOKIE, token, {
      httpOnly: true,
      maxAge: PRIVY_COOKIE_MAX_AGE_SECONDS,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  } else if (token) {
    res.cookies.set(PRIVY_ACCESS_TOKEN_COOKIE, '', {
      httpOnly: true,
      maxAge: 0,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }

  return res;
}
