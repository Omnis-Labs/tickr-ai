import { USDC_DECIMALS, USDC_MINT } from './constants.js';
import type { TriggerHitPayload } from './types.js';

export type TriggerUltraSwapSide = 'BUY' | 'SELL';

export interface TriggerUltraSwapPlan {
  inputMint: string;
  outputMint: string;
  amount: string;
  side: TriggerUltraSwapSide;
  decimals: number;
}

export interface TriggerSettlementAmounts {
  executionPrice: number;
  tokenAmount: number;
  usdValue: number;
}

export interface TriggerExecutionEvidence extends TriggerSettlementAmounts {
  orderId: string;
  positionId: string;
  ticker: string;
  kind: TriggerHitPayload['kind'];
  side: TriggerHitPayload['side'];
  triggerPriceUsd: number;
  currentPriceUsd: number;
  sizeUsd: number;
  ultraInAmount: string;
  ultraOutAmount: string;
  decimals: number;
  premiumVsCurrentPricePct: number | null;
  premiumVsTriggerPricePct: number | null;
  jupiterRequestId: string | null;
  txSignature: string | null;
}

export interface ClosePositionExecutionEvidence {
  positionId: string;
  ticker: string | null;
  positionScope: 'position_token_amount' | 'wallet_balance_fallback';
  decimals: number;
  requestedTokenAmount: number | null;
  requestedRawAmount: string | null;
  walletRawAmount: string | null;
  submittedRawAmount: string;
  ultraInAmount: string;
  ultraOutAmount: string;
  submittedTokenAmount: number;
  tokenAmount: number;
  usdValue: number;
  executionPrice: number | null;
  jupiterRequestId: string | null;
  txSignature: string | null;
  closeOrderId: string | null;
  cancelledExitOrderIds: string[];
}

export type ExecutableTriggerWaitReason =
  | 'buy_price_above_trigger'
  | 'take_profit_price_below_trigger'
  | 'stop_loss_price_above_trigger';

export type ExecutableTriggerDecision =
  | {
      kind: 'triggerable';
      executionEvidence: TriggerExecutionEvidence;
    }
  | {
      kind: 'waiting';
      reason: ExecutableTriggerWaitReason;
      executionEvidence: TriggerExecutionEvidence;
    };

export function pythWakeUpBandHit(input: {
  kind: TriggerHitPayload['kind'];
  triggerPriceUsd: number | null | undefined;
  currentPriceUsd: number;
}): boolean {
  const trigger = input.triggerPriceUsd;
  if (trigger == null || !Number.isFinite(trigger) || trigger <= 0) return false;
  const epsilon = 1e-9;

  if (input.kind === 'TAKE_PROFIT') {
    return input.currentPriceUsd + epsilon >= trigger * 0.995;
  }

  if (input.kind === 'BUY_TRIGGER' || input.kind === 'STOP_LOSS') {
    return input.currentPriceUsd <= trigger * 1.005 + epsilon;
  }

  return false;
}

export function buildTriggerUltraSwapPlan(
  payload: TriggerHitPayload,
  decimals: number,
): TriggerUltraSwapPlan {
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
    throw new Error('sell_trigger_missing_token_amount');
  }

  return {
    inputMint: payload.mint,
    outputMint: USDC_MINT,
    amount: Math.round(payload.tokenAmount * 10 ** decimals).toString(),
    side: 'SELL',
    decimals,
  };
}

export function submittedInputRawForBalance(input: {
  side: TriggerUltraSwapSide;
  requestedRaw: bigint;
  walletRaw: bigint;
}): bigint | null {
  if (input.requestedRaw <= 0n) return null;
  if (input.walletRaw >= input.requestedRaw) return input.requestedRaw;
  if (input.side === 'SELL' && input.walletRaw > 0n) return input.walletRaw;
  return null;
}

export function settlementAmountsForTrigger(input: {
  payload: TriggerHitPayload;
  inAmount: string;
  outAmount: string;
  decimals: number;
}): TriggerSettlementAmounts {
  const tokenAmount =
    input.payload.kind === 'BUY_TRIGGER'
      ? Number(input.outAmount) / 10 ** input.decimals
      : Number(input.inAmount) / 10 ** input.decimals;
  const usdValue =
    input.payload.kind === 'BUY_TRIGGER'
      ? Number(input.inAmount) / 10 ** USDC_DECIMALS
      : Number(input.outAmount) / 10 ** USDC_DECIMALS;
  const executionPrice =
    tokenAmount > 0 ? usdValue / tokenAmount : input.payload.currentPriceUsd;
  return { executionPrice, tokenAmount, usdValue };
}

