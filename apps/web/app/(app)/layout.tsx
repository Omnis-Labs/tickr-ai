import type { ReactNode } from 'react';
import { AuthGate } from '@/components/shell/auth-gate';
import { BottomNav } from '@/components/shell/bottom-nav';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate level="login+mandate">
      <div className="relative flex min-h-screen flex-col bg-background">
        <main className="flex-1 pb-[calc(var(--spacing-nav-height,64px)+2rem+env(safe-area-inset-bottom))]">
          {children}
        </main>
        <BottomNav />
      </div>
    </AuthGate>
  );
}
