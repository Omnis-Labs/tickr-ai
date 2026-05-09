import { Connection, PublicKey } from '@solana/web3.js';
import {
  buildTriggerUltraSwapPlan,
  getAssetById,
  parseRpcUrls,
  settlementAmountsForTrigger,
  submittedInputRawForBalance,
  type TriggerHitPayload,
} from '@hunch-it/shared';
import {
  claimOrderExecution,
  confirmBuyFill,
  confirmExitFill,
  releaseOrderExecutionClaim,
} from '@hunch-it/db';
import { env } from '../env.js';
import {
  DelegatedWalletUnavailableError,
  resolveDelegatedWalletByAddress,
  signDelegatedSolanaTransaction,
} from '../privy/delegated-wallet.js';
import { executeUltraOrder, getUltraOrderProblem, requestUltraOrder } from '../jupiter/ultra.js';
import { readOwnerMintBalanceRaw } from '../solana/token-balance.js';

export type DelegatedTriggerExecutionOutcome =
  | {
      kind: 'settled';
      orderId: string;
      positionId: string;
      ticker: string;
      orderKind: TriggerHitPayload['kind'];
      signature: string;
      executionPrice: number;
      tokenAmount: number;
      usdValue: number;
    }
  | { kind: 'alreadyHandled'; orderId: string; reason: string }
  | { kind: 'alreadyExecuting'; orderId: string; reason: string }
  | { kind: 'notAvailable'; orderId: string; reason: string; detail?: unknown }
  | {
      kind: 'preBroadcastFailed';
      orderId: string;
      reason: string;
      shouldCooldown: boolean;
      /** True when no claim was acquired or the claim was released. */
      released: boolean;
      detail?: unknown;
    }
  | {
      kind: 'broadcastButSettleFailed';
      orderId: string;
      reason: string;
      signature: string;
      detail?: unknown;
    };

