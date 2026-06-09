import { Connection, PublicKey } from '@solana/web3.js';
import {
  buildTriggerUltraSwapPlan,
  executableTriggerDecision,
  getAssetById,
  parseRpcUrls,
  triggerExecutionEvidence,
  submittedInputRawForBalance,
  type ExecutableTriggerWaitReason,
  type TriggerExecutionEvidence,
  type TriggerHitPayload,
  type TriggerWakePayload,
} from '@hunch-it/shared';
import {
  claimOrderExecution as claimOrderExecutionDb,
  confirmBuyFill as confirmBuyFillDb,
  confirmExitFill as confirmExitFillDb,
  releaseOrderExecutionClaim as releaseOrderExecutionClaimDb,
} from '@hunch-it/db';
import {
  DelegatedWalletUnavailableError,
  resolveDelegatedWalletByAddress as resolveDelegatedWalletByAddressPrivy,
  signDelegatedSolanaTransaction as signDelegatedSolanaTransactionPrivy,
} from '../privy/delegated-wallet.js';
import {
  executeUltraOrder as executeUltraOrderJupiter,
  getUltraOrderProblem as getUltraOrderProblemJupiter,
  requestUltraOrder as requestUltraOrderJupiter,
} from '../jupiter/ultra.js';
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
      executionEvidence: TriggerExecutionEvidence;
    }
  | { kind: 'alreadyHandled'; orderId: string; reason: string }
  | { kind: 'alreadyExecuting'; orderId: string; reason: string }
  | {
      kind: 'quoteWaiting';
      orderId: string;
      reason: ExecutableTriggerWaitReason;
      executionEvidence: TriggerExecutionEvidence;
    }
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
    }
  | {
      kind: 'broadcastUnknown';
      orderId: string;
      reason: string;
      requestId: string | null;
      detail?: unknown;
    };

type TriggerUltraSwapPlan = ReturnType<typeof buildTriggerUltraSwapPlan>;

