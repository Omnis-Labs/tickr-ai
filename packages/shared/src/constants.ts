// Hunch It — canonical constants for tradable asset symbols, mints, and oracles.

export interface XStockMeta {
  symbol: XStockTicker; // on-chain symbol with "x" suffix (e.g. "AAPLx")
  name: string;
  mint: string; // SPL Token-2022 mint, base58
  decimals: number;
  pythFeedId: string; // 0x-prefixed 32-byte hex for the Crypto.<XSTOCK>/USD feed
  pythSymbol: string; // Pyth Benchmarks/Hermes symbol, e.g. "Crypto.AAPLX/USD"
}

export const XSTOCK_TICKERS = [
  'AAPLx',
  'NVDAx',
  'TSLAx',
  'SPYx',
  'QQQx',
  'GOOGLx',
  'METAx',
] as const;
export type XStockTicker = (typeof XSTOCK_TICKERS)[number];

// Mint addresses verified on Solana mainnet via Helius RPC. Pyth feed ids are
// xStock-native Crypto.<SYMBOL>/USD feeds, not underlying equity feeds.
// Re-run `pnpm --filter @hunch-it/ws-server verify:xstocks` and
// `pnpm --filter @hunch-it/ws-server fetch:pyth-feeds` to refresh.
export const XSTOCKS: Record<XStockTicker, XStockMeta> = {
  AAPLx: {
    symbol: 'AAPLx',
    name: 'Apple xStock',
    mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
    decimals: 8,
    pythFeedId: '0x978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675',
    pythSymbol: 'Crypto.AAPLX/USD',
  },
  NVDAx: {
    symbol: 'NVDAx',
    name: 'NVIDIA xStock',
    mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
    decimals: 8,
    pythFeedId: '0x4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f',
    pythSymbol: 'Crypto.NVDAX/USD',
  },
  TSLAx: {
    symbol: 'TSLAx',
    name: 'Tesla xStock',
    mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
    decimals: 8,
    pythFeedId: '0x47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362',
    pythSymbol: 'Crypto.TSLAX/USD',
  },
  SPYx: {
    symbol: 'SPYx',
    name: 'S&P 500 xStock',
    mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
    decimals: 8,
    pythFeedId: '0x2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14',
    pythSymbol: 'Crypto.SPYX/USD',
  },
  QQQx: {
    symbol: 'QQQx',
    name: 'Nasdaq 100 xStock',
    mint: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ',
    decimals: 8,
    pythFeedId: '0x178a6f73a5aede9d0d682e86b0047c9f333ed0efe5c6537ca937565219c4054d',
    pythSymbol: 'Crypto.QQQX/USD',
  },
  GOOGLx: {
    symbol: 'GOOGLx',
    name: 'Alphabet xStock',
    mint: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN',
    decimals: 8,
    pythFeedId: '0xb911b0329028cd0283e4259c33809d62942bd2716a58084e5f31d64c00b5424e',
    pythSymbol: 'Crypto.GOOGLX/USD',
  },
  METAx: {
    symbol: 'METAx',
    name: 'Meta xStock',
    mint: 'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu',
    decimals: 8,
    pythFeedId: '0xbf3e5871be3f80ab7a4d1f1fd039145179fb58569e159aee1ccd472868ea5900',
    pythSymbol: 'Crypto.METAX/USD',
  },
};

// Back-compat shim for code paths that previously read `XSTOCK_MINTS[ticker]`
// as a plain string. Empty until populated by verifier.
export const XSTOCK_MINTS: Record<XStockTicker, string> = {
  AAPLx: XSTOCKS.AAPLx.mint,
  NVDAx: XSTOCKS.NVDAx.mint,
  TSLAx: XSTOCKS.TSLAx.mint,
  SPYx: XSTOCKS.SPYx.mint,
  QQQx: XSTOCKS.QQQx.mint,
  GOOGLx: XSTOCKS.GOOGLx.mint,
  METAx: XSTOCKS.METAx.mint,
};