export function redactExecutionIdentifier(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function priceDeltaPct(executionPrice: number, referencePrice: number): number | null {
  if (!(referencePrice > 0)) return null;
  return ((executionPrice - referencePrice) / referencePrice) * 100;
}

export function triggerExecutionEvidence(input: {
  payload: TriggerHitPayload;
  inAmount: string;
  outAmount: string;
  decimals: number;
  jupiterRequestId?: string | null;
  txSignature?: string | null;
}): TriggerExecutionEvidence {
  const settlement = settlementAmountsForTrigger(input);

  return {
    orderId: input.payload.orderId,
    positionId: input.payload.positionId,
    ticker: input.payload.ticker,
    kind: input.payload.kind,
    side: input.payload.side,
    triggerPriceUsd: input.payload.triggerPriceUsd,
    currentPriceUsd: input.payload.currentPriceUsd,
    sizeUsd: input.payload.sizeUsd,
    ultraInAmount: input.inAmount,
    ultraOutAmount: input.outAmount,
    decimals: input.decimals,
    ...settlement,
    premiumVsCurrentPricePct: priceDeltaPct(
      settlement.executionPrice,
      input.payload.currentPriceUsd,
    ),
    premiumVsTriggerPricePct: priceDeltaPct(
      settlement.executionPrice,
      input.payload.triggerPriceUsd,
    ),
    jupiterRequestId: redactExecutionIdentifier(input.jupiterRequestId),
    txSignature: redactExecutionIdentifier(input.txSignature),
  };
}

export function executableTriggerDecision(input: {
  payload: TriggerHitPayload;
  inAmount: string;
  outAmount: string;
  decimals: number;
  jupiterRequestId?: string | null;
  txSignature?: string | null;
}): ExecutableTriggerDecision {
  const executionEvidence = triggerExecutionEvidence(input);
  const price = executionEvidence.executionPrice;
  const trigger = input.payload.triggerPriceUsd;

  if (input.payload.kind === 'BUY_TRIGGER') {
    return price <= trigger
      ? { kind: 'triggerable', executionEvidence }
      : { kind: 'waiting', reason: 'buy_price_above_trigger', executionEvidence };
  }

  if (input.payload.kind === 'TAKE_PROFIT') {
    return price >= trigger
      ? { kind: 'triggerable', executionEvidence }
      : { kind: 'waiting', reason: 'take_profit_price_below_trigger', executionEvidence };
  }

  return price <= trigger
    ? { kind: 'triggerable', executionEvidence }
    : { kind: 'waiting', reason: 'stop_loss_price_above_trigger', executionEvidence };
}

export function closePositionExecutionEvidence(input: {
  positionId: string;
  ticker?: string | null;
  decimals: number;
  requestedTokenAmount?: number | null;
  requestedRawAmount?: string | null;
  walletRawAmount?: string | null;
  submittedRawAmount?: string | null;
  ultraInAmount: string;
  ultraOutAmount: string;
  jupiterRequestId?: string | null;
  txSignature?: string | null;
  closeOrderId?: string | null;
  cancelledExitOrderIds?: string[] | null;
}): ClosePositionExecutionEvidence {
  const submittedRawAmount = input.submittedRawAmount ?? input.ultraInAmount;
  const submittedTokenAmount = Number(submittedRawAmount) / 10 ** input.decimals;
  const usdValue = Number(input.ultraOutAmount) / 10 ** USDC_DECIMALS;
  const executionPrice = submittedTokenAmount > 0 ? usdValue / submittedTokenAmount : null;

  return {
    positionId: input.positionId,
    ticker: input.ticker ?? null,
    positionScope:
      input.requestedTokenAmount != null && input.requestedTokenAmount > 0
        ? 'position_token_amount'
        : 'wallet_balance_fallback',
    decimals: input.decimals,
    requestedTokenAmount: input.requestedTokenAmount ?? null,
    requestedRawAmount: input.requestedRawAmount ?? null,
    walletRawAmount: input.walletRawAmount ?? null,
    submittedRawAmount,
    ultraInAmount: input.ultraInAmount,
    ultraOutAmount: input.ultraOutAmount,
    submittedTokenAmount,
    tokenAmount: submittedTokenAmount,
    usdValue,
    executionPrice,
    jupiterRequestId: redactExecutionIdentifier(input.jupiterRequestId),
    txSignature: redactExecutionIdentifier(input.txSignature),
    closeOrderId: redactExecutionIdentifier(input.closeOrderId),
    cancelledExitOrderIds: (input.cancelledExitOrderIds ?? []).map(redactExecutionIdentifier).filter(
      (value): value is string => value != null,
    ),
  };
}
