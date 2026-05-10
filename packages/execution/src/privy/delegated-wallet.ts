import {
  PrivyClient,
  type AuthorizationContext,
  type LinkedAccount,
  type User as PrivyUser,
  type Wallet,
} from '@privy-io/node';
import {
  DELEGATED_EXECUTION_AUTHORIZATION_PRIVATE_KEY_ENV,
  DELEGATED_EXECUTION_AUTHORIZATION_SIGNER_ID_ENVS,
  delegatedExecutionReadinessStatus,
  getDelegatedExecutionAuthorizationSignerId,
  type DelegatedExecutionReadinessBlocker,
  type DelegatedExecutionReadinessStatus,
  type DelegatedExecutionResolvedWallet,
} from '@hunch-it/shared';

const AUTHORIZATION_PRIVATE_KEY_ENV_KEY = DELEGATED_EXECUTION_AUTHORIZATION_PRIVATE_KEY_ENV;
const AUTHORIZATION_SIGNER_ID_ENV_KEYS = DELEGATED_EXECUTION_AUTHORIZATION_SIGNER_ID_ENVS;

let cachedPrivyClient: PrivyClient | null = null;

export interface ResolvedDelegatedWallet {
  wallet: Wallet;
  delegated: boolean | null;
  signerMatched: boolean;
  authorizationContext: AuthorizationContext;
}

export class DelegatedWalletUnavailableError extends Error {
  constructor(
    public readonly reason: string,
    public readonly detail?: unknown,
  ) {
    super(reason);
    this.name = 'DelegatedWalletUnavailableError';
  }
}

function getEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getAuthorizationPrivateKeys(): string[] {
  return (getEnv(AUTHORIZATION_PRIVATE_KEY_ENV_KEY) ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAuthorizationSignerId(): string | null {
  return getDelegatedExecutionAuthorizationSignerId(getEnv);
}

function getPrivyClient(): PrivyClient {
  if (cachedPrivyClient) return cachedPrivyClient;
  const appId = getEnv('PRIVY_APP_ID') ?? getEnv('NEXT_PUBLIC_PRIVY_APP_ID');
  const appSecret = getEnv('PRIVY_APP_SECRET');
  if (!appId || !appSecret) {
    throw new DelegatedWalletUnavailableError('missing_privy_server_credentials', {
      checkedEnv: ['PRIVY_APP_ID', 'NEXT_PUBLIC_PRIVY_APP_ID', 'PRIVY_APP_SECRET'],
    });
  }
  cachedPrivyClient = new PrivyClient({ appId, appSecret });
  return cachedPrivyClient;
}

function linkedSolanaEmbeddedWallet(user: PrivyUser, address: string): LinkedAccount | null {
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

function additionalSignerIds(wallet: Wallet | null): string[] {
  const signers = (wallet as unknown as Record<string, unknown> | null)?.additional_signers;
  if (!Array.isArray(signers)) return [];
  return signers
    .map((signer) =>
      typeof (signer as Record<string, unknown>).signer_id === 'string'
        ? ((signer as Record<string, unknown>).signer_id as string)
        : null,
    )
    .filter((signerId): signerId is string => Boolean(signerId));
}

function readinessWallet(input: {
  wallet: Wallet | null;
  delegated: boolean | null;
  walletClientType: string | null;
  additionalSignerIds: string[];
  resolveError: string | null;
}): DelegatedExecutionResolvedWallet {
  return {
    walletId: input.wallet?.id ?? null,
    walletChainType: input.wallet?.chain_type ?? null,
    delegated: input.delegated,
    walletClientType: input.walletClientType,
    connectorType: 'embedded',
    additionalSignerIds: input.additionalSignerIds,
    ownerId: input.wallet?.owner_id ?? null,
    policyIds: input.wallet?.policy_ids ?? [],
    authorizationThreshold: input.wallet?.authorization_threshold ?? null,
    resolveError: input.resolveError,
  };
}

function unavailableDetail(input: {
  blocker: DelegatedExecutionReadinessBlocker;
  walletAddress: string;
  wallet: Wallet | null;
  delegated: boolean | null;
  walletClientType: string | null;
  signerIds: string[];
  status: DelegatedExecutionReadinessStatus;
  resolveError: string | null;
}): unknown {
  if (input.blocker === 'missing_privy_authorization_private_key') {
    return { checkedEnv: [AUTHORIZATION_PRIVATE_KEY_ENV_KEY] };
  }
  if (input.blocker === 'missing_privy_authorization_signer_id') {
    return { checkedEnv: AUTHORIZATION_SIGNER_ID_ENV_KEYS };
  }
  if (input.blocker === 'unsupported_privy_wallet_client_type') {
    return {
      walletAddress: input.walletAddress,
      walletClientType: input.walletClientType,
      expectedWalletClientType: 'privy-v2',
    };
  }
  if (input.blocker === 'wallet_missing_authorization_signer') {
    return {
      walletAddress: input.walletAddress,
      signerConfigured: input.status.serverSigner.configured,
      additionalSignerIds: input.signerIds,
    };
  }
  if (input.blocker === 'privy_wallet_not_solana') {
    return {
      walletId: input.wallet?.id ?? null,
      chainType: input.wallet?.chain_type ?? null,
    };
  }
  return {
    walletAddress: input.walletAddress,
    delegated: input.delegated,
    signerMatched: input.status.serverSigner.walletMatched,
    resolveError: input.resolveError,
  };
}

export async function resolveDelegatedWalletByAddress(
  walletAddress: string,
): Promise<ResolvedDelegatedWallet> {
  const authorizationPrivateKeys = getAuthorizationPrivateKeys();
  if (authorizationPrivateKeys.length === 0) {
    throw new DelegatedWalletUnavailableError('missing_privy_authorization_private_key', {
      checkedEnv: [AUTHORIZATION_PRIVATE_KEY_ENV_KEY],
    });
  }

  const client = getPrivyClient();
  const [walletResult, userResult] = await Promise.allSettled([
    client.wallets().getWalletByAddress({ address: walletAddress }),
    client.users().getByWalletAddress({ address: walletAddress }),
  ]);
  if (walletResult.status === 'rejected' || userResult.status === 'rejected') {
    throw new DelegatedWalletUnavailableError('privy_wallet_resolution_failed', {
      walletAddress,
      walletError:
        walletResult.status === 'rejected'
          ? walletResult.reason instanceof Error
            ? walletResult.reason.message
            : String(walletResult.reason)
          : null,
      userError:
        userResult.status === 'rejected'
          ? userResult.reason instanceof Error
            ? userResult.reason.message
            : String(userResult.reason)
          : null,
    });
  }

  const wallet = walletResult.value;
  const user = userResult.value;
  const linkedWallet = linkedSolanaEmbeddedWallet(user, walletAddress);
  const linkedRecord = linkedWallet as unknown as Record<string, unknown> | null;
  const delegated =
    linkedRecord && typeof linkedRecord.delegated === 'boolean' ? linkedRecord.delegated : null;
  const walletClientType =
    typeof linkedRecord?.wallet_client === 'string' ? linkedRecord.wallet_client : null;
  const signerId = getAuthorizationSignerId();
  const signerIds = additionalSignerIds(wallet);
  const resolveError = null;
  const status = delegatedExecutionReadinessStatus({
    walletAddress,
    resolved: readinessWallet({
      wallet,
      delegated,
      walletClientType,
      additionalSignerIds: signerIds,
      resolveError,
    }),
    serverKeyConfigured: authorizationPrivateKeys.length > 0,
    authorizationSignerId: signerId,
  });
  const blocker = status.ready.blockers[0];
  if (blocker) {
    throw new DelegatedWalletUnavailableError(
      blocker,
      unavailableDetail({
        blocker,
        walletAddress,
        wallet,
        delegated,
        walletClientType,
        signerIds,
        status,
        resolveError,
      }),
    );
  }
  if (!wallet) {
    throw new DelegatedWalletUnavailableError('wallet_not_delegated', { walletAddress });
  }

  return {
    wallet,
    delegated,
    signerMatched: status.serverSigner.walletMatched,
    authorizationContext: {
      authorization_private_keys: authorizationPrivateKeys,
    },
  };
}

export async function signDelegatedSolanaTransaction(input: {
  walletId: string;
  transaction: string;
  authorizationContext: AuthorizationContext;
  idempotencyKey: string;
}): Promise<string> {
  const signed = await getPrivyClient().wallets().solana().signTransaction(input.walletId, {
    transaction: input.transaction,
    authorization_context: input.authorizationContext,
    idempotency_key: input.idempotencyKey,
  });
  return signed.signed_transaction;
}
