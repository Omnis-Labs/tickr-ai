import 'server-only';

import { PrivyClient, type LinkedAccount, type User, type Wallet } from '@privy-io/node';
import type { AuthContext } from '@/lib/auth/context';

const AUTHORIZATION_PRIVATE_KEY_ENV_KEY = 'PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY' as const;
const AUTHORIZATION_SIGNER_ID_ENV_KEYS = [
  'PRIVY_WALLET_AUTHORIZATION_SIGNER_ID',
  'NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_SIGNER_ID',
] as const;

let cachedPrivyClient: PrivyClient | null = null;

export interface DelegatedExecutionStatus {
  ok: true;
  serverKey: {
    configured: boolean;
    env: typeof AUTHORIZATION_PRIVATE_KEY_ENV_KEY;
  };
  serverSigner: {
    configured: boolean;
    env: (typeof AUTHORIZATION_SIGNER_ID_ENV_KEYS)[number][];
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
    blockers: string[];
  };
}

interface ResolvedPrivyWallet {
  wallet: Wallet | null;
  delegated: boolean | null;
  walletClientType: string | null;
  connectorType: string | null;
  additionalSignerIds: string[];
  resolveError: string | null;
}

function getEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function serverKeyConfigured(): boolean {
  return Boolean(getEnv(AUTHORIZATION_PRIVATE_KEY_ENV_KEY));
}

function getAuthorizationSignerId(): string | null {
  for (const key of AUTHORIZATION_SIGNER_ID_ENV_KEYS) {
    const value = getEnv(key);
    if (value) return value;
  }
  return null;
}

function getPrivyClient(): PrivyClient {
  if (cachedPrivyClient) return cachedPrivyClient;
  const appId = getEnv('PRIVY_APP_ID') ?? getEnv('NEXT_PUBLIC_PRIVY_APP_ID');
  const appSecret = getEnv('PRIVY_APP_SECRET');
  if (!appId || !appSecret) {
    throw new Error('missing_privy_server_credentials');
  }
  cachedPrivyClient = new PrivyClient({ appId, appSecret });
  return cachedPrivyClient;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function linkedSolanaEmbeddedWallet(user: User, address: string): LinkedAccount | null {
  return (
    user.linked_accounts.find((account) => {
      if (account.type !== 'wallet') return false;
      const record = account as unknown as Record<string, unknown>;
      return (
        record.chain_type === 'solana' &&
        record.connector_type === 'embedded' &&
        typeof record.address === 'string' &&
        record.address === address
      );
    }) ?? null
  );
}

async function resolvePrivyWallet(input: {
  client: PrivyClient;
  walletAddress: string;
}): Promise<ResolvedPrivyWallet> {
  const [walletResult, userResult] = await Promise.allSettled([
    input.client.wallets().getWalletByAddress({ address: input.walletAddress }),
    input.client.users().getByWalletAddress({ address: input.walletAddress }),
  ]);
  const wallet = walletResult.status === 'fulfilled' ? walletResult.value : null;
  const user = userResult.status === 'fulfilled' ? userResult.value : null;
  const linkedWallet = user ? linkedSolanaEmbeddedWallet(user, input.walletAddress) : null;
  const linkedRecord = linkedWallet as unknown as Record<string, unknown> | null;
  const delegated =
    linkedRecord && typeof linkedRecord.delegated === 'boolean' ? linkedRecord.delegated : null;
  const walletClientType =
    typeof linkedRecord?.wallet_client === 'string' ? linkedRecord.wallet_client : null;
  const connectorType =
    typeof linkedRecord?.connector_type === 'string' ? linkedRecord.connector_type : null;
  const additionalSignerIds =
    wallet && Array.isArray((wallet as unknown as Record<string, unknown>).additional_signers)
      ? ((wallet as unknown as Record<string, unknown>).additional_signers as unknown[])
          .map((signer) =>
            typeof (signer as Record<string, unknown>).signer_id === 'string'
              ? ((signer as Record<string, unknown>).signer_id as string)
              : null,
          )
          .filter((signerId): signerId is string => Boolean(signerId))
      : [];
  const resolveError =
    walletResult.status === 'rejected'
      ? errorMessage(walletResult.reason)
      : userResult.status === 'rejected'
        ? errorMessage(userResult.reason)
        : null;

  return { wallet, delegated, walletClientType, connectorType, additionalSignerIds, resolveError };
}

function statusFromResolved(input: {
  walletAddress: string;
  resolved: ResolvedPrivyWallet;
}): DelegatedExecutionStatus {
  const blockers: string[] = [];
  const configured = serverKeyConfigured();
  const signerId = getAuthorizationSignerId();
  const signerConfigured = signerId !== null;
  const signerMatched = signerId ? input.resolved.additionalSignerIds.includes(signerId) : false;
  const unsupportedWalletClient =
    input.resolved.walletClientType != null && input.resolved.walletClientType !== 'privy-v2';

  if (!configured) blockers.push('missing_privy_authorization_private_key');
  if (!input.resolved.wallet) blockers.push('privy_wallet_not_delegated');
  if (unsupportedWalletClient) blockers.push('unsupported_privy_wallet_client_type');
  if (!signerConfigured) blockers.push('missing_privy_authorization_signer_id');
  if (signerConfigured && !signerMatched) {
    blockers.push('wallet_missing_authorization_signer');
  }
  if (!signerMatched) blockers.push('wallet_not_delegated');

  return {
    ok: true,
    serverKey: {
      configured,
      env: AUTHORIZATION_PRIVATE_KEY_ENV_KEY,
    },
    serverSigner: {
      configured: signerConfigured,
      env: [...AUTHORIZATION_SIGNER_ID_ENV_KEYS],
      walletMatched: signerMatched,
    },
    wallet: {
      address: input.walletAddress,
      privyWalletId: input.resolved.wallet?.id ?? null,
      delegated: input.resolved.delegated,
      walletClientType: input.resolved.walletClientType,
      connectorType: input.resolved.connectorType,
      additionalSignerIds: input.resolved.additionalSignerIds,
      ownerId: input.resolved.wallet?.owner_id ?? null,
      policyIds: input.resolved.wallet?.policy_ids ?? [],
      authorizationThreshold: input.resolved.wallet?.authorization_threshold ?? null,
      resolveError: input.resolved.resolveError,
    },
    ready: {
      canExecute: blockers.length === 0,
      blockers,
    },
  };
}

export async function getDelegatedExecutionStatus(
  auth: AuthContext,
): Promise<DelegatedExecutionStatus> {
  const client = getPrivyClient();
  const resolved = await resolvePrivyWallet({
    client,
    walletAddress: auth.walletAddress,
  });
  return statusFromResolved({ walletAddress: auth.walletAddress, resolved });
}
