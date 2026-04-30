import type { ReactNode } from 'react';
import { AuthGate } from '@/components/shell/auth-gate';

export default function FocusLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate level="login+mandate">
      <main className="min-h-screen bg-background">{children}</main>
    </AuthGate>
  );
}
