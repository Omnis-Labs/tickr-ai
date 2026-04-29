'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface NavItem {
  name: string;
  href: string;
  icon: string;
}

const navItems: NavItem[] = [
  { name: 'Home', href: '/', icon: 'home' },
  { name: 'Desk', href: '/desk', icon: 'monitoring' },
  { name: 'Portfolio', href: '/portfolio', icon: 'account_balance_wallet' },
  { name: 'Settings', href: '/settings', icon: 'settings' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <div className="fixed bottom-0 w-full px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] z-50 pointer-events-none flex justify-center">
      <nav 
        className="flex items-center justify-between bg-surface rounded-full p-2 w-full max-w-[400px] pointer-events-auto h-[var(--spacing-nav-height,64px)] shadow-floating"
      >
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

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
                  "material-symbols-outlined relative z-10 flex items-center justify-center text-[24px]",
                  isActive ? "text-on-primary [font-variation-settings:'FILL'_1]" : "text-primary [font-variation-settings:'FILL'_0]"
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
