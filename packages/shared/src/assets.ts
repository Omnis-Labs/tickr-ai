// Asset abstraction — one registry that every consumer (Proposal Generator,
// Order Tracker, Position Detail, ProposalModal, demo data) reads through.
//
// Why this exists: the ws-server, schema and frontend used to look up xStock
// mints + Pyth feed ids via `XSTOCKS[xStockToBare(p.ticker)]`. That pattern
// only knows about `BareTicker` (xStock-family) and silently breaks the day
// we add SOL or cbBTC. With a typed `AssetId` union and `getAssetById()`,
// new asset kinds plug in by adding a row here.
//
// Wire convention: every `ticker` column on Proposal / Position / Order /
// Trade now stores an `AssetId` (e.g. "AAPLx", "SOL", "cbBTC"). The column
// name didn't change to avoid a destructive migration, but the value space
// did — see the schema comment.

import { XSTOCK_TICKERS, XSTOCKS, type XStockTicker } from './constants.js';

export type AssetKind = 'XSTOCK' | 'CRYPTO';

export interface Asset {
  /** Canonical id stored in DB. Same string across UI / API / DB / Pyth. */
  assetId: string;
  /** Display symbol (often == assetId, but may differ for crypto wraps). */
  displaySymbol: string;
  /** Human name. */
  name: string;
  /** Equity ticker for stock-family lookups (Pyth Benchmarks symbol etc.).
   *  null for crypto. */
  underlyingTicker: string | null;
  kind: AssetKind;
  /** SPL mint or wrapper mint, base58. Empty string until verified. */
  mint: string;
  /** SPL Token-2022 vs vanilla Token; xStocks are 2022, SOL is wrapped. */
  decimals: number;
  /** Pyth Hermes price feed id (0x-prefixed hex). Empty until populated. */
  pythFeedId: string;
}

const xStockEntries: Asset[] = XSTOCK_TICKERS.map((symbol) => {
  const meta = XSTOCKS[symbol.slice(0, -1) as keyof typeof XSTOCKS];
  return {
    assetId: symbol,
    displaySymbol: symbol,
    name: meta.name,
    underlyingTicker: meta.ticker,
    kind: 'XSTOCK' as const,
    mint: meta.mint,
    decimals: meta.decimals,
    pythFeedId: meta.pythFeedId,
  };
});

// Crypto rows are placeholders until verifier scripts populate mints + feeds.
// They unblock the abstraction (frontend / proposal-generator can already
// branch on Asset.kind) without forcing real data plumbing yet.
const cryptoEntries: Asset[] = [
  {
    assetId: 'SOL',
    displaySymbol: 'SOL',
    name: 'Solana',
    underlyingTicker: null,
    kind: 'CRYPTO',
    mint: 'So11111111111111111111111111111111111111112',
    decimals: 9,
    pythFeedId: '',
  },
  {
    assetId: 'cbBTC',
    displaySymbol: 'cbBTC',
    name: 'Coinbase Wrapped BTC',
    underlyingTicker: null,
    kind: 'CRYPTO',
    mint: '',
    decimals: 8,
    pythFeedId: '',
  },
];

export const ASSET_REGISTRY: readonly Asset[] = [...xStockEntries, ...cryptoEntries];

const byId = new Map<string, Asset>();
for (const a of ASSET_REGISTRY) byId.set(a.assetId, a);

export type AssetId = string; // not a literal union — registry can grow at runtime in tests / demos

export function getAssetById(assetId: string): Asset | undefined {
  return byId.get(assetId);
}

export function requireAsset(assetId: string): Asset {
  const a = byId.get(assetId);
  if (!a) throw new Error(`[assets] unknown assetId: ${assetId}`);
  return a;
}

/** XStock subset used by Pyth scanner / signal generator. */
export function getXStockAssets(): readonly Asset[] {
  return xStockEntries;
}

/** Asset kind helpers — useful for type-narrowing in ProposalModal et al. */
export function isXStock(assetId: string): boolean {
  return getAssetById(assetId)?.kind === 'XSTOCK';
}
export function isCrypto(assetId: string): boolean {
  return getAssetById(assetId)?.kind === 'CRYPTO';
}

/** Compatibility: `xStockToBare` callers can drop in `assetToBare` for any
 * stock asset. Returns the underlying ticker for Pyth lookups. */
export function assetToUnderlyingTicker(assetId: string): string | null {
  return getAssetById(assetId)?.underlyingTicker ?? null;
}
