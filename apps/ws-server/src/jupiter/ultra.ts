import {
  JUPITER_ULTRA_EXECUTE,
  JUPITER_ULTRA_ORDER,
} from '@hunch-it/shared';

const BASE = process.env.NEXT_PUBLIC_JUPITER_API_BASE ?? 'https://lite-api.jup.ag';

export interface UltraOrderResponse {
  requestId: string;
  transaction: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  swapUsdValue?: string;
  error?: string;
  errorCode?: string;
  errorMessage?: string;
  gasless?: boolean;
  router?: string;
  [key: string]: unknown;
}

export interface UltraExecuteResponse {
  status: 'Success' | 'Failed';
  signature?: string;
  error?: string;
  [key: string]: unknown;
}

export async function requestUltraOrder(input: {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker: string;
}): Promise<UltraOrderResponse> {
  const params = new URLSearchParams({
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.amount,
    taker: input.taker,
  });
  const res = await fetch(`${BASE}${JUPITER_ULTRA_ORDER}?${params.toString()}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter Ultra /order failed (${res.status}): ${text}`);
  }
  return (await res.json()) as UltraOrderResponse;
}

export async function executeUltraOrder(input: {
  requestId: string;
  signedTransaction: string;
}): Promise<UltraExecuteResponse> {
  const res = await fetch(`${BASE}${JUPITER_ULTRA_EXECUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: input.requestId,
      signedTransaction: input.signedTransaction,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter Ultra /execute failed (${res.status}): ${text}`);
  }
  return (await res.json()) as UltraExecuteResponse;
}

export type UltraOrderProblemCode = 'insufficient_funds' | 'ultra_order_unavailable';

export interface UltraOrderProblem {
  code: UltraOrderProblemCode;
  message: string;
  detail: {
    requestId: string | null;
    error: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    transactionLength: number;
  };
}

function stringField(order: UltraOrderResponse, key: string): string | null {
  const value = order[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function getUltraOrderProblem(order: UltraOrderResponse): UltraOrderProblem | null {
  const transaction = typeof order.transaction === 'string' ? order.transaction : '';
  const error = stringField(order, 'error');
  const errorCode = stringField(order, 'errorCode');
  const errorMessage = stringField(order, 'errorMessage');
  const combined = [error, errorCode, errorMessage].filter(Boolean).join(' ');

  if (transaction.length > 0 && !combined) return null;

  const code = /insufficient\s+funds/i.test(combined)
    ? 'insufficient_funds'
    : 'ultra_order_unavailable';
  const message =
    code === 'insufficient_funds'
      ? 'insufficient_funds'
      : errorMessage || error || errorCode || 'ultra_order_missing_transaction';

  return {
    code,
    message,
    detail: {
      requestId: order.requestId ?? null,
      error,
      errorCode,
      errorMessage,
      transactionLength: transaction.length,
    },
  };
}