export const PYTH_FEED_IDS: Record<XStockTicker, string> = {
  AAPLx: XSTOCKS.AAPLx.pythFeedId,
  NVDAx: XSTOCKS.NVDAx.pythFeedId,
  TSLAx: XSTOCKS.TSLAx.pythFeedId,
  SPYx: XSTOCKS.SPYx.pythFeedId,
  QQQx: XSTOCKS.QQQx.pythFeedId,
  GOOGLx: XSTOCKS.GOOGLx.pythFeedId,
  METAx: XSTOCKS.METAx.pythFeedId,
};

// Hard guard: if any consumer pulls a still-empty value at runtime, crash with a
// clear message instead of forwarding USDC to '' or hitting Hermes with a bad ID.
export function requireMint(ticker: XStockTicker): string {
  const meta = XSTOCKS[ticker];
  if (!meta || !meta.mint) {
    throw new Error(
      `[constants] mint address for ${ticker} is empty. Run \`pnpm --filter @hunch-it/ws-server verify:xstocks\` and paste the result into packages/shared/src/constants.ts.`,
    );
  }
  return meta.mint;
}

export function requirePythFeedId(ticker: XStockTicker): string {
  const meta = XSTOCKS[ticker];
  if (!meta || !meta.pythFeedId) {
    throw new Error(
      `[constants] pyth feed id for ${ticker} is empty. Run \`pnpm --filter @hunch-it/ws-server fetch:pyth-feeds\` and paste the result into packages/shared/src/constants.ts.`,
    );
  }
  return meta.pythFeedId;
}

// Solana program IDs.
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// USDC mainnet mint — used as the quote asset in Jupiter Ultra orders.
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDC_DECIMALS = 6;

// Jupiter Ultra API endpoints (gas sponsored; see https://dev.jup.ag/docs/ultra-api).
export const JUPITER_ULTRA_ORDER = '/ultra/v1/order';
export const JUPITER_ULTRA_EXECUTE = '/ultra/v1/execute';

// Jupiter Trigger Order v2 (vault-based, USD price trigger, off-chain private).
// Docs: https://dev.jup.ag/docs/trigger-api
export const JUPITER_TRIGGER_VAULT = '/trigger/v2/vault';
export const JUPITER_TRIGGER_DEPOSIT_CRAFT = '/trigger/v2/deposit/craft';
export const JUPITER_TRIGGER_ORDERS_PRICE = '/trigger/v2/orders/price';
export const JUPITER_TRIGGER_ORDERS_HISTORY = '/trigger/v2/orders/history';
export const JUPITER_TRIGGER_CANCEL_INITIATE = '/trigger/v2/orders/cancel/initiate';
export const JUPITER_TRIGGER_CANCEL_CONFIRM = '/trigger/v2/orders/cancel/confirm';
export const JUPITER_TRIGGER_EDIT = '/trigger/v2/orders/edit';

// Pyth.
export const PYTH_HERMES_DEFAULT_URL = 'https://hermes.pyth.network';
export const PYTH_BENCHMARKS_BASE = 'https://benchmarks.pyth.network';

// Default signal TTL bounds (seconds).
export const SIGNAL_TTL_MIN = 30;
export const SIGNAL_TTL_MAX = 120;
export const SIGNAL_TTL_DEFAULT = 30;

// Confidence threshold at which a LLM output is allowed to be BUY/SELL.
export const MIN_ACTIONABLE_CONFIDENCE = 0.7;

// Solscan link helper for UI.
export function solscanTokenUrl(mint: string): string {
  return `https://solscan.io/token/${mint}`;
}

// ──────────────────────────────────────────────────────────────────────────
// v1.3 mandate taxonomy — surface for /mandate Screen 1 + Proposal
// Generator's market-focus filter.
// ──────────────────────────────────────────────────────────────────────────

export interface MarketFocusVerticalDef {
  id: string;
  label: string;
  category: 'stocks' | 'etfs' | 'crypto';
  tickers: string[]; // xStock symbols (with x suffix) or crypto symbols
}