function getSolanaConnection(): Connection {
  const rpcUrl = parseRpcUrls(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS)[0];
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

export async function prepareInputAmount(input: {
  payload: TriggerWakePayload;
  decimals: number;
  walletAddress: string;
}): Promise<TriggerUltraSwapPlan> {
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

export interface DelegatedExecutionDeps {
  getAssetById: typeof getAssetById;
  resolveDelegatedWalletByAddress: typeof resolveDelegatedWalletByAddressPrivy;
  prepareInputAmount: typeof prepareInputAmount;
  claimOrderExecution: typeof claimOrderExecutionDb;
  releaseOrderExecutionClaim: typeof releaseOrderExecutionClaimDb;
  confirmBuyFill: typeof confirmBuyFillDb;
  confirmExitFill: typeof confirmExitFillDb;
  requestUltraOrder: typeof requestUltraOrderJupiter;
  getUltraOrderProblem: typeof getUltraOrderProblemJupiter;
  signDelegatedSolanaTransaction: typeof signDelegatedSolanaTransactionPrivy;
  executeUltraOrder: typeof executeUltraOrderJupiter;
}

export const defaultDelegatedExecutionDeps: DelegatedExecutionDeps = {
  getAssetById,
  resolveDelegatedWalletByAddress: resolveDelegatedWalletByAddressPrivy,
  prepareInputAmount,
  claimOrderExecution: claimOrderExecutionDb,
  releaseOrderExecutionClaim: releaseOrderExecutionClaimDb,
  confirmBuyFill: confirmBuyFillDb,
  confirmExitFill: confirmExitFillDb,
  requestUltraOrder: requestUltraOrderJupiter,
  getUltraOrderProblem: getUltraOrderProblemJupiter,
  signDelegatedSolanaTransaction: signDelegatedSolanaTransactionPrivy,
  executeUltraOrder: executeUltraOrderJupiter,
};

async function settleOrder(
  input: {
    userId: string;
    payload: TriggerHitPayload;
    signature: string;
    executionPrice: number;
    tokenAmount: number;
    executionEvidence: TriggerExecutionEvidence;
  },
  deps: Pick<DelegatedExecutionDeps, 'confirmBuyFill' | 'confirmExitFill'>,
): Promise<DelegatedTriggerExecutionOutcome> {
  const result =
    input.payload.kind === 'BUY_TRIGGER'
      ? await deps.confirmBuyFill({
          userId: input.userId,
          orderId: input.payload.orderId,
          txSignature: input.signature,
          executionPrice: input.executionPrice,
          tokenAmount: input.tokenAmount,
        })
      : await deps.confirmExitFill({
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
    positionId: result.status === 'success' ? result.data.positionId : input.payload.positionId,
    ticker: input.payload.ticker,
    orderKind: input.payload.kind,
    signature: input.signature,
    executionPrice: input.executionPrice,
    tokenAmount: input.tokenAmount,
    usdValue: input.executionEvidence.usdValue,
    executionEvidence: input.executionEvidence,
  };
}

export async function tryExecuteDelegatedTriggerOrder(
  input: {
    userId: string;
    walletAddress: string;
    payload: TriggerHitPayload;
  },
  deps: DelegatedExecutionDeps = defaultDelegatedExecutionDeps,
): Promise<DelegatedTriggerExecutionOutcome> {
  const asset = deps.getAssetById(input.payload.ticker);
  if (!asset) {
    return {
      kind: 'notAvailable',
      orderId: input.payload.orderId,
      reason: 'asset_missing_decimals',
      detail: { ticker: input.payload.ticker },
    };
  }

  let delegatedWallet: Awaited<ReturnType<typeof resolveDelegatedWalletByAddressPrivy>>;
  let plan: TriggerUltraSwapPlan;
  try {
    delegatedWallet = await deps.resolveDelegatedWalletByAddress(input.walletAddress);
    plan = await deps.prepareInputAmount({
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

  const claim = await deps.claimOrderExecution({
    userId: input.userId,
    orderId: input.payload.orderId,
  });
  if (claim.status === 'conflict') {
    return classifyClaimConflict(claim.reason, input.payload.orderId);
  }

  let signedTransaction: string | null = null;
  let signature: string | null = null;
  let ultraExecuteAttempted = false;
  let ultraRequestId: string | null = null;
  try {
    const order = await deps.requestUltraOrder({
      inputMint: plan.inputMint,
      outputMint: plan.outputMint,
      amount: plan.amount,
      taker: input.walletAddress,
    });
    ultraRequestId = order.requestId;
    const problem = deps.getUltraOrderProblem(order);
    if (problem) {
      if (problem.code === 'insufficient_funds') {
        const released = await deps
          .releaseOrderExecutionClaim({
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

    const quoteDecision = executableTriggerDecision({
      payload: input.payload,
      inAmount: order.inAmount,
      outAmount: order.outAmount,
      decimals: asset.decimals,
      jupiterRequestId: order.requestId,
    });
    if (quoteDecision.kind === 'waiting') {
      const released = await deps
        .releaseOrderExecutionClaim({
          userId: input.userId,
          orderId: input.payload.orderId,
        })
        .then((result) => result.status === 'success')
        .catch(() => false);
      if (!released) {
        return {
          kind: 'preBroadcastFailed',
          orderId: input.payload.orderId,
          reason: 'executable_quote_release_failed',
          shouldCooldown: false,
          released,
          detail: {
            quoteReason: quoteDecision.reason,
            executionPrice: quoteDecision.executionEvidence.executionPrice,
          },
        };
      }
      return {
        kind: 'quoteWaiting',
        orderId: input.payload.orderId,
        reason: quoteDecision.reason,
        executionEvidence: quoteDecision.executionEvidence,
      };
    }

    signedTransaction = await deps.signDelegatedSolanaTransaction({
      walletId: delegatedWallet.wallet.id,
      transaction: order.transaction,
      authorizationContext: delegatedWallet.authorizationContext,
      idempotencyKey: `trigger:${input.payload.orderId}:${order.requestId}`,
    });
    if (!signedTransaction) throw new Error('privy_sign_transaction_missing_result');

    ultraExecuteAttempted = true;
    const exec = await deps.executeUltraOrder({
      requestId: order.requestId,
      signedTransaction,
    });
    if (exec.status !== 'Success' || !exec.signature) {
      throw new Error(exec.error ?? 'Jupiter Ultra /execute did not return a signature');
    }
    signature = exec.signature;

    const executionEvidence = triggerExecutionEvidence({
      payload: input.payload,
      inAmount: order.inAmount,
      outAmount: order.outAmount,
      decimals: asset.decimals,
      jupiterRequestId: order.requestId,
      txSignature: signature,
    });
    return settleOrder(
      {
        userId: input.userId,
        payload: input.payload,
        signature,
        executionPrice: executionEvidence.executionPrice,
        tokenAmount: executionEvidence.tokenAmount,
        executionEvidence,
      },
      deps,
    );
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
    if (ultraExecuteAttempted) {
      // The relay may have accepted and broadcast the signed bytes even if
      // our HTTP response failed; keep the DB claim locked for reconciliation.
      return {
        kind: 'broadcastUnknown',
        orderId: input.payload.orderId,
        reason: 'delegated_execute_signature_unknown',
        requestId: ultraRequestId,
        detail: { cause: errorMessage(err) },
      };
    }
    const released = await deps
      .releaseOrderExecutionClaim({
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
