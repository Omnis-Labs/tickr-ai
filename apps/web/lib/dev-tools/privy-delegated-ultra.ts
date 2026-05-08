import 'server-only';

import { VersionedTransaction } from '@solana/web3.js';
import { PrivyClient, type AuthorizationContext, type LinkedAccount, type User, type Wallet } from '@privy-io/node';
import {
  USDC_DECIMALS,
  USDC_MINT,
  getAssetById,
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
import type { AuthContext } from '@/lib/auth/context';
import { buildOwnedDevTriggerPayload } from './server';

export type DevPrivyDelegatedUltraMode = 'preview' | 'execute';
export type DevPrivyAuthorizationMode = 'user-jwt' | 'server-key' | 'combined';

interface DevPrivyDelegatedUltraInput {
  auth: AuthContext;
  orderId: string;
  mode: DevPrivyDelegatedUltraMode;
  authorizationMode: DevPrivyAuthorizationMode;
  userJwt: string | null;
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

interface SwapPlan {
  inputMint: string;
  outputMint: string;
  amount: string;
  side: 'BUY' | 'SELL';
  decimals: number;
}

export interface DevPrivyDelegatedUltraResult {
  ok: true;
  mode: DevPrivyDelegatedUltraMode;
  authorizationMode: DevPrivyAuthorizationMode;
  authorizationUsed: {
    userJwt: boolean;
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
  ultraOrder: {
    requestId: string;
    inAmount: string;
    outAmount: string;
    priceImpactPct: string;
    otherAmountThreshold: string;
    transactionBytes: number;
    transactionShape: TransactionShape;
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

export class DevPrivyDelegatedUltraError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'DevPrivyDelegatedUltraError';
  }
}

const AUTHORIZATION_PRIVATE_KEY_ENV_KEYS = [
  'PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY',
  'PRIVY_AUTHORIZATION_PRIVATE_KEY',
  'PRIVY_WALLET_AUTH_PRIVATE_KEY',
] as const;

let cachedPrivyClient: PrivyClient | null = null;

function getEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getAuthorizationPrivateKeys(): string[] {
  return AUTHORIZATION_PRIVATE_KEY_ENV_KEYS.flatMap((name) =>
    (getEnv(name) ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function hasServerAuthorizationKey(): boolean {
  return getAuthorizationPrivateKeys().length > 0;
}

function getPrivyClient(): PrivyClient {
  if (cachedPrivyClient) return cachedPrivyClient;
  const appId = getEnv('PRIVY_APP_ID') ?? getEnv('NEXT_PUBLIC_PRIVY_APP_ID');
  const appSecret = getEnv('PRIVY_APP_SECRET');
  if (!appId || !appSecret) {
    throw new DevPrivyDelegatedUltraError('missing_privy_server_credentials', 500);
  }
  cachedPrivyClient = new PrivyClient({ appId, appSecret });
  return cachedPrivyClient;
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
        record.wallet_client === 'privy' &&
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
}): Promise<{
  wallet: Wallet;
  delegated: boolean | null;
}> {
  const [wallet, user] = await Promise.all([
    input.client.wallets().getWalletByAddress({ address: input.walletAddress }),
    input.client.users().getByWalletAddress({ address: input.walletAddress }),
  ]);
  const linkedWallet = linkedSolanaEmbeddedWallet(user, input.walletAddress);
  const delegated =
    linkedWallet && 'delegated' in linkedWallet
      ? Boolean((linkedWallet as unknown as Record<string, unknown>).delegated)
      : null;

  return { wallet, delegated };
}

function swapPlanForPayload(payload: TriggerHitPayload, decimals: number): SwapPlan {
  if (payload.kind === 'BUY_TRIGGER') {
    return {
      inputMint: USDC_MINT,
      outputMint: payload.mint,
      amount: Math.round(payload.sizeUsd * 10 ** USDC_DECIMALS).toString(),
      side: 'BUY',
      decimals,
    };
  }

  if (!payload.tokenAmount || payload.tokenAmount <= 0) {
    throw new DevPrivyDelegatedUltraError('sell_trigger_missing_token_amount', 400);
  }

  return {
    inputMint: payload.mint,
    outputMint: USDC_MINT,
    amount: Math.round(payload.tokenAmount * 10 ** decimals).toString(),
    side: 'SELL',
    decimals,
  };
}

function buildAuthorizationContext(input: {
  authorizationMode: DevPrivyAuthorizationMode;
  userJwt: string | null;
}): {
  context: AuthorizationContext;
  used: DevPrivyDelegatedUltraResult['authorizationUsed'];
} {
  const serverKeys = getAuthorizationPrivateKeys();
  const wantsUserJwt =
    input.authorizationMode === 'user-jwt' || input.authorizationMode === 'combined';
  const wantsServerKey =
    input.authorizationMode === 'server-key' || input.authorizationMode === 'combined';

  if (wantsUserJwt && !input.userJwt) {
    throw new DevPrivyDelegatedUltraError('missing_privy_user_jwt', 401);
  }
  if (wantsServerKey && serverKeys.length === 0) {
    throw new DevPrivyDelegatedUltraError('missing_privy_authorization_private_key', 500, {
      checkedEnv: AUTHORIZATION_PRIVATE_KEY_ENV_KEYS,
    });
  }

  return {
    context: {
      ...(wantsUserJwt && input.userJwt ? { user_jwts: [input.userJwt] } : {}),
      ...(wantsServerKey ? { authorization_private_keys: serverKeys } : {}),
    },
    used: {
      userJwt: wantsUserJwt && !!input.userJwt,
      serverKey: wantsServerKey && serverKeys.length > 0,
      serverKeyConfigured: serverKeys.length > 0,
    },
  };
}

async function requestOrder(input: {
  plan: SwapPlan;
  taker: string;
}): Promise<UltraOrderResponse> {
  return requestUltraOrder({
    inputMint: input.plan.inputMint,
    outputMint: input.plan.outputMint,
    amount: input.plan.amount,
    taker: input.taker,
  });
}

function settlementFor(input: {
  payload: TriggerHitPayload;
  order: UltraOrderResponse;
  decimals: number;
}): {
  executionPrice: number;
  tokenAmount: number;
  usdValue: number;
} {
  const tokenAmount =
    input.payload.kind === 'BUY_TRIGGER'
      ? Number(input.order.outAmount) / 10 ** input.decimals
      : Number(input.order.inAmount) / 10 ** input.decimals;
  const usdValue =
    input.payload.kind === 'BUY_TRIGGER'
      ? Number(input.order.inAmount) / 10 ** USDC_DECIMALS
      : Number(input.order.outAmount) / 10 ** USDC_DECIMALS;
  const executionPrice = tokenAmount > 0 ? usdValue / tokenAmount : input.payload.currentPriceUsd;
  return { executionPrice, tokenAmount, usdValue };
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
    throw new DevPrivyDelegatedUltraError(`settle_${result.reason}`, 409);
  }

  const order = await prisma.order.findUnique({ where: { id: input.payload.orderId } });
  return { result, order: decimalsToNumbers(order) };
}

export async function runPrivyDelegatedUltraDevTool(
  input: DevPrivyDelegatedUltraInput,
): Promise<DevPrivyDelegatedUltraResult> {
  const { payload, walletAddress } = await buildOwnedDevTriggerPayload({
    userId: input.auth.userId,
    orderId: input.orderId,
  });
  const asset = getAssetById(payload.ticker);
  if (!asset) {
    throw new DevPrivyDelegatedUltraError(`${payload.ticker}_asset_missing_decimals`, 500);
  }

  const client = getPrivyClient();
  const { wallet, delegated } = await resolvePrivyWallet({ client, walletAddress });
  if (wallet.chain_type !== 'solana') {
    throw new DevPrivyDelegatedUltraError('privy_wallet_not_solana', 400, {
      walletId: wallet.id,
      chainType: wallet.chain_type,
    });
  }

  const plan = swapPlanForPayload(payload, asset.decimals);
  const order = await requestOrder({ plan, taker: walletAddress });
  const orderTransactionBytes = toBase64Bytes(order.transaction).byteLength;
  const orderTransactionShape = describeTransaction(order.transaction);
  const { context, used } = buildAuthorizationContext({
    authorizationMode: input.authorizationMode,
    userJwt: input.userJwt,
  });

  const base: Omit<DevPrivyDelegatedUltraResult, 'ok'> = {
    mode: input.mode,
    authorizationMode: input.authorizationMode,
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
    ultraOrder: {
      requestId: order.requestId,
      inAmount: order.inAmount,
      outAmount: order.outAmount,
      priceImpactPct: order.priceImpactPct,
      otherAmountThreshold: order.otherAmountThreshold,
      transactionBytes: orderTransactionBytes,
      transactionShape: orderTransactionShape,
    },
  };

  if (input.mode === 'preview') return { ok: true, ...base };

  let claimed = false;
  let broadcasted = false;
  try {
    const claim = await claimOrderExecution({ userId: input.auth.userId, orderId: payload.orderId });
    if (claim.status === 'conflict') {
      throw new DevPrivyDelegatedUltraError(`claim_${claim.reason}`, 409);
    }
    claimed = true;

    const signed = await client.wallets().solana().signTransaction(wallet.id, {
      transaction: order.transaction,
      authorization_context: context,
      idempotency_key: `dev-ultra-sign:${payload.orderId}:${order.requestId}`,
    });
    const signedTransactionBytes = toBase64Bytes(signed.signed_transaction).byteLength;
    const signedTransactionShape = describeTransaction(signed.signed_transaction);

    const exec = await executeUltraOrder({
      requestId: order.requestId,
      signedTransaction: signed.signed_transaction,
    });
    broadcasted = exec.status === 'Success' && !!exec.signature;
    if (!broadcasted) {
      throw new DevPrivyDelegatedUltraError(exec.error ?? 'jupiter_ultra_execute_failed', 502, {
        status: exec.status,
      });
    }

    const settlement = settlementFor({ payload, order, decimals: asset.decimals });
    const settled = await settleOrder({
      auth: input.auth,
      payload,
      executionPrice: settlement.executionPrice,
      tokenAmount: settlement.tokenAmount,
      signature: exec.signature!,
    });

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
    if (claimed && !broadcasted) {
      await releaseOrderExecutionClaim({ userId: input.auth.userId, orderId: payload.orderId }).catch(
        () => null,
      );
    }
    throw err;
  }
}
