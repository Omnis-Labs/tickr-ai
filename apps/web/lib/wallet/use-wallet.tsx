'use client';

// Public surface — the hook every consumer goes through. Provider
// implementations live under ./providers/* and are mounted by
// components/wallet/wallet-provider.tsx based on env. This file
// intentionally has zero vendor SDK imports.

import { useContext } from 'react';
import { WalletContext, type UnifiedWallet } from './types';

export type { UnifiedWallet } from './types';
export { PrivyWalletBridge } from './providers/privy';

export function useWallet(): UnifiedWallet {
  return useContext(WalletContext);
}
