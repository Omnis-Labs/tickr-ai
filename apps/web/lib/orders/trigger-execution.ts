import { USDC_DECIMALS, type TriggerHitPayload } from '@hunch-it/shared';
import {
  compactDiagnosticError,
  decodeSolanaError,
  type ClientDiagnosticInput,
} from '@/lib/dev-tools/client-diagnostics';
import { JupiterSwapError, type SwapArgs, type SwapResult } from '@/lib/jupiter/ultra-swap';
import { diagnosticsFromSwapDebug } from '@/lib/jupiter/swap-diagnostics';
import {
  claimOrderExecution,
  isOrderAlreadyExecuting,
  isOrderAlreadyHandled,
  OrderExecutionClaimError,
  releaseOrderExecutionClaim,
} from './execution-claim';

type AuthedFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
type TriggerSwap = (args: SwapArgs) => Promise<SwapResult>;
type TriggerDiagnosticEmitter = (input: ClientDiagnosticInput) => void;

export interface TriggerExecutionInput {
  payload: TriggerHitPayload;
  mint: string;
  decimals: number;
  startedAt?: number;
}

export type TriggerExecutionOutcome =
  | {
      kind: 'settled';
      executionPrice: number;
      tokenAmount: number;
      usdValue: number;
      signature: string | null;
      jupiterRequestId: string;
    }
  | { kind: 'alreadyHandled' }
  | { kind: 'alreadyExecuting' }
  | { kind: 'preBroadcastFailed'; message: string; released: boolean }
  | { kind: 'broadcastButSettleFailed'; message: string }
  | { kind: 'failed'; message: string; claimed: boolean; swapBroadcast: boolean };

export interface TriggerExecutionDeps {
  authedFetch: AuthedFetch;
  swap: TriggerSwap;
  emitDiagnostic: TriggerDiagnosticEmitter;
}

function shortId(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function triggerDiagnosticPayload(
  payload: TriggerHitPayload,
  mint: string,
  decimals: number,
): Record<string, unknown> {
  return {
    orderId: payload.orderId,
    positionId: payload.positionId,
    kind: payload.kind,
    side: payload.side,
    ticker: payload.ticker,
    mint,
    decimals,
    triggerPriceUsd: payload.triggerPriceUsd,
    currentPriceUsd: payload.currentPriceUsd,
    sizeUsd: payload.sizeUsd,
    tokenAmount: payload.tokenAmount ?? null,
  };
}

function errorDetail(err: unknown): Record<string, unknown> {
  if (err instanceof JupiterSwapError) {
    return {
      name: err.name,
      message: err.message,
      decodedSolanaError: decodeSolanaError(`${err.message}\n${err.debug.originalMessage}`),
      swap: err.debug,
      originalError: compactDiagnosticError(err.originalError),
    };
  }
  if (err instanceof OrderExecutionClaimError) {
    return {
      name: err.name,
      message: err.message,
      reason: err.reason,
      statusCode: err.statusCode,
    };
  }
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      decodedSolanaError: decodeSolanaError(err.message),
    };
  }
  return { message: String(err) };
}

function swapArgsForTrigger(payload: TriggerHitPayload, mint: string, decimals: number): SwapArgs {
  const diagnostics = { source: 'trigger-toast', mode: 'probes' } as const;
  if (payload.kind === 'BUY_TRIGGER') {
    return {
      direction: 'BUY',
      xStockMint: mint,
      xStockDecimals: decimals,
      usdAmount: payload.sizeUsd,
      diagnostics,
    };
  }

  // For TP/SL we sell exactly the position's token count (populated on the
  // synthetic exit Order at BUY-fill time). Falling back to sellAll is a
  // last-resort compatibility path and can sweep unrelated same-mint dust.
  if (payload.tokenAmount && payload.tokenAmount > 0) {
    return {
      direction: 'SELL',
      xStockMint: mint,
      xStockDecimals: decimals,
      tokenAmount: payload.tokenAmount,
      diagnostics,
    };
  }

  return {
    direction: 'SELL',
    xStockMint: mint,
    xStockDecimals: decimals,
    sellAll: true,
    diagnostics,
  };
}

