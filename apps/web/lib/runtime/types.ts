// Runtime adapter — the demo/live strategy boundary.
//
// Goal: replace `if (isDemo()) … else …` scattered across page handlers
// with a single dispatch on a typed Runtime. Live and demo each implement
// the same interface; pages call methods without knowing which one is
// active. Keeps the demo path from drifting because the type-checker now
// enforces parity.
//
// MVP scope (first wave):
//   - exits: place / replace / cancel TP-SL legs
//   - swap: market sell for close-position flows
//   - persistClose: server-side close ack
//
// Pages still own UI state (busy / toasts / navigation); the runtime is
// a thin async I/O strategy. Follow-up waves can pull more under this
// roof (placeBuy, fetchPositions, syncPortfolio) once the first wave
// proves out.

export interface RuntimeExitLeg {
  kind: 'TAKE_PROFIT' | 'STOP_LOSS';
  triggerPriceUsd: number;
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
  /** Cancel any open TP / SL trigger orders attached to a position.
   *  Returns the cancelled legs so callers can rollback if needed. */
  cancelExits(positionId: string): Promise<RuntimeExitLeg[]>;

  /** Place a single SELL leg. */
  placeExit(args: {
    positionId: string;
    meta: RuntimeMeta;
    tokenAmount: number;
    triggerPriceUsd: number;
    triggerCondition: 'above' | 'below';
  }): Promise<{ id: string }>;

  /** Cancel current legs, then place new ones; rollback to old legs on
   *  partial failure. */
  replaceExits(args: {
    positionId: string;
    meta: RuntimeMeta;
    tokenAmount: number;
    legs: Array<{ kind: 'TAKE_PROFIT' | 'STOP_LOSS'; triggerPriceUsd: number | null }>;
  }): Promise<void>;

  /** Cancel exits + market-sell + server persist. Used by Position Detail
   *  Close, SellProposalView, and Settings panic close-all. */
  closePosition(args: {
    positionId: string;
    meta: RuntimeMeta;
    /** Mark price for the local PnL fallback when the swap output
     *  doesn't return an executionPrice (demo mode). */
    fallbackMarkPrice: number;
    /** When set, the runtime persists via
     *  POST /api/proposals/<id>/sell-confirm so the SELL Proposal flips
     *  status=EXECUTED and the Trade row carries the proposal id (for
     *  back-evaluator attribution). Otherwise it goes through
     *  POST /api/positions/<id>/close. */
    sellProposalId?: string;
  }): Promise<RuntimeCloseResult>;

  /** True if this runtime simulates state in memory (no chain or HTTP
   *  side effects). UI may use this to guard demo-only affordances like
   *  "Simulate TP fill" buttons. */
  readonly isDemo: boolean;
}
