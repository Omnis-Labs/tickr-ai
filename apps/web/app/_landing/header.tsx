'use client';

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function LandingHeader() {
  const [isScrolled, setIsScrolled] = React.useState(false);

  React.useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-colors duration-fast ease-soft',
        isScrolled
          ? 'bg-background/95 backdrop-blur-sm shadow-hairline'
          : 'bg-transparent',
      )}
    >
      <div className="max-w-screen-xl mx-auto px-5 h-[72px] flex items-center justify-between">
        <Link
          href="/"
          className="text-title-lg font-bold tracking-tight text-on-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xs"
        >
          Hunch It
        </Link>

        <div className="flex items-center gap-4">
          <Button variant="accent" size="sm" asChild>
            <Link href="/login">Get Started</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
