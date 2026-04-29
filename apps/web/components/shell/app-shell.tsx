'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { BottomNav } from './bottom-nav';

/**
 * Mounts the global BottomNav on every screen except the marketing
 * landing (/) and the login flow (/login). Keeping the decision client-
 * side lets us avoid moving every page into a route-group layout.
 *
 * Add new "no-nav" routes to NAVLESS_PATHS as they appear.
 */
const NAVLESS_PATHS = ['/', '/login', '/offline'];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  const showNav = !NAVLESS_PATHS.includes(pathname);

  return (
    <>
      {children}
      {showNav && <BottomNav />}
    </>
  );
}
