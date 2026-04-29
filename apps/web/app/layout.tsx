import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import { AppShell } from '@/components/shell/app-shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hunch It',
  description: 'AI trading signals for tokenized US stocks on Solana',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
