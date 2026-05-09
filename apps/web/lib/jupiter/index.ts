// Thin Jupiter Ultra client.
// Docs: https://dev.jup.ag/docs/ultra-api
//
// Ultra's advantage vs v6 `/quote` + `/swap`: Jupiter builds a sponsored
// transaction for a requestId, the user signs their/taker signature slot, and
// `/execute` relays/completes the sponsored swap. Do not direct-broadcast
// sponsored Ultra transactions through the wallet RPC path; that bypasses
// Jupiter `/execute`.

import {
  JUPITER_ULTRA_EXECUTE,
  JUPITER_ULTRA_ORDER,
  USDC_MINT,
} from '@hunch-it/shared';

const BASE =
  process.env.NEXT_PUBLIC_JUPITER_API_BASE ?? 'https://lite-api.jup.ag';

export interface UltraOrderRequest {
  inputMint: string;
  outputMint: string;
  amount: string; // in smallest units of the input mint
  taker: string; // public key of the wallet
}

export interface UltraOrderResponse {
  requestId: string;
  transaction: string; // base64 encoded unsigned tx
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

export async function requestUltraOrder(
  input: UltraOrderRequest,
): Promise<UltraOrderResponse> {
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

export async function executeUltraOrder(payload: {
  requestId: string;
  signedTransaction: string; // base64
}): Promise<UltraExecuteResponse> {
  const res = await fetch(`${BASE}${JUPITER_ULTRA_EXECUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: payload.requestId,
      signedTransaction: payload.signedTransaction,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter Ultra /execute failed (${res.status}): ${text}`);
  }
  return (await res.json()) as UltraExecuteResponse;
}

export const JUPITER_QUOTE_USDC = USDC_MINT;
