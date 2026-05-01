// Jupiter Trigger Order v2 client.
//
// Reference: https://dev.jup.ag/docs/trigger
//
// Audit notes (docs/jupiter-api-audit.md): v2 introduces native OCO
// orders, JWT auth, ms-precision expiresAt, and a depositRequestId
// handshake on the deposit/order pair. None of those existed in the
// previous (v1-style) wrappers; this module replaces them entirely.
//
// Flow for a single trigger order (BUY at price, TP, or SL):
//   1.  GET   /trigger/v2/vault                 → user's vault address
//        404 → GET /trigger/v2/vault/register   (creates on first use)
//   2.  POST  /trigger/v2/deposit/craft         → unsigned tx + depositRequestId
//   3.  wallet.signTransaction(deposit)
//   4.  POST  /trigger/v2/orders/price          → { id, txSignature }
//        body keys depositRequestId + depositSignedTx + order params
//
// OCO orders (TP+SL pair, native to v2): same flow, just a different
// `orderType: 'OCO'` and tpPriceUsd / slPriceUsd instead of a single
// triggerPriceUsd. Saves us from manually managing sibling-cancel.
//
// Cancel:
//   1.  POST  /trigger/v2/orders/price/cancel/{orderId}         → { id, transaction, requestId }
//   2.  wallet.signTransaction(withdrawal)
//   3.  POST  /trigger/v2/orders/price/confirm-cancel/{orderId} → { id, txSignature }
//
// Update (avoids cancel+replace round-trip just to change price):
//       PATCH /trigger/v2/orders/price/{orderId}
//
// History (server-side, for Order Tracker reconciliation):
//   GET /trigger/v2/orders/history?state=active|past&...

import { USDC_MINT } from '@hunch-it/shared';
import { jupiterAuthedFetch, jupiterPublicFetch } from './client.js';

export type TriggerCondition = 'above' | 'below';
export type OrderType = 'single' | 'OCO' | 'OTOCO';
export type OrderState = 'active' | 'past';

interface JwtCarrier {
  getJwt: () => Promise<string>;
}

// ─── 1. Vault ───────────────────────────────────────────────────────────────

export interface VaultResponse {
  vault: string;
}

/**
 * GET the caller's vault address; on 404 (no vault yet) hits the
 * `/register` endpoint to create one. Both endpoints rely on the JWT
 * to identify the wallet — no `?wallet=` query needed in v2.
 */
export async function getVault(carrier: JwtCarrier): Promise<VaultResponse> {
  try {
    return await jupiterAuthedFetch<VaultResponse>('/trigger/v2/vault', { ...carrier });
  } catch (err) {
    // 404 → register-on-first-use. Other errors propagate.
    if ((err as { status?: number }).status === 404) {
      return jupiterAuthedFetch<VaultResponse>('/trigger/v2/vault/register', { ...carrier });
    }
    throw err;
  }
}

// ─── 2. Deposit craft ───────────────────────────────────────────────────────

export interface CraftDepositRequest {
  /** Mint of the asset being deposited into the vault (USDC for BUY, the
   *  xStock mint for SELL/TP/SL). */
  inputMint: string;
  /** Smallest-units of inputMint as a string (avoid number-precision
   *  loss; spec requires string). */
  inputAmount: string;
}

export interface CraftDepositResponse {
  /** base64 unsigned VersionedTransaction transferring inputAmount into
   *  the vault's escrow ATA. */
  transaction: string;
  /** UUID handed back from craft to bind the deposit to a subsequent
   *  order-create call. Required by /orders/price. */
  depositRequestId: string;
}

export async function craftDeposit(
  req: CraftDepositRequest,
  carrier: JwtCarrier,
): Promise<CraftDepositResponse> {
  return jupiterAuthedFetch<CraftDepositResponse>('/trigger/v2/deposit/craft', {
    ...carrier,
    method: 'POST',
    body: req,
  });
}

// ─── 3. Create order ────────────────────────────────────────────────────────

interface CommonCreateOrderRequest {
  depositRequestId: string;
  depositSignedTx: string;
  userPubkey: string;
  inputMint: string;
  inputAmount: string;
  outputMint: string;
  /** Mint we price the trigger against. For USDC-quoted xStocks this is
   *  the xStock mint (price source = Pyth via Jupiter). */
  triggerMint: string;
  /** Unix milliseconds (NOT seconds — v2 takes ms). */
  expiresAt: number;
}

