import 'server-only';

import { PrivyClient, type LinkedAccount, type User } from '@privy-io/node';
import {
  DELEGATED_EXECUTION_AUTHORIZATION_PRIVATE_KEY_ENV,
  delegatedExecutionReadinessStatus,
  getDelegatedExecutionAuthorizationSignerId,
  type DelegatedExecutionReadinessStatus,
  type DelegatedExecutionResolvedWallet,
} from '@hunch-it/shared';
import type { AuthContext } from '@/lib/auth/context';

let cachedPrivyClient: PrivyClient | null = null;

export type DelegatedExecutionStatus = DelegatedExecutionReadinessStatus;

function getEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function serverKeyConfigured(): boolean {
  return Boolean(getEnv(DELEGATED_EXECUTION_AUTHORIZATION_PRIVATE_KEY_ENV));
}

function getAuthorizationSignerId(): string | null {
  return getDelegatedExecutionAuthorizationSignerId(getEnv);
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
}): Promise<DelegatedExecutionResolvedWallet> {
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

  return {
    walletId: wallet?.id ?? null,
    walletChainType: wallet?.chain_type ?? null,
    delegated,
    walletClientType,
    connectorType,
    additionalSignerIds,
    ownerId: wallet?.owner_id ?? null,
    policyIds: wallet?.policy_ids ?? [],
    authorizationThreshold: wallet?.authorization_threshold ?? null,
    resolveError,
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
  return delegatedExecutionReadinessStatus({
    walletAddress: auth.walletAddress,
    resolved,
    serverKeyConfigured: serverKeyConfigured(),
    authorizationSignerId: getAuthorizationSignerId(),
  });
}
