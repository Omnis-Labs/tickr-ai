'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { appNavigationItems, isAppNavigationItemActive } from './navigation';

export function BottomNav() {
  const pathname = usePathname();

  return (
    <div className="fixed bottom-0 z-50 flex w-full justify-center px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pointer-events-none lg:hidden">
      <nav className="flex items-center justify-between bg-surface rounded-full p-2 w-full max-w-[400px] pointer-events-auto h-[var(--spacing-nav-height,64px)] shadow-floating">
        {appNavigationItems.map((item) => {
          const isActive = isAppNavigationItemActive(pathname, item);

          return (
            <Link
              key={item.href}
              href={item.href}
              className="relative flex items-center justify-center rounded-full w-12 h-12"
              aria-label={item.name}
            >
              {isActive && (
                <motion.div
                  layoutId="bottom-nav-active-indicator"
                  className="absolute inset-0 bg-primary rounded-full"
                  initial={false}
                  transition={{
                    type: 'spring',
                    stiffness: 400,
                    damping: 30,
                  }}
                />
              )}

              <motion.span
                whileTap={{ scale: 0.9 }}
                className={cn(
                  'material-symbols-outlined relative z-10 flex items-center justify-center text-[24px]',
                  isActive
                    ? "text-on-primary [font-variation-settings:'FILL'_1]"
                    : "text-primary [font-variation-settings:'FILL'_0]",
                )}
              >
                {item.icon}
              </motion.span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
