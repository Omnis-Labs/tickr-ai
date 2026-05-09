import {
  PrivyClient,
  type AuthorizationContext,
  type LinkedAccount,
  type User as PrivyUser,
  type Wallet,
} from '@privy-io/node';
import { env } from '../env.js';

const AUTHORIZATION_PRIVATE_KEY_ENV_KEY = 'PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY' as const;
const AUTHORIZATION_SIGNER_ID_ENV_KEYS = [
  'PRIVY_WALLET_AUTHORIZATION_SIGNER_ID',
  'NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_SIGNER_ID',
] as const;

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
  for (const key of AUTHORIZATION_SIGNER_ID_ENV_KEYS) {
    const value = getEnv(key);
    if (value) return value;
  }
  return null;
}

function getPrivyClient(): PrivyClient {
  if (cachedPrivyClient) return cachedPrivyClient;
  const appId = env.PRIVY_APP_ID ?? getEnv('NEXT_PUBLIC_PRIVY_APP_ID');
  const appSecret = env.PRIVY_APP_SECRET;
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
      const walletClient = record.wallet_client;
      return (
        record.chain_type === 'solana' &&
        (walletClient === 'privy' || walletClient === 'privy-v2') &&
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
    linkedRecord && typeof linkedRecord.delegated === 'boolean'
      ? linkedRecord.delegated
      : null;
  const walletClientType =
    typeof linkedRecord?.wallet_client === 'string' ? linkedRecord.wallet_client : null;
  const signerId = getAuthorizationSignerId();
  const signerIds = additionalSignerIds(wallet);
  const signerMatched = signerId ? signerIds.includes(signerId) : false;

  if (walletClientType === 'privy-v2' && !signerId) {
    throw new DelegatedWalletUnavailableError('missing_privy_authorization_signer_id', {
      checkedEnv: AUTHORIZATION_SIGNER_ID_ENV_KEYS,
    });
  }
  if (signerId && !signerMatched && delegated !== true) {
    throw new DelegatedWalletUnavailableError('wallet_missing_authorization_signer', {
      walletAddress,
      signerConfigured: true,
      additionalSignerIds: signerIds,
    });
  }
  if (!wallet || (delegated !== true && !signerMatched)) {
    throw new DelegatedWalletUnavailableError('wallet_not_delegated', {
      walletAddress,
      delegated,
      signerMatched,
    });
  }
  if (wallet.chain_type !== 'solana') {
    throw new DelegatedWalletUnavailableError('privy_wallet_not_solana', {
      walletId: wallet.id,
      chainType: wallet.chain_type,
    });
  }

  return {
    wallet,
    delegated,
    signerMatched,
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
  const signed = await getPrivyClient()
    .wallets()
    .solana()
    .signTransaction(input.walletId, {
      transaction: input.transaction,
      authorization_context: input.authorizationContext,
      idempotency_key: input.idempotencyKey,
    });
  return signed.signed_transaction;
}