export interface CreateSingleOrderRequest extends CommonCreateOrderRequest {
  orderType: 'single';
  triggerCondition: TriggerCondition;
  triggerPriceUsd: number;
  slippageBps?: number;
}

export interface CreateOcoOrderRequest extends CommonCreateOrderRequest {
  orderType: 'OCO';
  tpPriceUsd: number;
  slPriceUsd: number;
  tpSlippageBps?: number;
  slSlippageBps?: number;
}

export interface CreateOtocoOrderRequest extends CommonCreateOrderRequest {
  orderType: 'OTOCO';
  /** Trigger leg condition (the BUY). */
  triggerCondition: TriggerCondition;
  triggerPriceUsd: number;
  /** Once the trigger leg fills, the OCO pair below kicks in. */
  tpPriceUsd: number;
  slPriceUsd: number;
  slippageBps?: number;
  tpSlippageBps?: number;
  slSlippageBps?: number;
}

export type CreateOrderRequest =
  | CreateSingleOrderRequest
  | CreateOcoOrderRequest
  | CreateOtocoOrderRequest;

export interface CreateOrderResponse {
  id: string;
  txSignature: string;
}

export async function createOrder(
  req: CreateOrderRequest,
  carrier: JwtCarrier,
): Promise<CreateOrderResponse> {
  return jupiterAuthedFetch<CreateOrderResponse>('/trigger/v2/orders/price', {
    ...carrier,
    method: 'POST',
    body: req,
  });
}

// ─── 4. Update (PATCH price / slippage without cancel+replace) ─────────────

export interface UpdateOrderRequest {
  orderType?: OrderType;
  triggerPriceUsd?: number;
  slippageBps?: number;
  tpPriceUsd?: number;
  slPriceUsd?: number;
  tpSlippageBps?: number;
  slSlippageBps?: number;
  expiresAt?: number;
}

export async function updateOrder(
  orderId: string,
  patch: UpdateOrderRequest,
  carrier: JwtCarrier,
): Promise<{ id: string }> {
  return jupiterAuthedFetch<{ id: string }>(`/trigger/v2/orders/price/${orderId}`, {
    ...carrier,
    method: 'PATCH',
    body: patch,
  });
}

// ─── 5. Cancel ──────────────────────────────────────────────────────────────

export interface CancelInitiateResponse {
  id: string;
  /** Unsigned base64 withdrawal tx the wallet must sign. */
  transaction: string;
  /** Echoed back to confirm-cancel as `cancelRequestId`. */
  requestId: string;
}

export async function initiateCancel(
  orderId: string,
  carrier: JwtCarrier,
): Promise<CancelInitiateResponse> {
  return jupiterAuthedFetch<CancelInitiateResponse>(
    `/trigger/v2/orders/price/cancel/${orderId}`,
    { ...carrier, method: 'POST' },
  );
}

export interface CancelConfirmRequest {
  signedTransaction: string;
  cancelRequestId: string;
}

export interface CancelConfirmResponse {
  id: string;
  txSignature: string;
}

export async function confirmCancel(
  orderId: string,
  body: CancelConfirmRequest,
  carrier: JwtCarrier,
): Promise<CancelConfirmResponse> {
  return jupiterAuthedFetch<CancelConfirmResponse>(
    `/trigger/v2/orders/price/confirm-cancel/${orderId}`,
    { ...carrier, method: 'POST', body },
  );
}

// ─── 6. History ─────────────────────────────────────────────────────────────

export type FillEventContext = 'take_profit' | 'stop_loss' | 'buy_above' | 'buy_below';
export type EventType = 'deposit' | 'fill' | 'withdrawal' | 'cancelled' | 'expired';

export interface OrderEvent {
  type: EventType;
  timestamp: number;
  txSignature?: string;
  mint?: string;
  amount?: string;
  state?: string;
  outputMint?: string;
  outputAmount?: string;
  /** Only set on fill events; tells us whether this fill came from the
   *  TP, SL, or BUY leg of an OCO/OTOCO. */
  orderContext?: FillEventContext;
}

