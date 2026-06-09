import {
  closePositionExecutionEvidence,
  type ClosePositionExecutionEvidence,
} from '@hunch-it/shared';
import type { SwapResult } from '@/lib/jupiter/ultra-swap';

export interface ClosePositionPersistResult {
  closeOrderId?: string | null;
  cancelledExitOrderIds?: string[] | null;
}

export interface ClosePositionDiagnosticResponse {
  executionEvidence: ClosePositionExecutionEvidence;
  settlement: ClosePositionPersistResult | null;
}

export function closePositionDiagnosticResponse(input: {
  positionId: string;
  ticker?: string | null;
  decimals: number;
  requestedTokenAmount?: number | null;
  swap: SwapResult;
  settlement?: ClosePositionPersistResult | null;
}): ClosePositionDiagnosticResponse {
  return {
    executionEvidence: closePositionExecutionEvidence({
      positionId: input.positionId,
      ticker: input.ticker ?? null,
      decimals: input.decimals,
      requestedTokenAmount: input.requestedTokenAmount ?? null,
      requestedRawAmount: input.swap.debug.sellBalance?.requestedRaw ?? null,
      walletRawAmount: input.swap.debug.sellBalance?.walletRaw ?? null,
      submittedRawAmount: input.swap.debug.sellBalance?.submittedRaw ?? input.swap.inputAmount,
      ultraInAmount: input.swap.inputAmount,
      ultraOutAmount: input.swap.outputAmount,
      jupiterRequestId: input.swap.order.requestId,
      txSignature: input.swap.exec.signature ?? null,
      closeOrderId: input.settlement?.closeOrderId ?? null,
      cancelledExitOrderIds: input.settlement?.cancelledExitOrderIds ?? [],
    }),
    settlement: input.settlement ?? null,
  };
}
