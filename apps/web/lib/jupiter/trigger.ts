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

// Trigger v2 endpoints (notably /history) return 401 on lite-api.jup.ag and
// 200 on api.jup.ag without an API key, so the trigger module pins its own
// base separate from the shared NEXT_PUBLIC_JUPITER_API_BASE that Ultra
// uses. Override with NEXT_PUBLIC_JUPITER_TRIGGER_API_BASE if needed.
const JUPITER_BASE =
  process.env.NEXT_PUBLIC_JUPITER_TRIGGER_API_BASE ?? 'https://api.jup.ag';

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
//
// Trigger v2 splits history into two display states:
//   - `active`: still pending fill (display states: open / partially_filled
//     plus the intermediate states pending / executing).
//   - `past`:   terminal (filled / cancelled / expired / failed plus the
//     compound rawStates partial_fill_success and oco_cancelled).
//
// The endpoint paginates with `limit` + `offset` and returns
//   { orders: [...], pagination: { total, limit, offset } }
// Each order has `orderState` (display) plus `rawState` (full execution
// state machine) and lowercase amount fields. We normalise to a legacy
// uppercase `status` enum + raw passthrough so existing callers keep
// working and dev tooling can inspect the lifecycle.

export type JupiterOrderState = 'active' | 'past';

export type JupiterOrderStatus =
  | 'OPEN'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'FAILED';

export interface JupiterOrderHistoryEntry {
  id: string;
  status: JupiterOrderStatus;
  /** Original Jupiter display state (open / partially_filled / filled / …). */
  orderState?: string;
  /** Full execution state machine (pending / executing / partial_fill_success / …). */
  rawState?: string;
  inputMint?: string;
  outputMint?: string;
  triggerPriceUsd?: number;
  /** Token-units of the input asset originally requested. */
  initialInputAmount?: string;
  /** Token-units of the input asset still held in the vault. */
  remainingInputAmount?: string;
  /** Legacy alias preserved for old callers; mirrors `initialInputAmount`. */
  inAmount?: string;
  /** Token-units of the output asset accumulated so far. */
  outAmount?: string;
  /** Legacy alias preserved for old callers; mirrors `outAmount`. */
  filledAmount?: string;
  fillPercent?: number;
  filledAt?: number;
  triggeredAt?: number;
  updatedAt?: number;
  createdAt?: number;
  expiresAt?: number;
}

interface ListOrderHistoryInput {
  wallet: string;
  state?: JupiterOrderState;
  /**
   * Page size for the underlying API. Capped at 50 (Jupiter default).
   * The hard cap exists so a malformed `pagination.total` cannot drive
   * a runaway loop.
   */
  limit?: number;
  /**
   * Legacy filter, kept for callers that grep by status. We map the union
   * onto state=active | past + a client-side filter on the result.
   */
  statuses?: JupiterOrderStatus[];
}

interface RawTriggerOrder {
  orderId?: string;
  id?: string;
  orderState?: string;
  rawState?: string;
  state?: string;
  inputMint?: string;
  outputMint?: string;
  triggerPriceUsd?: string | number;
  triggerPrice?: string | number;
  initialInputAmount?: string;
  remainingInputAmount?: string;
  inputUsed?: string;
  outputAmount?: string;
  inAmount?: string;
  outAmount?: string;
  filledAt?: string | number;
  triggeredAt?: string | number;
  updatedAt?: string | number;
  expiresAt?: string | number;
  createdAt?: string | number;
  fillPercent?: string | number;
}

interface RawTriggerHistoryPagination {
  total?: number;
  limit?: number;
  offset?: number;
}

interface RawTriggerHistoryResponse {
  orders?: RawTriggerOrder[];
  pagination?: RawTriggerHistoryPagination;
}

const ACTIVE_STATUSES: JupiterOrderStatus[] = ['OPEN', 'PARTIALLY_FILLED'];

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGES = 50;

function normaliseStatus(
  orderState: string | undefined,
  rawState: string | undefined,
  fillPercent: number | undefined,
): JupiterOrderStatus {
  // rawState wins when it carries terminal meaning the display state hides.
  switch (rawState?.toLowerCase()) {
    case 'partial_fill_success':
      return 'PARTIALLY_FILLED';
    case 'oco_cancelled':
      return 'CANCELLED';
  }
  switch (orderState?.toLowerCase()) {
    case 'pending':
    case 'executing':
    case 'active':
    case 'open':
      return fillPercent && fillPercent > 0 ? 'PARTIALLY_FILLED' : 'OPEN';
    case 'partially_filled':
    case 'partial':
      return 'PARTIALLY_FILLED';
    case 'filled':
      return 'FILLED';
    case 'pending_withdraw':
    case 'cancelled':
    case 'canceled':
      return 'CANCELLED';
    case 'expired':
      return 'EXPIRED';
    case 'failed':
      return 'FAILED';
    default:
      return 'OPEN';
  }
}