export const MARKET_FOCUS_VERTICALS: MarketFocusVerticalDef[] = [
  // Tokenized stocks
  {
    id: 'technology_software',
    label: 'Technology / Software',
    category: 'stocks',
    tickers: [
      'AAPLx',
      'GOOGLx',
      'METAx',
      'AMZNx',
      'CRMx',
      'ORCLx',
      'PLTRx',
      'AVGOx',
      'CRCLx',
      'ADBEx',
      'SHOPx',
    ],
  },
  {
    id: 'semiconductors',
    label: 'Semiconductors',
    category: 'stocks',
    tickers: ['NVDAx', 'TSMx', 'AMDx', 'INTCx', 'AMATx', 'SMHx', 'ASMLx', 'GEVx'],
  },
  {
    id: 'ev_clean_energy',
    label: 'EV & Clean Energy',
    category: 'stocks',
    tickers: ['TSLAx'],
  },
  {
    id: 'financials_fintech',
    label: 'Financials / Fintech',
    category: 'stocks',
    tickers: ['JPMx', 'GSx', 'HOODx', 'COINx', 'BACx', 'MAx', 'Vx', 'PYPLx', 'SQx'],
  },
  {
    id: 'healthcare_pharma',
    label: 'Healthcare / Pharma',
    category: 'stocks',
    tickers: ['LLYx', 'UNHx', 'ABTx', 'JNJx', 'MRKx', 'PFEx'],
  },
  {
    id: 'consumer_retail',
    label: 'Consumer / Retail',
    category: 'stocks',
    tickers: ['MCDx', 'WMTx', 'NKEx', 'SBUXx'],
  },
  {
    id: 'energy_utilities',
    label: 'Energy / Utilities',
    category: 'stocks',
    tickers: ['XLEx', 'XOPx', 'URAx'],
  },
  {
    id: 'crypto_mining',
    label: 'Crypto Mining',
    category: 'stocks',
    tickers: ['MSTRx', 'RIOTx', 'MARAx', 'CLSKx'],
  },
  {
    id: 'industrials',
    label: 'Industrials',
    category: 'stocks',
    tickers: ['CATx', 'DELLx', 'BAx'],
  },
  // ETFs
  {
    id: 'tokenized_etfs',
    label: 'Tokenized ETFs',
    category: 'etfs',
    tickers: ['SPYx', 'QQQx', 'IWMx', 'VTIx', 'IEMGx', 'VGKx', 'SMHx', 'URAx', 'SGOVx', 'XLEx'],
  },
  // Crypto
  {
    id: 'crypto',
    label: 'Crypto',
    category: 'crypto',
    tickers: ['wBTC', 'ETH', 'BNB', 'wXRP', 'TRX', 'HYPE'],
  },
];

export interface HoldingPeriodOption {
  value: string;
  label: string;
  caption: string;
}

export const HOLDING_PERIOD_OPTIONS: HoldingPeriodOption[] = [
  { value: '1-3 days', label: 'Short-term', caption: '1–3 days' },
  { value: '1-2 weeks', label: 'Swing', caption: '1–2 weeks' },
  { value: '1-3 months', label: 'Medium-term', caption: '1–3 months' },
  { value: '6+ months', label: 'Long-term', caption: '6+ months' },
];

export interface DrawdownOption {
  value: number | null;
  label: string;
}

export const MAX_DRAWDOWN_OPTIONS: DrawdownOption[] = [
  { value: 0.03, label: '3%' },
  { value: 0.05, label: '5%' },
  { value: 0.08, label: '8%' },
  { value: null, label: 'No limit' },
];

export const SKIP_REASON_LABELS: Record<string, string> = {
  TOO_RISKY: 'Too risky',
  DISAGREE_THESIS: "Don't agree with the thesis",
  BAD_TIMING: "Timing doesn't look good",
  ENOUGH_EXPOSURE: 'Already enough exposure',
  PRICE_NOT_ATTRACTIVE: 'Price not attractive',
  TOO_MANY_PROPOSALS: 'Too many proposals',
  OTHER: 'Other',
};
