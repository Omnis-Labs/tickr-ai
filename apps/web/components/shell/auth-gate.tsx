'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/wallet/use-wallet';
import { useMandate } from '@/lib/hooks/queries';
import { isDemo } from '@/lib/demo/flag';

/**
 * Client-side gate used by `(app)/layout.tsx` and `(focus)/layout.tsx`.
 * Decides three things and redirects accordingly:
 *
 *   1. Privy still hydrating       → render <FullScreenSpinner />, no redirect.
 *   2. Not authenticated           → router.replace('/login').
 *   3. Authenticated but no mandate (and `level === 'login+mandate'`)
 *                                   → router.replace('/mandate').
 *
 * Demo mode bypasses the wallet check entirely so the zero-cred UX path
 * keeps rendering populated screens.
 *
 * `(auth)/login/page.tsx` and `(auth)/mandate/page.tsx` each carry their
 * own intent-specific routing logic, so `(auth)/layout.tsx` does NOT mount
 * this gate to avoid redirect loops.
 */
export type AuthGateLevel = 'login' | 'login+mandate';

export function AuthGate({
  level,
  children,
}: {
  level: AuthGateLevel;
  children: ReactNode;
}) {
  const router = useRouter();
  const { ready, connected, address } = useWallet();
  const mandateQuery = useMandate();
  const mandate = mandateQuery.data?.mandate ?? null;
  const demo = isDemo();

  const authPassed = demo || (ready && connected && !!address);
  const mandatePassed = level === 'login' || mandate !== null;

  useEffect(() => {
    if (!ready) return;
    if (!authPassed) {
      router.replace('/login');
      return;
    }
    if (level === 'login') return;
    if (mandateQuery.isLoading) return;
    // Surface 5xx by staying put — the inner page can show its own error UI
    // once we render children. We only redirect on the explicit "no mandate"
    // (HTTP 200 + null body) success-with-empty case.
    if (mandateQuery.error) return;
    if (!mandate) {
      router.replace('/mandate');
    }
  }, [
    ready,
    authPassed,
    level,
    mandate,
    mandateQuery.isLoading,
    mandateQuery.error,
    router,
  ]);

  if (!ready) return <FullScreenSpinner />;
  if (!authPassed) return <FullScreenSpinner />;
  if (level === 'login+mandate') {
    if (mandateQuery.isLoading) return <FullScreenSpinner />;
    if (!mandatePassed && !mandateQuery.error) return <FullScreenSpinner />;
  }
  return <>{children}</>;
}

function FullScreenSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
    </div>
  );
}
