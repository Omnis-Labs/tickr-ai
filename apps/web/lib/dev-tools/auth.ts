import 'server-only';

import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

export const DEV_TOOLS_COOKIE = 'hunch_dev_tools';
export const DEV_TOOLS_DEFAULT_PASSWORD = 'Omnis-2026';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8;

export function devToolsPassword(): string {
  return process.env.DEV_TOOLS_PASSWORD || DEV_TOOLS_DEFAULT_PASSWORD;
}

export function devToolsEnabled(): boolean {
  return process.env.ENABLE_DEV_TOOLS === 'true';
}

function cookieValue(): string {
  const digest = createHash('sha256')
    .update(`hunch-it:dev-tools:${devToolsPassword()}`)
    .digest('hex');
  return `v1.${digest}`;
}

export function hasDevToolsSession(req: NextRequest): boolean {
  const value = req.cookies.get(DEV_TOOLS_COOKIE)?.value;
  return !!value && value === cookieValue();
}

export function devToolsStatus(req: NextRequest): {
  enabled: boolean;
  authenticated: boolean;
} {
  const enabled = devToolsEnabled();
  return {
    enabled,
    authenticated: enabled && hasDevToolsSession(req),
  };
}

export function devToolsGuard(req: NextRequest): NextResponse | null {
  if (!devToolsEnabled()) {
    return NextResponse.json({ error: 'dev tools disabled' }, { status: 404 });
  }
  if (!hasDevToolsSession(req)) {
    return NextResponse.json({ error: 'dev tools locked' }, { status: 401 });
  }
  return null;
}

export function createDevToolsLoginResponse(): NextResponse {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: DEV_TOOLS_COOKIE,
    value: cookieValue(),
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}

export function createDevToolsLogoutResponse(): NextResponse {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: DEV_TOOLS_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 0,
  });
  return res;
}