export async function executeTriggerOrder(
  input: TriggerExecutionInput,
  deps: TriggerExecutionDeps,
): Promise<TriggerExecutionOutcome> {
  const { payload, mint, decimals } = input;
  const { authedFetch, emitDiagnostic, swap } = deps;
  const startedAt = input.startedAt ?? performance.now();
  const diagnosticPayload = triggerDiagnosticPayload(payload, mint, decimals);
  let claimed = false;
  let swapBroadcast = false;

  try {
    await claimOrderExecution(authedFetch, payload.orderId);
    claimed = true;
    emitDiagnostic({
      id: `${payload.orderId}:trigger-claim:${Date.now()}`,
      section: 'orders',
      step: 'trigger.claimExecution',
      summary: `Execution claim acquired for ${shortId(payload.orderId)}.`,
      severity: 'success',
      diagnostics: [
        {
          hypothesis: 'Execution claim lock',
          status: 'healthy',
          detail: 'Claim acquired before requesting Jupiter order.',
        },
      ],
      latencyMs: Math.round(performance.now() - startedAt),
      payload: diagnosticPayload,
    });

    const result = await swap(swapArgsForTrigger(payload, mint, decimals));
    if (result.exec.status !== 'Success') {
      throw new Error(result.exec.error ?? 'swap failed');
    }
    swapBroadcast = true;

    const tokenAmount =
      payload.kind === 'BUY_TRIGGER'
        ? Number(result.outputAmount) / 10 ** decimals
        : Number(result.inputAmount) / 10 ** decimals;
    const usdValue =
      payload.kind === 'BUY_TRIGGER'
        ? Number(result.inputAmount) / 10 ** USDC_DECIMALS
        : Number(result.outputAmount) / 10 ** USDC_DECIMALS;
    const executionPrice = tokenAmount > 0 ? usdValue / tokenAmount : payload.currentPriceUsd;

    const settle = await authedFetch(`/api/orders/${payload.orderId}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txSignature: result.exec.signature ?? `unknown-${Date.now()}`,
        executionPrice,
        tokenAmount,
      }),
    });
    if (!settle.ok) {
      const body = (await settle.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `settle ${settle.status}`);
    }

    emitDiagnostic({
      id: `${payload.orderId}:trigger-settled:${Date.now()}`,
      section: 'swap',
      step: 'trigger.executeSwap',
      summary: `Toast swap broadcast ${shortId(result.exec.signature ?? 'unknown')} and settled at $${executionPrice.toFixed(2)}.`,
      severity: 'success',
      diagnostics: diagnosticsFromSwapDebug(result.debug),
      latencyMs: Math.round(performance.now() - startedAt),
      payload: diagnosticPayload,
      response: {
        swap: result.exec,
        diagnostics: result.debug,
        executionPrice,
        tokenAmount,
      },
    });

    return {
      kind: 'settled',
      executionPrice,
      tokenAmount,
      usdValue,
      signature: result.exec.signature ?? null,
      jupiterRequestId: result.order.requestId,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const detail = errorDetail(err);
    const swapDebug = err instanceof JupiterSwapError ? err.debug : null;
    const decoded =
      err instanceof JupiterSwapError
        ? decodeSolanaError(`${err.message}\n${err.debug.originalMessage}`)
        : decodeSolanaError(msg);

    emitDiagnostic({
      id: `${payload.orderId}:trigger-failed:${Date.now()}`,
      section: 'swap',
      step: 'trigger.executeSwap',
      summary: swapDebug
        ? `Toast swap failed during ${swapDebug.phase}: ${swapDebug.originalMessage || msg}`
        : `Toast execution failed: ${msg}`,
      severity: 'error',
      diagnostics: [
        ...(swapDebug ? diagnosticsFromSwapDebug(swapDebug, decoded) : []),
        {
          hypothesis: 'Claim cleanup',
          status: claimed && !swapBroadcast ? 'watch' : 'unknown',
          detail:
            claimed && !swapBroadcast
              ? 'Swap did not broadcast, so the order claim will be released for retry.'
              : `claimed=${claimed}, swapBroadcast=${swapBroadcast}.`,
        },
      ],
      latencyMs: Math.round(performance.now() - startedAt),
      payload: diagnosticPayload,
      error: msg,
      errorDetail: {
        claimed,
        swapBroadcast,
        ...detail,
      },
    });

    if (err instanceof OrderExecutionClaimError) {
      if (isOrderAlreadyHandled(err.reason)) return { kind: 'alreadyHandled' };
      if (isOrderAlreadyExecuting(err.reason)) return { kind: 'alreadyExecuting' };
    }

    if (claimed && !swapBroadcast) {
      const released = await releaseOrderExecutionClaim(authedFetch, payload.orderId)
        .then(() => true)
        .catch(() => false);
      return { kind: 'preBroadcastFailed', message: msg, released };
    }

    if (swapBroadcast) return { kind: 'broadcastButSettleFailed', message: msg };
    return { kind: 'failed', message: msg, claimed, swapBroadcast };
  }
}