function getSolanaConnection(): Connection {
  const rpcUrl = parseRpcUrls(env.NEXT_PUBLIC_SOLANA_RPC_URLS)[0];
  return new Connection(rpcUrl ?? 'https://api.mainnet-beta.solana.com', {
    commitment: 'confirmed',
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function classifyClaimConflict(reason: string, orderId: string): DelegatedTriggerExecutionOutcome {
  if (
    reason === 'order_filled' ||
    reason === 'order_cancelled' ||
    reason === 'order_expired' ||
    reason === 'position_state_closed'
  ) {
    return { kind: 'alreadyHandled', orderId, reason };
  }
  if (
    reason === 'order_pending' ||
    reason === 'position_state_entering' ||
    reason === 'position_state_closing'
  ) {
    return { kind: 'alreadyExecuting', orderId, reason };
  }
  return { kind: 'alreadyHandled', orderId, reason };
}

async function prepareInputAmount(input: {
  payload: TriggerHitPayload;
  decimals: number;
  walletAddress: string;
}): Promise<ReturnType<typeof buildTriggerUltraSwapPlan>> {
  const requestedPlan = buildTriggerUltraSwapPlan(input.payload, input.decimals);
  const balance = await readOwnerMintBalanceRaw(
    getSolanaConnection(),
    new PublicKey(input.walletAddress),
    requestedPlan.inputMint,
  );
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
    ...requestedPlan,
    amount: submittedRaw.toString(),
  };
}

async function settleOrder(input: {
  userId: string;
  payload: TriggerHitPayload;
  signature: string;
  executionPrice: number;
  tokenAmount: number;
}): Promise<DelegatedTriggerExecutionOutcome> {
  const result =
    input.payload.kind === 'BUY_TRIGGER'
      ? await confirmBuyFill({
          userId: input.userId,
          orderId: input.payload.orderId,
          txSignature: input.signature,
          executionPrice: input.executionPrice,
          tokenAmount: input.tokenAmount,
        })
      : await confirmExitFill({
          userId: input.userId,
          orderId: input.payload.orderId,
          txSignature: input.signature,
          executionPrice: input.executionPrice,
          tokenAmount: input.tokenAmount,
        });

  if (result.status === 'conflict') {
    return {
      kind: 'broadcastButSettleFailed',
      orderId: input.payload.orderId,
      reason: result.reason,
      signature: input.signature,
    };
  }

  return {
    kind: 'settled',
    orderId: input.payload.orderId,
    positionId:
      result.status === 'success' ? result.data.positionId : input.payload.positionId,
    ticker: input.payload.ticker,
    orderKind: input.payload.kind,
    signature: input.signature,
    executionPrice: input.executionPrice,
    tokenAmount: input.tokenAmount,
    usdValue: input.executionPrice * input.tokenAmount,
  };
}

export async function tryExecuteDelegatedTriggerOrder(input: {
  userId: string;
  walletAddress: string;
  payload: TriggerHitPayload;
}): Promise<DelegatedTriggerExecutionOutcome> {
  const asset = getAssetById(input.payload.ticker);
  if (!asset) {
    return {
      kind: 'notAvailable',
      orderId: input.payload.orderId,
      reason: 'asset_missing_decimals',
      detail: { ticker: input.payload.ticker },
    };
  }

  let delegatedWallet: Awaited<ReturnType<typeof resolveDelegatedWalletByAddress>>;
  let plan: ReturnType<typeof buildTriggerUltraSwapPlan>;
  try {
    delegatedWallet = await resolveDelegatedWalletByAddress(input.walletAddress);
    plan = await prepareInputAmount({
      payload: input.payload,
      decimals: asset.decimals,
      walletAddress: input.walletAddress,
    });
  } catch (err) {
    if (err instanceof DelegatedWalletUnavailableError) {
      if (err.reason === 'privy_wallet_resolution_failed') {
        return {
          kind: 'preBroadcastFailed',
          orderId: input.payload.orderId,
          reason: err.reason,
          shouldCooldown: true,
          released: true,
          detail: err.detail,
        };
      }
      return {
        kind: 'notAvailable',
        orderId: input.payload.orderId,
        reason: err.reason,
        detail: err.detail,
      };
    }
    return {
      kind: 'preBroadcastFailed',
      orderId: input.payload.orderId,
      reason: 'delegated_preflight_runtime_error',
      shouldCooldown: true,
      released: true,
      detail: { cause: errorMessage(err) },
    };
  }

  const claim = await claimOrderExecution({
    userId: input.userId,
    orderId: input.payload.orderId,
  });
  if (claim.status === 'conflict') {
    return classifyClaimConflict(claim.reason, input.payload.orderId);
  }

  let signedTransaction: string | null = null;
  let signature: string | null = null;
  try {
    const order = await requestUltraOrder({
      inputMint: plan.inputMint,
      outputMint: plan.outputMint,
      amount: plan.amount,
      taker: input.walletAddress,
    });
    const problem = getUltraOrderProblem(order);
    if (problem) {
      if (problem.code === 'insufficient_funds') {
        const released = await releaseOrderExecutionClaim({
          userId: input.userId,
          orderId: input.payload.orderId,
        })
          .then((result) => result.status === 'success')
          .catch(() => false);
        if (!released) {
          return {
            kind: 'preBroadcastFailed',
            orderId: input.payload.orderId,
            reason: 'insufficient_funds_release_failed',
            shouldCooldown: false,
            released,
            detail: problem.detail,
          };
        }
        return {
          kind: 'notAvailable',
          orderId: input.payload.orderId,
          reason: problem.message,
          detail: problem.detail,
        };
      }
      throw new Error(problem.message);
    }

    signedTransaction = await signDelegatedSolanaTransaction({
      walletId: delegatedWallet.wallet.id,
      transaction: order.transaction,
      authorizationContext: delegatedWallet.authorizationContext,
      idempotencyKey: `trigger:${input.payload.orderId}:${order.requestId}`,
    });
    if (!signedTransaction) throw new Error('privy_sign_transaction_missing_result');

    const exec = await executeUltraOrder({
      requestId: order.requestId,
      signedTransaction,
    });
    if (exec.status !== 'Success' || !exec.signature) {
      throw new Error(exec.error ?? 'Jupiter Ultra /execute did not return a signature');
    }
    signature = exec.signature;

    const settlement = settlementAmountsForTrigger({
      payload: input.payload,
      inAmount: order.inAmount,
      outAmount: order.outAmount,
      decimals: asset.decimals,
    });
    return settleOrder({
      userId: input.userId,
      payload: input.payload,
      signature,
      executionPrice: settlement.executionPrice,
      tokenAmount: settlement.tokenAmount,
    });
  } catch (err) {
    if (signature) {
      return {
        kind: 'broadcastButSettleFailed',
        orderId: input.payload.orderId,
        reason: 'delegated_settlement_runtime_error',
        signature,
        detail: { cause: errorMessage(err) },
      };
    }
    const released = await releaseOrderExecutionClaim({
      userId: input.userId,
      orderId: input.payload.orderId,
    })
      .then((result) => result.status === 'success')
      .catch(() => false);
    return {
      kind: 'preBroadcastFailed',
      orderId: input.payload.orderId,
      reason: signedTransaction
        ? 'delegated_execute_runtime_error'
        : 'delegated_order_or_sign_runtime_error',
      shouldCooldown: true,
      released,
      detail: { cause: errorMessage(err) },
    };
  }
}