export interface JupiterOrderV2 {
  id: string;
  orderType: OrderType;
  /** Human-readable progression: 'open' | 'filled' | 'partial' | 'cancelled' | 'expired' | … */
  orderState: string;
  /** Internal state machine label; same shape as orderState in spirit. */
  rawState: string;
  userPubkey: string;
  privyWalletPubkey?: string;
  inputMint: string;
  initialInputAmount: string;
  remainingInputAmount: string;
  outputMint: string;
  triggerMint: string;
  triggerCondition?: TriggerCondition;
  triggerPriceUsd?: number;
  slippageBps?: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  triggeredAt?: number;
  outputAmount?: string;
  inputUsed?: string;
  fillPercent?: number;
  events: OrderEvent[];
}

export interface OrderHistoryRequest {
  state?: OrderState;
  mint?: string;
  limit?: number;
  offset?: number;
  sort?: 'updated_at' | 'created_at' | 'expires_at';
  dir?: 'asc' | 'desc';
}

export interface OrderHistoryResponse {
  orders: JupiterOrderV2[];
  pagination: { total: number; limit: number; offset: number };
}

export async function listOrderHistory(
  req: OrderHistoryRequest,
  carrier: JwtCarrier,
): Promise<OrderHistoryResponse> {
  const params = new URLSearchParams();
  if (req.state) params.set('state', req.state);
  if (req.mint) params.set('mint', req.mint);
  if (req.limit != null) params.set('limit', String(req.limit));
  if (req.offset != null) params.set('offset', String(req.offset));
  if (req.sort) params.set('sort', req.sort);
  if (req.dir) params.set('dir', req.dir);
  const qs = params.toString();
  return jupiterAuthedFetch<OrderHistoryResponse>(
    `/trigger/v2/orders/history${qs ? `?${qs}` : ''}`,
    carrier,
  );
}

// ─── Convenience builders for app-level call sites ─────────────────────────

export interface BuyTriggerParams {
  userPubkey: string;
  depositRequestId: string;
  depositSignedTx: string;
  outputMint: string;
  /** USDC amount in smallest units (6 decimals). */
  usdcAmount: string;
  triggerPriceUsd: number;
  /** 'below' = buy when price drops to trigger; 'above' = buy on breakout. */
  triggerCondition: TriggerCondition;
  slippageBps?: number;
  /** Unix MS expiry. Default to 7 days. */
  expiresAt?: number;
}

export function buildBuySingleOrder(p: BuyTriggerParams): CreateSingleOrderRequest {
  return {
    orderType: 'single',
    depositRequestId: p.depositRequestId,
    depositSignedTx: p.depositSignedTx,
    userPubkey: p.userPubkey,
    inputMint: USDC_MINT,
    outputMint: p.outputMint,
    triggerMint: p.outputMint,
    inputAmount: p.usdcAmount,
    triggerCondition: p.triggerCondition,
    triggerPriceUsd: p.triggerPriceUsd,
    slippageBps: p.slippageBps,
    expiresAt: p.expiresAt ?? Date.now() + 7 * 24 * 3600 * 1000,
  };
}

export interface SellOcoParams {
  userPubkey: string;
  depositRequestId: string;
  depositSignedTx: string;
  /** xStock mint we're selling. */
  inputMint: string;
  /** Smallest-units of inputMint to sell across BOTH legs. */
  inputAmount: string;
  tpPriceUsd: number;
  slPriceUsd: number;
  tpSlippageBps?: number;
  slSlippageBps?: number;
  expiresAt?: number;
}

export function buildSellOcoOrder(p: SellOcoParams): CreateOcoOrderRequest {
  return {
    orderType: 'OCO',
    depositRequestId: p.depositRequestId,
    depositSignedTx: p.depositSignedTx,
    userPubkey: p.userPubkey,
    inputMint: p.inputMint,
    outputMint: USDC_MINT,
    triggerMint: p.inputMint,
    inputAmount: p.inputAmount,
    tpPriceUsd: p.tpPriceUsd,
    slPriceUsd: p.slPriceUsd,
    tpSlippageBps: p.tpSlippageBps,
    slSlippageBps: p.slSlippageBps,
    expiresAt: p.expiresAt ?? Date.now() + 7 * 24 * 3600 * 1000,
  };
}

// Public re-exports for the public unauthenticated path (challenge/verify
// live in ./auth.ts and need only the api-key, not a JWT).
export { jupiterPublicFetch };
