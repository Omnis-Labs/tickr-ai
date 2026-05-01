// Runtime adapter — the demo/live strategy boundary.
//
// Goal: replace `if (isDemo()) … else …` scattered across page handlers
// with a single dispatch on a typed Runtime. Live and demo each implement
// the same interface; pages call methods without knowing which one is
// active.
//
// v2 update: TP/SL are now placed as a single OCO order (Jupiter Trigger
// v2 native). The runtime exposes one `placeOcoExit` instead of the
// per-leg `placeExit`, and replaceExits / cancelExits work on the OCO
// pair as a unit.

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

  /** Place a TP+SL OCO order. Single Jupiter order, two DB Order rows. */
  placeOcoExit(args: {
    positionId: string;
    meta: RuntimeMeta;
    tokenAmount: number;
    tpPriceUsd: number;
    slPriceUsd: number;
  }): Promise<{ id: string }>;

  /** Cancel current OCO, then place a new one; rollback on failure. */
  replaceExits(args: {
    positionId: string;
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
    /** When set, the runtime persists via
     *  POST /api/proposals/<id>/sell-confirm so the SELL Proposal flips
     *  status=EXECUTED and the Trade row carries the proposal id. */
    sellProposalId?: string;
  }): Promise<RuntimeCloseResult>;

  /** True if this runtime simulates state in memory. */
  readonly isDemo: boolean;
}
