import 'server-only';

import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { PrivyClient, type LinkedAccount, type User, type Wallet } from '@privy-io/node';
import {
  DelegatedWalletUnavailableError,
  defaultDelegatedExecutionDeps,
  readOwnerMintBalanceRaw,
  tryExecuteDelegatedTriggerOrder,
  type DelegatedExecutionDeps,
  type DelegatedTriggerExecutionOutcome,
  type ResolvedDelegatedWallet,
  type UltraExecuteResponse,
} from '@hunch-it/execution';
import {
  DELEGATED_EXECUTION_AUTHORIZATION_PRIVATE_KEY_ENV,
  buildTriggerUltraSwapPlan,
  delegatedExecutionReadinessStatus,
  getAssetById,
  getDelegatedExecutionAuthorizationSignerId,
  parseRpcUrls,
  type DelegatedExecutionReadinessStatus,
  type DelegatedExecutionResolvedWallet,
  type TriggerUltraSwapPlan,
  type TriggerHitPayload,
} from '@hunch-it/shared';
import type { AuthContext } from '@/lib/auth/context';
import { submittedInputRawForBalance } from './privy-delegated-ultra-swap-amounts';
import { buildOwnedDevTriggerPayload } from './server';

interface DevPrivyDelegatedUltraSwapInput {
  auth: AuthContext;
  orderId: string;
}

interface TransactionShape {
  version: string;
  requiredSignatures: number;
  zeroSignatureCount: number;
  staticAccountKeys: number;
  compiledInstructions: number;
  addressTableLookups: number;
  feePayer: string | null;
  signerKeys: string[];
}

type SwapPlan = TriggerUltraSwapPlan;

interface InputBalanceCheck {
  inputMint: string;
  requestedRaw: string;
  submittedRaw: string;
  walletRaw: string;
  tokenProgramIds: string[];
}

export type DevPrivyDelegatedUltraSwapStatus = DelegatedExecutionReadinessStatus;

export interface DevPrivyDelegatedUltraSwapResult {
  ok: true;
  authorizationUsed: {
    serverKey: boolean;
    serverKeyConfigured: boolean;
  };
  wallet: {
    address: string;
    privyWalletId: string;
    delegated: boolean | null;
    ownerId: string | null;
    policyIds: string[];
    authorizationThreshold: number | null;
  };
  trigger: TriggerHitPayload;
  plan: SwapPlan;
  balance: InputBalanceCheck;
  ultraOrder: {
    requestId: string;
    inAmount: string;
    outAmount: string;
    priceImpactPct: string;
    otherAmountThreshold: string;
    transactionBytes: number;
    transactionShape: TransactionShape;
    gasless: boolean | null;
    router: string | null;
  };
  signedTransaction?: {
    bytes: number;
    transactionShape: TransactionShape;
  };
  execution?: {
    status: UltraExecuteResponse['status'];
    signature: string | null;
    error: string | null;
    executionPrice: number;
    tokenAmount: number;
    usdValue: number;
    settlement: unknown;
  };
}

export class DevPrivyDelegatedUltraSwapError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'DevPrivyDelegatedUltraSwapError';
  }
}

const AUTHORIZATION_PRIVATE_KEY_ENV_KEY = DELEGATED_EXECUTION_AUTHORIZATION_PRIVATE_KEY_ENV;

let cachedPrivyClient: PrivyClient | null = null;

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

function serverKeyConfigured(): boolean {
  return getAuthorizationPrivateKeys().length > 0;
}

function getPrivyClient(): PrivyClient {
  if (cachedPrivyClient) return cachedPrivyClient;
  const appId = getEnv('PRIVY_APP_ID') ?? getEnv('NEXT_PUBLIC_PRIVY_APP_ID');
  const appSecret = getEnv('PRIVY_APP_SECRET');
  if (!appId || !appSecret) {
    throw new DevPrivyDelegatedUltraSwapError('missing_privy_server_credentials', 500);
  }
  cachedPrivyClient = new PrivyClient({ appId, appSecret });
  return cachedPrivyClient;
}

function getSolanaConnection(): Connection {
  const rpcUrl = parseRpcUrls(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS)[0];
  return new Connection(rpcUrl ?? 'https://api.mainnet-beta.solana.com', {
    commitment: 'confirmed',
  });
}

