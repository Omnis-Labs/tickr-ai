// Runtime facade for the real synthetic-trigger product path.
//
// Synthetic-trigger architecture: TP/SL legs are DB-only synthetic
// Orders. The ws-server price monitor watches them against Pyth and either
// auto-executes delegated triggers or emits trigger:hit fallback when the
// user needs to sign an Ultra swap.
// placeOcoExit / cancelExits / replaceExits operate on those DB rows
// directly.

export interface RuntimeExitSnapshot {
  tpPriceUsd: number | null;
  slPriceUsd: number | null;
}

export interface RuntimeMeta {
  mint: string;
  decimals: number;
}

export interface RuntimeCloseResult {
  executionPrice: number | null;
  tokenAmount: number;
  txSignature: string | null;
}

/**
 * The strategy interface. New environments (testnet, integration, …)
 * implement this; pages don't change.
 */
export interface Runtime {
  /** Cancel the open OCO TP+SL pair attached to a position. Returns a
   *  snapshot of the cancelled prices so callers can rollback if a
   *  follow-up step fails. */
  cancelExits(positionId: string): Promise<RuntimeExitSnapshot>;

  /** Place TP + SL synthetic exit Orders (two DB rows, no Jupiter
   *  call). The ws-server trigger-monitor will pick them up. */
  placeOcoExit(args: {
    positionId: string;
    walletAddress: string;
    ticker: string;
    meta: RuntimeMeta;
    tokenAmount: number;
    tpPriceUsd: number;
    slPriceUsd: number;
  }): Promise<{ id: string }>;

  /** Atomic Adjust TP/SL via PUT /api/positions/[id]/protection. The
   *  server cancels the matching OPEN exit Orders and creates new ones
   *  in one transaction. At least one of next.tpPriceUsd /
   *  next.slPriceUsd must be non-null; the other leg is left as-is. */
  replaceExits(args: {
    positionId: string;
    next: { tpPriceUsd: number | null; slPriceUsd: number | null };
  }): Promise<void>;

  /** Market-sell + server settlement. The lifecycle cancels open exits atomically. */
  closePosition(args: {
    positionId: string;
    ticker?: string | null;
    meta: RuntimeMeta;
    /** Mark price retained for callers that need a fallback when the swap
     *  output cannot produce an execution price. */
    fallbackMarkPrice: number;
    /** Sell exactly this many tokens. When set (recommended for the
     *  CloseButton flow), avoids sweeping unrelated dust or a separate
     *  position in the same mint. Null/omit falls back to sellAll
     *  (drains the wallet for that mint — panic-close semantics). */
    tokenAmount?: number | null;
    /** When set, the runtime persists via
     *  POST /api/proposals/<id>/sell-confirm so the SELL Proposal flips
     *  status=EXECUTED and the Trade row carries the proposal id. */
    sellProposalId?: string;
  }): Promise<RuntimeCloseResult>;
}
