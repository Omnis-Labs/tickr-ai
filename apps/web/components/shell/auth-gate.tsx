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
 *
 * `useMandate` is gated on auth so it doesn't run pre-auth and cache a
 * 401-induced `{ mandate: null }` that would later misroute the user.
 * If the mandate query fails (5xx etc.) we render an explicit error
 * screen instead of leaking through to the protected children.
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
  const demo = isDemo();
  const authPassed = demo || (ready && connected && !!address);
  const needsMandate = level === 'login+mandate';
  const mandateQuery = useMandate({ enabled: authPassed && needsMandate });
  const mandate = mandateQuery.data?.mandate ?? null;

  useEffect(() => {
    if (!ready) return;
    if (!authPassed) {
      router.replace('/login');
      return;
    }
    if (!needsMandate) return;
    if (mandateQuery.isLoading) return;
    if (mandateQuery.error) return;
    if (!mandate) {
      router.replace('/mandate');
    }
  }, [
    ready,
    authPassed,
    needsMandate,
    mandate,
    mandateQuery.isLoading,
    mandateQuery.error,
    router,
  ]);

  if (!ready) return <FullScreenSpinner />;
  if (!authPassed) return <FullScreenSpinner />;
  if (needsMandate) {
    if (mandateQuery.error) {
      return <FullScreenError onRetry={() => void mandateQuery.refetch()} />;
    }
    if (mandateQuery.isLoading) return <FullScreenSpinner />;
    if (!mandate) return <FullScreenSpinner />;
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

function FullScreenError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-5 text-center">
      <span className="material-symbols-outlined text-[40px] text-negative">error</span>
      <h2 className="text-title-lg text-on-background">Couldn&apos;t load your mandate</h2>
      <p className="max-w-[320px] text-body-md text-on-surface-variant">
        Something went wrong reaching the server. Try again, or sign out and back in.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="h-11 rounded-full bg-primary px-6 text-label-lg text-on-primary"
      >
        Retry
      </button>
    </div>
  );
}
