import {
  JUPITER_ULTRA_EXECUTE,
  JUPITER_ULTRA_ORDER,
  getUltraOrderProblem,
  type UltraOrderProblem,
  type UltraOrderProblemCode,
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

export { getUltraOrderProblem };
export type { UltraOrderProblem, UltraOrderProblemCode };
