export const DELEGATED_EXECUTION_AUTHORIZATION_PRIVATE_KEY_ENV =
  'PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY' as const;

export const DELEGATED_EXECUTION_AUTHORIZATION_SIGNER_ID_ENVS = [
  'PRIVY_WALLET_AUTHORIZATION_SIGNER_ID',
  'NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_SIGNER_ID',
] as const;

export type DelegatedExecutionReadinessBlocker =
  | 'missing_privy_authorization_private_key'
  | 'privy_wallet_not_delegated'
  | 'missing_privy_authorization_signer_id'
  | 'wallet_missing_authorization_signer'
  | 'wallet_not_delegated'
  | 'privy_wallet_not_solana';

export interface DelegatedExecutionResolvedWallet {
  walletId: string | null;
  walletChainType: string | null;
  delegated: boolean | null;
  walletClientType: string | null;
  connectorType: string | null;
  additionalSignerIds: string[];
  ownerId: string | null;
  policyIds: string[];
  authorizationThreshold: number | null;
  resolveError: string | null;
}

export interface DelegatedExecutionReadinessStatus {
  ok: true;
  serverKey: {
    configured: boolean;
    env: typeof DELEGATED_EXECUTION_AUTHORIZATION_PRIVATE_KEY_ENV;
  };
  serverSigner: {
    configured: boolean;
    env: typeof DELEGATED_EXECUTION_AUTHORIZATION_SIGNER_ID_ENVS[number][];
    walletMatched: boolean;
  };
  wallet: {
    address: string;
    privyWalletId: string | null;
    delegated: boolean | null;
    walletClientType: string | null;
    connectorType: string | null;
    additionalSignerIds: string[];
    ownerId: string | null;
    policyIds: string[];
    authorizationThreshold: number | null;
    resolveError: string | null;
  };
  ready: {
    canExecute: boolean;
    blockers: DelegatedExecutionReadinessBlocker[];
  };
}

export function getDelegatedExecutionAuthorizationSignerId(
  getEnv: (name: string) => string | null | undefined,
): string | null {
  for (const key of DELEGATED_EXECUTION_AUTHORIZATION_SIGNER_ID_ENVS) {
    const value = getEnv(key)?.trim();
    if (value) return value;
  }
  return null;
}

export function delegatedExecutionReadinessStatus(input: {
  walletAddress: string;
  resolved: DelegatedExecutionResolvedWallet;
  serverKeyConfigured: boolean;
  authorizationSignerId: string | null;
}): DelegatedExecutionReadinessStatus {
  const blockers: DelegatedExecutionReadinessBlocker[] = [];
  const signerConfigured = input.authorizationSignerId !== null;
  const signerMatched = input.authorizationSignerId
    ? input.resolved.additionalSignerIds.includes(input.authorizationSignerId)
    : false;

  if (!input.serverKeyConfigured) blockers.push('missing_privy_authorization_private_key');
  if (!input.resolved.walletId) blockers.push('privy_wallet_not_delegated');
  if (!signerConfigured) blockers.push('missing_privy_authorization_signer_id');
  if (signerConfigured && !signerMatched) {
    blockers.push('wallet_missing_authorization_signer');
  }
  if (!signerMatched) blockers.push('wallet_not_delegated');
  if (input.resolved.walletId && input.resolved.walletChainType !== 'solana') {
    blockers.push('privy_wallet_not_solana');
  }

  return {
    ok: true,
    serverKey: {
      configured: input.serverKeyConfigured,
      env: DELEGATED_EXECUTION_AUTHORIZATION_PRIVATE_KEY_ENV,
    },
    serverSigner: {
      configured: signerConfigured,
      env: [...DELEGATED_EXECUTION_AUTHORIZATION_SIGNER_ID_ENVS],
      walletMatched: signerMatched,
    },
    wallet: {
      address: input.walletAddress,
      privyWalletId: input.resolved.walletId,
      delegated: input.resolved.delegated,
      walletClientType: input.resolved.walletClientType,
      connectorType: input.resolved.connectorType,
      additionalSignerIds: input.resolved.additionalSignerIds,
      ownerId: input.resolved.ownerId,
      policyIds: input.resolved.policyIds,
      authorizationThreshold: input.resolved.authorizationThreshold,
      resolveError: input.resolved.resolveError,
    },
    ready: {
      canExecute: blockers.length === 0,
      blockers,
    },
  };
}