function toBase64Bytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function describeTransaction(transactionBase64: string): TransactionShape {
  const tx = VersionedTransaction.deserialize(toBase64Bytes(transactionBase64));
  const message = tx.message as VersionedTransaction['message'] & {
    staticAccountKeys?: Array<{ toBase58: () => string }>;
    accountKeys?: Array<{ toBase58: () => string }>;
    compiledInstructions?: unknown[];
    instructions?: unknown[];
    addressTableLookups?: unknown[];
  };
  const staticKeys = message.staticAccountKeys ?? message.accountKeys ?? [];
  const requiredSignatures = tx.message.header.numRequiredSignatures;

  return {
    version: String(tx.version),
    requiredSignatures,
    zeroSignatureCount: tx.signatures.filter((signature) => signature.every((byte) => byte === 0))
      .length,
    staticAccountKeys: staticKeys.length,
    compiledInstructions: (message.compiledInstructions ?? message.instructions ?? []).length,
    addressTableLookups: message.addressTableLookups?.length ?? 0,
    feePayer: staticKeys[0]?.toBase58() ?? null,
    signerKeys: staticKeys.slice(0, requiredSignatures).map((key) => key.toBase58()),
  };
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

interface ResolvedPrivyWallet {
  wallet: Wallet | null;
  delegated: boolean | null;
  walletClientType: string | null;
  connectorType: string | null;
  additionalSignerIds: string[];
  resolveError: string | null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function readinessWalletFromResolved(resolved: ResolvedPrivyWallet): DelegatedExecutionResolvedWallet {
  return {
    walletId: resolved.wallet?.id ?? null,
    walletChainType: resolved.wallet?.chain_type ?? null,
    delegated: resolved.delegated,
    walletClientType: resolved.walletClientType,
    connectorType: resolved.connectorType,
    additionalSignerIds: resolved.additionalSignerIds,
    ownerId: resolved.wallet?.owner_id ?? null,
    policyIds: resolved.wallet?.policy_ids ?? [],
    authorizationThreshold: resolved.wallet?.authorization_threshold ?? null,
    resolveError: resolved.resolveError,
  };
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
  const delegated =
    linkedWallet && 'delegated' in linkedWallet
      ? Boolean((linkedWallet as unknown as Record<string, unknown>).delegated)
      : null;
  const linkedRecord = linkedWallet as unknown as Record<string, unknown> | null;
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

async function prepareInputBalance(input: {
  payload: TriggerHitPayload;
  decimals: number;
  walletAddress: string;
}): Promise<{ plan: SwapPlan; balance: InputBalanceCheck }> {
  const requestedPlan = buildTriggerUltraSwapPlan(input.payload, input.decimals);
  const owner = new PublicKey(input.walletAddress);
  const balance = await readOwnerMintBalanceRaw(getSolanaConnection(), owner, requestedPlan.inputMint);
  const requestedRaw = BigInt(requestedPlan.amount);
  const submittedRaw = submittedInputRawForBalance({
    side: requestedPlan.side,
    requestedRaw,
    walletRaw: balance.raw,
  });

  if (submittedRaw == null) {
    throw new DelegatedWalletUnavailableError('insufficient_funds', {
      inputMint: requestedPlan.inputMint,
      requestedRaw: requestedRaw.toString(),
      walletRaw: balance.raw.toString(),
      tokenProgramIds: balance.programIds,
    });
  }

  return {
    plan: {
      ...requestedPlan,
      amount: submittedRaw.toString(),
    },
    balance: {
      inputMint: requestedPlan.inputMint,
      requestedRaw: requestedRaw.toString(),
      submittedRaw: submittedRaw.toString(),
      walletRaw: balance.raw.toString(),
      tokenProgramIds: balance.programIds,
    },
  };
}

function statusFromResolved(input: {
  walletAddress: string;
  resolved: ResolvedPrivyWallet;
}): DevPrivyDelegatedUltraSwapStatus {
  return delegatedExecutionReadinessStatus({
    walletAddress: input.walletAddress,
    resolved: readinessWalletFromResolved(input.resolved),
    serverKeyConfigured: serverKeyConfigured(),
    authorizationSignerId: getAuthorizationSignerId(),
  });
}

function outcomeError(outcome: Exclude<DelegatedTriggerExecutionOutcome, { kind: 'settled' }>): {
  message: string;
  status: number;
  detail: unknown;
} {
  if (outcome.kind === 'alreadyHandled' || outcome.kind === 'alreadyExecuting') {
    return { message: outcome.reason, status: 409, detail: outcome };
  }
  if (outcome.kind === 'notAvailable') {
    const status =
      outcome.reason === 'missing_privy_authorization_private_key' ||
      outcome.reason === 'missing_privy_authorization_signer_id'
        ? 500
        : outcome.reason === 'insufficient_funds'
          ? 400
          : 409;
    return { message: outcome.reason, status, detail: outcome };
  }
  if (outcome.kind === 'preBroadcastFailed') {
    return { message: outcome.reason, status: outcome.released ? 502 : 500, detail: outcome };
  }
  if (outcome.kind === 'broadcastUnknown') {
    return { message: outcome.reason, status: 502, detail: { ...outcome, claimRetained: true } };
  }
  return { message: outcome.reason, status: 500, detail: { ...outcome, claimRetained: true } };
}

export async function getPrivyDelegatedUltraSwapStatus(input: {
  auth: AuthContext;
}): Promise<DevPrivyDelegatedUltraSwapStatus> {
  const client = getPrivyClient();
  const resolved = await resolvePrivyWallet({
    client,
    walletAddress: input.auth.walletAddress,
  });
  return statusFromResolved({ walletAddress: input.auth.walletAddress, resolved });
}

export async function runPrivyDelegatedUltraSwapDevTool(
  input: DevPrivyDelegatedUltraSwapInput,
): Promise<DevPrivyDelegatedUltraSwapResult> {
  const { payload, walletAddress } = await buildOwnedDevTriggerPayload({
    userId: input.auth.userId,
    orderId: input.orderId,
  });
  const asset = getAssetById(payload.ticker);
  if (!asset) {
    throw new DevPrivyDelegatedUltraSwapError(`${payload.ticker}_asset_missing_decimals`, 500);
  }

  const captured: {
    wallet: ResolvedDelegatedWallet | null;
    plan: SwapPlan | null;
    balance: InputBalanceCheck | null;
    ultraOrder: DevPrivyDelegatedUltraSwapResult['ultraOrder'] | null;
    signedTransaction: DevPrivyDelegatedUltraSwapResult['signedTransaction'] | null;
    exec: UltraExecuteResponse | null;
  } = {
    wallet: null,
    plan: null,
    balance: null,
    ultraOrder: null,
    signedTransaction: null,
    exec: null,
  };

  const deps: DelegatedExecutionDeps = {
    ...defaultDelegatedExecutionDeps,
    resolveDelegatedWalletByAddress: async (address) => {
      const wallet = await defaultDelegatedExecutionDeps.resolveDelegatedWalletByAddress(address);
      captured.wallet = wallet;
      return wallet;
    },
    prepareInputAmount: async (amountInput) => {
      const prepared = await prepareInputBalance(amountInput);
      captured.plan = prepared.plan;
      captured.balance = prepared.balance;
      return prepared.plan;
    },
    requestUltraOrder: async (orderInput) => {
      const order = await defaultDelegatedExecutionDeps.requestUltraOrder(orderInput);
      const transactionBytes = toBase64Bytes(order.transaction).byteLength;
      captured.ultraOrder = {
        requestId: order.requestId,
        inAmount: order.inAmount,
        outAmount: order.outAmount,
        priceImpactPct: order.priceImpactPct,
        otherAmountThreshold: order.otherAmountThreshold,
        transactionBytes,
        transactionShape: describeTransaction(order.transaction),
        gasless: typeof order.gasless === 'boolean' ? order.gasless : null,
        router: order.router ?? null,
      };
      return order;
    },
    signDelegatedSolanaTransaction: async (signInput) => {
      const signed =
        await defaultDelegatedExecutionDeps.signDelegatedSolanaTransaction(signInput);
      captured.signedTransaction = {
        bytes: toBase64Bytes(signed).byteLength,
        transactionShape: describeTransaction(signed),
      };
      return signed;
    },
    executeUltraOrder: async (executeInput) => {
      const exec = await defaultDelegatedExecutionDeps.executeUltraOrder(executeInput);
      captured.exec = exec;
      return exec;
    },
  };

  const outcome = await tryExecuteDelegatedTriggerOrder(
    {
      userId: input.auth.userId,
      walletAddress,
      payload,
    },
    deps,
  );

  if (outcome.kind !== 'settled') {
    const error = outcomeError(outcome);
    throw new DevPrivyDelegatedUltraSwapError(error.message, error.status, error.detail);
  }

  if (
    !captured.wallet ||
    !captured.plan ||
    !captured.balance ||
    !captured.ultraOrder ||
    !captured.signedTransaction ||
    !captured.exec
  ) {
    throw new DevPrivyDelegatedUltraSwapError('delegated_execution_diagnostics_incomplete', 500, {
      hasWallet: Boolean(captured.wallet),
      hasPlan: Boolean(captured.plan),
      hasBalance: Boolean(captured.balance),
      hasUltraOrder: Boolean(captured.ultraOrder),
      hasSignedTransaction: Boolean(captured.signedTransaction),
      hasExec: Boolean(captured.exec),
    });
  }

  return {
    ok: true,
    authorizationUsed: {
      serverKey: true,
      serverKeyConfigured: serverKeyConfigured(),
    },
    wallet: {
      address: walletAddress,
      privyWalletId: captured.wallet.wallet.id,
      delegated: captured.wallet.delegated,
      ownerId: captured.wallet.wallet.owner_id,
      policyIds: captured.wallet.wallet.policy_ids,
      authorizationThreshold: captured.wallet.wallet.authorization_threshold ?? null,
    },
    trigger: payload,
    plan: captured.plan,
    balance: captured.balance,
    ultraOrder: captured.ultraOrder,
    signedTransaction: captured.signedTransaction,
    execution: {
      status: captured.exec.status,
      signature: outcome.signature,
      error: captured.exec.error ?? null,
      executionPrice: outcome.executionPrice,
      tokenAmount: outcome.tokenAmount,
      usdValue: outcome.usdValue,
      settlement: outcome,
    },
  };
}
