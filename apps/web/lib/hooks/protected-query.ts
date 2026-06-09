'use client';

import { useWallet } from '../wallet/use-wallet';

interface ProtectedQueryAuthState {
  ready: boolean;
  connected: boolean;
}

export function protectedQueryEnabled(
  { ready, connected }: ProtectedQueryAuthState,
  requested = true,
): boolean {
  return requested && ready && connected;
}

export function useProtectedQueryEnabled(requested = true): boolean {
  const { ready, connected } = useWallet();
  return protectedQueryEnabled({ ready, connected }, requested);
}
