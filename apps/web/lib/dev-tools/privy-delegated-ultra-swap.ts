import 'server-only';

import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
  PrivyClient,
  type AuthorizationContext,
  type LinkedAccount,
  type User,
  type Wallet,
} from '@privy-io/node';
import {
  buildTriggerUltraSwapPlan,
  getAssetById,
  parseRpcUrls,
  settlementAmountsForTrigger,
  type TriggerUltraSwapPlan,
  type TriggerHitPayload,
} from '@hunch-it/shared';
import {
  claimOrderExecution,
  confirmBuyFill,
  confirmExitFill,
  prisma,
  releaseOrderExecutionClaim,
} from '@hunch-it/db';
import { decimalsToNumbers } from '@/lib/db/decimal';
import {
  executeUltraOrder,
  requestUltraOrder,
  type UltraExecuteResponse,
  type UltraOrderResponse,
} from '@/lib/jupiter';
import { readOwnerMintBalanceRaw } from '@/lib/jupiter/ultra-swap';
import type { AuthContext } from '@/lib/auth/context';
import { getUltraOrderProblem } from './privy-delegated-ultra-swap-guards';
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

export interface DevPrivyDelegatedUltraSwapStatus {
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

const AUTHORIZATION_PRIVATE_KEY_ENV_KEY = 'PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY' as const;
const AUTHORIZATION_SIGNER_ID_ENV_KEYS = [
  'PRIVY_WALLET_AUTHORIZATION_SIGNER_ID',
  'NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_SIGNER_ID',
] as const;

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
  for (const key of AUTHORIZATION_SIGNER_ID_ENV_KEYS) {
    const value = getEnv(key);
    if (value) return value;
  }
  return null;
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

function buildServerAuthorizationContext(): {
  context: AuthorizationContext;
  used: DevPrivyDelegatedUltraSwapResult['authorizationUsed'];
} {
  const serverKeys = getAuthorizationPrivateKeys();
  if (serverKeys.length === 0) {
    throw new DevPrivyDelegatedUltraSwapError('missing_privy_authorization_private_key', 500, {
      checkedEnv: [AUTHORIZATION_PRIVATE_KEY_ENV_KEY],
    });
  }

  return {
    context: {
      authorization_private_keys: serverKeys,
    },
    used: {
      serverKey: true,
      serverKeyConfigured: true,
    },
  };
}

async function requestOrder(input: { plan: SwapPlan; taker: string }): Promise<UltraOrderResponse> {
  try {
    return await requestUltraOrder({
      inputMint: input.plan.inputMint,
      outputMint: input.plan.outputMint,
      amount: input.plan.amount,
      taker: input.taker,
    });
  } catch (err) {
    throw new DevPrivyDelegatedUltraSwapError('jupiter_ultra_order_failed', 502, {
      cause: errorMessage(err),
      inputMint: input.plan.inputMint,
      outputMint: input.plan.outputMint,
      requestedRaw: input.plan.amount,
    });
  }
}

function assertUltraOrderTransaction(order: UltraOrderResponse): string {
  const problem = getUltraOrderProblem(order);
  if (!problem) return order.transaction;

  throw new DevPrivyDelegatedUltraSwapError(problem.message, 400, problem.detail);
}

async function prepareInputBalance(input: {
  plan: SwapPlan;
  walletAddress: string;
}): Promise<{ plan: SwapPlan; balance: InputBalanceCheck }> {
  const owner = new PublicKey(input.walletAddress);
  const balance = await readOwnerMintBalanceRaw(getSolanaConnection(), owner, input.plan.inputMint);
  const requestedRaw = BigInt(input.plan.amount);
  const submittedRaw = submittedInputRawForBalance({
    side: input.plan.side,
    requestedRaw,
    walletRaw: balance.raw,
  });

  if (submittedRaw == null) {
    throw new DevPrivyDelegatedUltraSwapError('insufficient_funds', 400, {
      inputMint: input.plan.inputMint,
      requestedRaw: requestedRaw.toString(),
      walletRaw: balance.raw.toString(),
      tokenProgramIds: balance.programIds,
    });
  }

  return {
    plan: {
      ...input.plan,
      amount: submittedRaw.toString(),
    },
    balance: {
      inputMint: input.plan.inputMint,
      requestedRaw: requestedRaw.toString(),
      submittedRaw: submittedRaw.toString(),
      walletRaw: balance.raw.toString(),
      tokenProgramIds: balance.programIds,
    },
  };
}

async function settleOrder(input: {
  auth: AuthContext;
  payload: TriggerHitPayload;
  executionPrice: number;
  tokenAmount: number;
  signature: string;
}): Promise<unknown> {
  const result =
    input.payload.kind === 'BUY_TRIGGER'
      ? await confirmBuyFill({
          userId: input.auth.userId,
          orderId: input.payload.orderId,
          txSignature: input.signature,
          executionPrice: input.executionPrice,
          tokenAmount: input.tokenAmount,
        })
      : await confirmExitFill({
          userId: input.auth.userId,
          orderId: input.payload.orderId,
          txSignature: input.signature,
          executionPrice: input.executionPrice,
          tokenAmount: input.tokenAmount,
        });

  if (result.status === 'conflict') {
    throw new DevPrivyDelegatedUltraSwapError(`settle_${result.reason}`, 409);
  }

  const order = await prisma.order.findUnique({ where: { id: input.payload.orderId } });
  return { result, order: decimalsToNumbers(order) };
}

function statusFromResolved(input: {
  walletAddress: string;
  resolved: ResolvedPrivyWallet;
}): DevPrivyDelegatedUltraSwapStatus {
  const blockers: string[] = [];
  const configured = serverKeyConfigured();
  const signerId = getAuthorizationSignerId();
  const signerConfigured = signerId !== null;
  const signerMatched = signerId ? input.resolved.additionalSignerIds.includes(signerId) : false;
  const unsupportedWalletClient =
    input.resolved.wallet != null && input.resolved.walletClientType !== 'privy-v2';
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

  const client = getPrivyClient();
  const resolved = await resolvePrivyWallet({ client, walletAddress });
  const { context, used } = buildServerAuthorizationContext();
  const { wallet, delegated } = resolved;
  const signerId = getAuthorizationSignerId();
  const signerMatched = signerId ? resolved.additionalSignerIds.includes(signerId) : false;
  if (!wallet) {
    throw new DevPrivyDelegatedUltraSwapError('wallet_not_delegated', 409, {
      walletAddress,
      delegated,
      signerMatched,
      resolveError: resolved.resolveError,
    });
  }
  if (resolved.walletClientType !== 'privy-v2') {
    throw new DevPrivyDelegatedUltraSwapError('unsupported_privy_wallet_client_type', 409, {
      walletAddress,
      walletClientType: resolved.walletClientType,
      expectedWalletClientType: 'privy-v2',
    });
  }
  if (!signerId) {
    throw new DevPrivyDelegatedUltraSwapError('missing_privy_authorization_signer_id', 500, {
      checkedEnv: AUTHORIZATION_SIGNER_ID_ENV_KEYS,
    });
  }
  if (!signerMatched) {
    throw new DevPrivyDelegatedUltraSwapError('wallet_missing_authorization_signer', 409, {
      walletAddress,
      signerConfigured: Boolean(signerId),
      additionalSignerIds: resolved.additionalSignerIds,
    });
  }
  if (!signerMatched) {
    throw new DevPrivyDelegatedUltraSwapError('wallet_not_delegated', 409, {
      walletAddress,
      delegated,
      signerMatched,
      resolveError: resolved.resolveError,
    });
  }
  if (wallet.chain_type !== 'solana') {
    throw new DevPrivyDelegatedUltraSwapError('privy_wallet_not_solana', 400, {
      walletId: wallet.id,
      chainType: wallet.chain_type,
    });
  }

  let requestedPlan: SwapPlan;
  try {
    requestedPlan = buildTriggerUltraSwapPlan(payload, asset.decimals);
  } catch (err) {
    throw new DevPrivyDelegatedUltraSwapError(errorMessage(err), 400);
  }
  const { plan, balance } = await prepareInputBalance({ plan: requestedPlan, walletAddress });
  const order = await requestOrder({ plan, taker: walletAddress });
  const transaction = assertUltraOrderTransaction(order);
  const orderTransactionBytes = toBase64Bytes(transaction).byteLength;
  let orderTransactionShape: TransactionShape;
  try {
    orderTransactionShape = describeTransaction(transaction);
  } catch (err) {
    throw new DevPrivyDelegatedUltraSwapError('ultra_transaction_deserialize_failed', 502, {
      cause: errorMessage(err),
      requestId: order.requestId,
      transactionBytes: orderTransactionBytes,
    });
  }

  const base: Omit<DevPrivyDelegatedUltraSwapResult, 'ok'> = {
    authorizationUsed: used,
    wallet: {
      address: walletAddress,
      privyWalletId: wallet.id,
      delegated,
      ownerId: wallet.owner_id,
      policyIds: wallet.policy_ids,
      authorizationThreshold: wallet.authorization_threshold ?? null,
    },
    trigger: payload,
    plan,
    balance,
    ultraOrder: {
      requestId: order.requestId,
      inAmount: order.inAmount,
      outAmount: order.outAmount,
      priceImpactPct: order.priceImpactPct,
      otherAmountThreshold: order.otherAmountThreshold,
      transactionBytes: orderTransactionBytes,
      transactionShape: orderTransactionShape,
      gasless: typeof order.gasless === 'boolean' ? order.gasless : null,
      router: order.router ?? null,
    },
  };

  let claimed = false;
  let executeAttempted = false;
  let broadcasted = false;
  try {
    const claim = await claimOrderExecution({
      userId: input.auth.userId,
      orderId: payload.orderId,
    });
    if (claim.status === 'conflict') {
      throw new DevPrivyDelegatedUltraSwapError(`claim_${claim.reason}`, 409);
    }
    claimed = true;

    let signed: { signed_transaction: string };
    try {
      signed = await client
        .wallets()
        .solana()
        .signTransaction(wallet.id, {
          transaction,
          authorization_context: context,
          idempotency_key: `dev-ultra-sign:${payload.orderId}:${order.requestId}`,
        });
    } catch (err) {
      throw new DevPrivyDelegatedUltraSwapError('privy_sign_transaction_failed', 502, {
        cause: errorMessage(err),
        walletId: wallet.id,
        requestId: order.requestId,
        signerKeys: orderTransactionShape.signerKeys,
        zeroSignatureCount: orderTransactionShape.zeroSignatureCount,
      });
    }
    const signedTransactionBytes = toBase64Bytes(signed.signed_transaction).byteLength;
    let signedTransactionShape: TransactionShape;
    try {
      signedTransactionShape = describeTransaction(signed.signed_transaction);
    } catch (err) {
      throw new DevPrivyDelegatedUltraSwapError('privy_signed_transaction_invalid', 502, {
        cause: errorMessage(err),
        walletId: wallet.id,
        requestId: order.requestId,
        signedTransactionBytes,
      });
    }

    let exec: UltraExecuteResponse;
    try {
      executeAttempted = true;
      exec = await executeUltraOrder({
        requestId: order.requestId,
        signedTransaction: signed.signed_transaction,
      });
    } catch (err) {
      throw new DevPrivyDelegatedUltraSwapError('jupiter_ultra_execute_failed', 502, {
        cause: errorMessage(err),
        requestId: order.requestId,
        claimRetained: true,
      });
    }
    broadcasted = exec.status === 'Success' && !!exec.signature;
    if (!broadcasted) {
      throw new DevPrivyDelegatedUltraSwapError('jupiter_ultra_execute_failed', 502, {
        status: exec.status,
        cause: exec.error ?? 'Ultra did not return a success signature.',
        requestId: order.requestId,
        claimRetained: true,
      });
    }

    const settlement = settlementAmountsForTrigger({
      payload,
      inAmount: order.inAmount,
      outAmount: order.outAmount,
      decimals: asset.decimals,
    });
    let settled: unknown;
    try {
      settled = await settleOrder({
        auth: input.auth,
        payload,
        executionPrice: settlement.executionPrice,
        tokenAmount: settlement.tokenAmount,
        signature: exec.signature!,
      });
    } catch (err) {
      if (err instanceof DevPrivyDelegatedUltraSwapError) throw err;
      throw new DevPrivyDelegatedUltraSwapError('order_settlement_failed', 500, {
        cause: errorMessage(err),
        orderId: payload.orderId,
        signature: exec.signature,
      });
    }

    return {
      ok: true,
      ...base,
      signedTransaction: {
        bytes: signedTransactionBytes,
        transactionShape: signedTransactionShape,
      },
      execution: {
        status: exec.status,
        signature: exec.signature ?? null,
        error: exec.error ?? null,
        executionPrice: settlement.executionPrice,
        tokenAmount: settlement.tokenAmount,
        usdValue: settlement.usdValue,
        settlement: settled,
      },
    };
  } catch (err) {
    // Once /execute is attempted, a missing response signature is ambiguous:
    // the relay may still broadcast, so the claim stays PENDING.
    if (claimed && !executeAttempted && !broadcasted) {
      await releaseOrderExecutionClaim({
        userId: input.auth.userId,
        orderId: payload.orderId,
      }).catch(() => null);
    }
    throw err;
  }
}
