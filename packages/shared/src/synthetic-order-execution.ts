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