function toNumberOrUndefined(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : undefined;
}

function normaliseOrder(raw: RawTriggerOrder): JupiterOrderHistoryEntry {
  const fillPercent = toNumberOrUndefined(raw.fillPercent);
  const orderState = raw.orderState ?? raw.state;
  const initialInput = raw.initialInputAmount ?? raw.inAmount;
  // Legacy `inAmount` callers (e.g. execution-price math) expect the
  // *consumed* amount, not the requested amount. Preserve old semantics:
  // prefer `inputUsed`, fall back to alternatives only if absent.
  const consumedInput = raw.inputUsed ?? raw.inAmount ?? raw.initialInputAmount;
  const out = raw.outputAmount ?? raw.outAmount;
  return {
    id: raw.orderId ?? raw.id ?? '',
    status: normaliseStatus(orderState, raw.rawState, fillPercent),
    orderState,
    rawState: raw.rawState,
    inputMint: raw.inputMint,
    outputMint: raw.outputMint,
    triggerPriceUsd: toNumberOrUndefined(raw.triggerPriceUsd ?? raw.triggerPrice),
    initialInputAmount: initialInput,
    remainingInputAmount: raw.remainingInputAmount,
    inAmount: consumedInput,
    outAmount: out,
    filledAmount: out,
    fillPercent,
    filledAt: toNumberOrUndefined(raw.filledAt),
    triggeredAt: toNumberOrUndefined(raw.triggeredAt),
    updatedAt: toNumberOrUndefined(raw.updatedAt),
    createdAt: toNumberOrUndefined(raw.createdAt),
    expiresAt: toNumberOrUndefined(raw.expiresAt),
  };
}

export async function listOrderHistory(
  input: ListOrderHistoryInput,
): Promise<JupiterOrderHistoryEntry[]> {
  const filterStatuses = input.statuses;
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_PAGE_LIMIT, DEFAULT_PAGE_LIMIT));
  const states: JupiterOrderState[] = (() => {
    if (input.state) return [input.state];
    if (!filterStatuses?.length) return ['active', 'past'];
    const wantsActive = filterStatuses.some((s) => ACTIVE_STATUSES.includes(s));
    const wantsPast = filterStatuses.some((s) => !ACTIVE_STATUSES.includes(s));
    const out: JupiterOrderState[] = [];
    if (wantsActive) out.push('active');
    if (wantsPast) out.push('past');
    return out.length ? out : ['active', 'past'];
  })();

  const all: JupiterOrderHistoryEntry[] = [];
  for (const state of states) {
    let offset = 0;
    let pages = 0;
    while (pages < MAX_PAGES) {
      const params = new URLSearchParams({
        user: input.wallet,
        state,
        limit: String(limit),
        offset: String(offset),
      });
      const res = await fetch(
        `${JUPITER_BASE}${JUPITER_TRIGGER_ORDERS_HISTORY}?${params.toString()}`,
        { headers: { accept: 'application/json' } },
      );
      if (!res.ok) {
        throw new Error(
          `Jupiter Trigger orders/history failed: ${res.status} ${res.statusText}`,
        );
      }
      const body = (await res.json()) as RawTriggerHistoryResponse;
      const orders = body.orders ?? [];
      for (const o of orders) all.push(normaliseOrder(o));

      pages += 1;
      const total = toNumberOrUndefined(body.pagination?.total);
      const fetched = offset + orders.length;
      if (orders.length === 0) break;
      if (orders.length < limit) break;
      if (total != null && fetched >= total) break;
      offset = fetched;
    }
  }

  if (filterStatuses?.length) {
    return all.filter((o) => filterStatuses.includes(o.status));
  }
  return all;
}

// ─── Convenience helpers ────────────────────────────────────────────────────

/**
 * Pick a trigger condition based on whether the user wants to buy lower
 * (limit) or buy on breakout (above). Both branches produce a "wait for
 * movement" order — auto-derive cannot express instant-fill; that would
 * require an explicit condition selector.
 *
 * Truth table:
 *   trigger  <  current  → 'below'  (limit-buy on dip; SL on long)
 *   trigger === current  → 'above'  (degenerate; effectively wait-for-rise)
 *   trigger  >  current  → 'above'  (breakout-buy; TP on long)
 *   NaN inputs           → 'above'  (NaN < x is false → falsy branch)
 *
 * Callers that need explicit semantics (TP/SL on a SELL exit) should pass
 * the literal 'above' / 'below' to placeBuy / placeSellExit instead.
 */
export function deriveTriggerCondition(
  trigger: number,
  currentPrice: number,
): TriggerCondition {
  return trigger < currentPrice ? 'below' : 'above';
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
