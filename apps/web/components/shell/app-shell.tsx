'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { BottomNav } from './bottom-nav';
import {
  type AppNavigationItem,
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
  const settingsItem: AppNavigationItem = { name: 'Settings', href: '/settings', icon: 'settings' };
  const settingsActive = pathname === settingsItem.href;

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] bg-background px-5 py-5 lg:flex lg:flex-col">
      <nav
        className="flex min-h-0 flex-1 flex-col rounded-[32px] bg-surface p-2 shadow-floating"
        aria-label="Primary"
      >
        <div className="flex flex-col gap-2">
          {appNavigationItems.map((item) => (
            <DesktopNavLink
              key={item.href}
              item={item}
              active={isAppNavigationItemActive(pathname, item)}
            />
          ))}
        </div>

        <div className="mt-auto border-t border-divider pt-2">
          <DesktopNavLink item={settingsItem} active={settingsActive} />
        </div>
      </nav>
    </aside>
  );
}

function DesktopNavLink({ item, active }: { item: AppNavigationItem; active: boolean }) {
  return (
    <Link
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
          active ? "[font-variation-settings:'FILL'_1]" : "[font-variation-settings:'FILL'_0]",
        )}
        aria-hidden="true"
      >
        {item.icon}
      </span>
      <span>{item.name}</span>
    </Link>
  );
}
