// Jupiter Trigger Order v2 client.
//
// Reference: https://dev.jup.ag/docs/trigger-api
//
// Flow for placing a BUY trigger order:
//   1. GET  /trigger/v2/vault?wallet=<wallet>
//        → returns the user's vault address (created on first request).
//   2. POST /trigger/v2/deposit/craft
//        body: { wallet, vault, mint, amount }
//        → returns an unsigned base64 deposit transaction.
//   3. wallet.signTransaction(VersionedTransaction)
//   4. POST /trigger/v2/orders/price
//        body: {
//          vault,
//          signedDepositTransaction,
//          inputMint,
//          outputMint,
//          inputAmount,
//          triggerPriceUsd,
//          triggerCondition,    // "below" | "above"
//          slippageBps,
//          expiresAt             // unix seconds
//        }
//        → returns { id, txSignature }
//
// Cancel flow:
//   1. POST /trigger/v2/orders/cancel/initiate { orderId } → unsigned withdrawal tx
//   2. wallet.signTransaction
//   3. POST /trigger/v2/orders/cancel/confirm { orderId, signedWithdrawalTx } → ack
//
// Server-side (Order Tracker):
//   GET /trigger/v2/orders/history?wallet=<wallet>&statuses=open,filled,...
//
// NOTE: Jupiter API request/response shapes evolve. The wrappers below are
// best-effort and intentionally narrow — verify against current Jupiter docs
// before pushing to production.

import {
  JUPITER_TRIGGER_CANCEL_CONFIRM,
  JUPITER_TRIGGER_CANCEL_INITIATE,
  JUPITER_TRIGGER_DEPOSIT_CRAFT,
  JUPITER_TRIGGER_ORDERS_HISTORY,
  JUPITER_TRIGGER_ORDERS_PRICE,
  JUPITER_TRIGGER_VAULT,
  USDC_MINT,
} from '@hunch-it/shared';

const JUPITER_BASE =
  process.env.NEXT_PUBLIC_JUPITER_API_BASE ?? 'https://lite-api.jup.ag';

// ─── 1. Vault ───────────────────────────────────────────────────────────────

export interface VaultResponse {
  vault: string; // base58
  exists: boolean;
}

export async function getVault(wallet: string): Promise<VaultResponse> {
  const url = `${JUPITER_BASE}${JUPITER_TRIGGER_VAULT}?wallet=${encodeURIComponent(wallet)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Jupiter Trigger vault failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as VaultResponse;
}

// ─── 2. Deposit craft ───────────────────────────────────────────────────────

export interface CraftDepositRequest {
  wallet: string;
  vault: string;
  mint: string; // SPL mint of the asset being deposited (e.g. USDC for BUY)
  amount: string; // smallest units of `mint`
}

export interface CraftDepositResponse {
  transaction: string; // base64 unsigned tx
}

export async function craftDeposit(req: CraftDepositRequest): Promise<CraftDepositResponse> {
  const res = await fetch(`${JUPITER_BASE}${JUPITER_TRIGGER_DEPOSIT_CRAFT}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter Trigger deposit/craft failed (${res.status}): ${text}`);
  }
  return (await res.json()) as CraftDepositResponse;
}

// ─── 3. Place price-trigger order ───────────────────────────────────────────

export type TriggerCondition = 'above' | 'below';

export interface PlacePriceOrderRequest {
  vault: string;
  signedDepositTransaction: string; // base64
  inputMint: string;
  outputMint: string;
  inputAmount: string; // smallest units of inputMint
  triggerPriceUsd: number;
  triggerCondition: TriggerCondition;
  slippageBps: number;
  expiresAt: number; // unix seconds
}

export interface PlacePriceOrderResponse {
  id: string; // Jupiter order UUID
  txSignature: string; // deposit tx signature
}

export async function placePriceOrder(
  req: PlacePriceOrderRequest,
): Promise<PlacePriceOrderResponse> {
  const res = await fetch(`${JUPITER_BASE}${JUPITER_TRIGGER_ORDERS_PRICE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter Trigger orders/price failed (${res.status}): ${text}`);
  }
  return (await res.json()) as PlacePriceOrderResponse;
}

// ─── 4. Cancel ──────────────────────────────────────────────────────────────

export interface CancelInitiateResponse {
  transaction: string; // base64 unsigned withdrawal tx
}

export async function initiateCancel(orderId: string): Promise<CancelInitiateResponse> {
  const res = await fetch(`${JUPITER_BASE}${JUPITER_TRIGGER_CANCEL_INITIATE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ orderId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter Trigger cancel/initiate failed (${res.status}): ${text}`);
  }
  return (await res.json()) as CancelInitiateResponse;
}

export interface CancelConfirmResponse {
  ok: true;
  txSignature: string;
}

export async function confirmCancel(input: {
  orderId: string;
  signedWithdrawalTx: string;
}): Promise<CancelConfirmResponse> {
  const res = await fetch(`${JUPITER_BASE}${JUPITER_TRIGGER_CANCEL_CONFIRM}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter Trigger cancel/confirm failed (${res.status}): ${text}`);
  }
  return (await res.json()) as CancelConfirmResponse;
}

// ─── 5. History (server-side polling for Order Tracker) ─────────────────────

export type JupiterOrderStatus = 'OPEN' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'EXPIRED';

export interface JupiterOrderHistoryEntry {
  id: string;
  status: JupiterOrderStatus;
  filledAmount?: string;
  outAmount?: string;
  inAmount?: string;
  filledAt?: number;
  expiresAt?: number;
}

export async function listOrderHistory(input: {
  wallet: string;
  statuses?: JupiterOrderStatus[];
}): Promise<JupiterOrderHistoryEntry[]> {
  const params = new URLSearchParams({ wallet: input.wallet });
  if (input.statuses?.length) params.set('statuses', input.statuses.join(','));
  const res = await fetch(
    `${JUPITER_BASE}${JUPITER_TRIGGER_ORDERS_HISTORY}?${params.toString()}`,
    { headers: { accept: 'application/json' } },
  );
  if (!res.ok) {
    throw new Error(`Jupiter Trigger orders/history failed: ${res.status} ${res.statusText}`);
  }
  const j = (await res.json()) as { orders?: JupiterOrderHistoryEntry[] };
  return j.orders ?? [];
}

// ─── Convenience: build a BUY request from app-level params ─────────────────

export interface BuyOrderParamsFromApp {
  walletAddress: string;
  vault: string;
  signedDepositTransaction: string;
  /** xStock mint we're buying. */
  outputMint: string;
  /** USDC amount in smallest units (6 decimals). */
  usdcAmount: string;
  triggerPriceUsd: number;
  /** "below" = buy when price drops to trigger; "above" = buy on breakout. */
  triggerCondition: TriggerCondition;
  slippageBps: number;
  expiresAt: number;
}

export function buildBuyOrderRequest(p: BuyOrderParamsFromApp): PlacePriceOrderRequest {
  return {
    vault: p.vault,
    signedDepositTransaction: p.signedDepositTransaction,
    inputMint: USDC_MINT,
    outputMint: p.outputMint,
    inputAmount: p.usdcAmount,
    triggerPriceUsd: p.triggerPriceUsd,
    triggerCondition: p.triggerCondition,
    slippageBps: p.slippageBps,
    expiresAt: p.expiresAt,
  };
}
