// Runtime adapter — the demo/live strategy boundary.
//
// Goal: replace `if (isDemo()) … else …` scattered across page handlers
// with a single dispatch on a typed Runtime. Live and demo each implement
// the same interface; pages call methods without knowing which one is
// active.
//
// Synthetic-trigger architecture: TP/SL legs are DB-only synthetic
// Orders (jupiterOrderId NULL); the ws-server price monitor watches
// them against Pyth and emits trigger:hit when the user needs to sign
// an Ultra swap. placeOcoExit / cancelExits / replaceExits operate on
// those DB rows directly, no Jupiter Trigger v2 escrow involved.

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

  /** Cancel current exits, then place new ones; rollback on failure. */
  replaceExits(args: {
    positionId: string;
    walletAddress: string;
    ticker: string;
    meta: RuntimeMeta;
    tokenAmount: number;
    next: { tpPriceUsd: number | null; slPriceUsd: number | null };
  }): Promise<void>;

  /** Cancel exits + market-sell + server persist. */
  closePosition(args: {
    positionId: string;
    meta: RuntimeMeta;
    /** Mark price for the local PnL fallback when the swap output
     *  doesn't return an executionPrice (demo mode). */
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

  /** True if this runtime simulates state in memory. */
  readonly isDemo: boolean;
}
