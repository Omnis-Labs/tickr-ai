'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { BottomNav } from './bottom-nav';
import {
  appNavigationItems,
  isAppNavigationItemActive,
  shouldShowAppNavigation,
} from './navigation';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  const showNav = shouldShowAppNavigation(pathname);

  return (
    <div className={cn(showNav && 'lg:min-h-screen lg:pl-[248px]')}>
      {showNav && <DesktopNav pathname={pathname} />}
      {children}
      {showNav && <BottomNav />}
    </div>
  );
}

function DesktopNav({ pathname }: { pathname: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] bg-background px-5 py-5 lg:flex lg:flex-col">
      <Link
        href="/desk"
        aria-label="Go to Home"
        className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-surface text-primary shadow-micro transition-colors hover:bg-surface-container"
      >
        <span
          className="material-symbols-outlined text-[22px] [font-variation-settings:'FILL'_1]"
          aria-hidden="true"
        >
          home
        </span>
      </Link>

      <nav
        className="flex flex-1 flex-col gap-2 rounded-[32px] bg-surface p-2 shadow-floating"
        aria-label="Primary"
      >
        {appNavigationItems.map((item) => {
          const active = isAppNavigationItemActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex h-12 items-center gap-3 rounded-full px-3 text-label-lg transition-colors',
                active
                  ? 'bg-primary text-on-primary'
                  : 'text-on-surface-variant hover:bg-surface-container hover:text-primary',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <span
                className={cn(
                  'material-symbols-outlined text-[22px]',
                  active
                    ? "[font-variation-settings:'FILL'_1]"
                    : "[font-variation-settings:'FILL'_0]",
                )}
                aria-hidden="true"
              >
                {item.icon}
              </span>
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <Link
        href="/settings"
        className={cn(
          'mt-4 flex h-12 items-center gap-3 rounded-full px-3 text-label-lg shadow-micro transition-colors',
          pathname === '/settings'
            ? 'bg-primary text-on-primary'
            : 'bg-surface text-on-surface-variant hover:bg-surface-container hover:text-primary',
        )}
        aria-current={pathname === '/settings' ? 'page' : undefined}
      >
        <span
          className={cn(
            'material-symbols-outlined text-[22px]',
            pathname === '/settings'
              ? "[font-variation-settings:'FILL'_1]"
              : "[font-variation-settings:'FILL'_0]",
          )}
          aria-hidden="true"
        >
          settings
        </span>
        <span>Settings</span>
      </Link>
    </aside>
  );
}
