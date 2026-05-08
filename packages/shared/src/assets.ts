// Asset abstraction — one registry that every consumer (Proposal Generator,
// Order Tracker, Position Detail, ProposalModal, and tests) reads through.
//
// Wire convention: every `ticker` column on Proposal / Position / Order /
// Trade now stores an `AssetId` (e.g. "AAPLx", "wBTC", "HYPE"). The column
// name didn't change to avoid a destructive migration, but the value space
// did — see the schema comment.

import { XSTOCK_TICKERS, XSTOCKS, type XStockTicker } from './constants.js';

export type AssetKind = 'XSTOCK' | 'CRYPTO';
export type CryptoAssetId = 'wBTC' | 'ETH' | 'BNB' | 'wXRP' | 'TRX' | 'HYPE';

export interface Asset {
  /** Canonical id stored in DB and shown in the UI. */
  assetId: string;
  /** Display symbol (usually the same as assetId). */
  displaySymbol: string;
  /** Human name. */
  name: string;
  kind: AssetKind;
  /** SPL mint or wrapper mint, base58. Empty string until verified. */
  mint: string;
  /** Token decimals for swap amount preparation and display. */
  decimals: number;
  /** Pyth Hermes price feed id (0x-prefixed hex). Empty until populated. */
  pythFeedId: string;
  /** Pyth Benchmarks/Hermes symbol, e.g. "Crypto.AAPLX/USD". */
  pythSymbol: string;
}

const xStockEntries: Asset[] = XSTOCK_TICKERS.map((symbol) => {
  const meta = XSTOCKS[symbol];
  return {
    assetId: symbol,
    displaySymbol: symbol,
    name: meta.name,
    kind: 'XSTOCK' as const,
    mint: meta.mint,
    decimals: meta.decimals,
    pythFeedId: meta.pythFeedId,
    pythSymbol: meta.pythSymbol,
  };
});

const cryptoEntries: Asset[] = [
  {
    assetId: 'wBTC',
    displaySymbol: 'wBTC',
    name: 'Wrapped BTC (Portal)',
    kind: 'CRYPTO',
    mint: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
    decimals: 8,
    pythFeedId: '0xc9d8b075a5c69303365ae23633d4e085199bf5c520a3b90fed1322a0342ffc33',
    pythSymbol: 'Crypto.WBTC/USD',
  },
  {
    assetId: 'ETH',
    displaySymbol: 'ETH',
    name: 'Ether (Portal)',
    kind: 'CRYPTO',
    mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
    decimals: 8,
    pythFeedId: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    pythSymbol: 'Crypto.ETH/USD',
  },
  {
    assetId: 'BNB',
    displaySymbol: 'BNB',
    name: 'Binance Coin (Portal)',
    kind: 'CRYPTO',
    mint: '9gP2kCy3wA1ctvYWQk75guqXuHfrEomqydHLtcTCqiLa',
    decimals: 8,
    pythFeedId: '0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f',
    pythSymbol: 'Crypto.BNB/USD',
  },
  {
    assetId: 'wXRP',
    displaySymbol: 'wXRP',
    name: 'Wrapped XRP',
    kind: 'CRYPTO',
    mint: '6UpQcMAb5xMzxc7ZfPaVMgx3KqsvKZdT5U718BzD5We2',
    decimals: 6,
    pythFeedId: '0xec5d399846a9209f3fe5881d70aae9268c94339ff9817e8d18ff19fa05eea1c8',
    pythSymbol: 'Crypto.XRP/USD',
  },
  {
    assetId: 'TRX',
    displaySymbol: 'TRX',
    name: 'TRON',
    kind: 'CRYPTO',
    mint: 'GbbesPbaYh5uiAZSYNXTc7w9jty1rpg3P9L4JeN4LkKc',
    decimals: 6,
    pythFeedId: '0x67aed5a24fdad045475e7195c98a98aea119c763f272d4523f5bac93a4f33c2b',
    pythSymbol: 'Crypto.TRX/USD',
  },
  {
    assetId: 'HYPE',
    displaySymbol: 'HYPE',
    name: 'HYPE',
    kind: 'CRYPTO',
    mint: '98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g',
    decimals: 9,
    pythFeedId: '0x4279e31cc369bbcc2faf022b382b080e32a8e689ff20fbc530d2a603eb6cd98b',
    pythSymbol: 'Crypto.HYPE/USD',
  },
];

export const ASSET_REGISTRY: readonly Asset[] = [...xStockEntries, ...cryptoEntries];

const byId = new Map<string, Asset>();
for (const a of ASSET_REGISTRY) byId.set(a.assetId, a);

export type AssetId = string; // not a literal union — registry can grow at runtime in tests

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

/** Crypto subset used by the signal generator. SOL is intentionally excluded. */
export function getCryptoAssets(): readonly Asset[] {
  return cryptoEntries;
}

/** Assets eligible for proposal generation when market data is configured. */
export function getSignalAssets(): readonly Asset[] {
  return ASSET_REGISTRY.filter((asset) => asset.pythFeedId.length > 0);
}

/** Asset kind helpers — useful for type-narrowing in ProposalModal et al. */
export function isXStock(assetId: string): boolean {
  return getAssetById(assetId)?.kind === 'XSTOCK';
}
export function isCrypto(assetId: string): boolean {
  return getAssetById(assetId)?.kind === 'CRYPTO';
}
