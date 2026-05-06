import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  isGatedPagePath,
  redirectPathForPage,
  REQUEST_PATHNAME_HEADER,
} from '@/lib/auth/page-gate';
import { resolveSessionFromCookies } from '@/lib/auth/session';

async function enforceSessionGateForPage() {
  const requestHeaders = await headers();
  const pathname = requestHeaders.get(REQUEST_PATHNAME_HEADER);
  if (!pathname || !isGatedPagePath(pathname)) return;

  const session = await resolveSessionFromCookies();
  const redirectTo = redirectPathForPage(pathname, session);
  if (redirectTo) redirect(redirectTo);
}

export default async function RootTemplate({ children }: { children: ReactNode }) {
  await enforceSessionGateForPage();
  return children;
}
