// Hunch It — canonical constants for tickers, mints, oracles.
//
// xStock metadata. The `mint` and `pythFeedId` fields are intentionally empty
// strings: Phase 2 requires verified-on-chain values, and we'd rather crash at
// load than route real USDC to a placeholder address. Run the verifier scripts
// in `apps/ws-server/scripts/` to populate them:
//
//   pnpm --filter @hunch-it/ws-server fetch:pyth-feeds   # writes pyth-feeds.json
//   pnpm --filter @hunch-it/ws-server verify:xstocks     # writes xstock-mints.json
//
// then paste the addresses below and re-run `pnpm typecheck`.

export interface XStockMeta {
  ticker: BareTicker; // pure ticker symbol used by Pyth (e.g. "AAPL")
  symbol: XStockTicker; // on-chain symbol with "x" suffix (e.g. "AAPLx")
  name: string;
  mint: string; // SPL Token-2022 mint, base58
  decimals: number;
  pythFeedId: string; // 0x-prefixed 32-byte hex
}

// Mint addresses verified on Solana mainnet via Helius RPC; Pyth feed ids
// fetched from https://hermes.pyth.network/v2/price_feeds?asset_type=equity.
// Re-run `pnpm --filter @hunch-it/ws-server verify:xstocks` and
// `pnpm --filter @hunch-it/ws-server fetch:pyth-feeds` to refresh.
export const XSTOCKS: Record<BareTicker, XStockMeta> = {
  AAPL: {
    ticker: 'AAPL',
    symbol: 'AAPLx',
    name: 'Apple xStock',
    mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
    decimals: 8,
    pythFeedId: '0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688',
  },
  NVDA: {
    ticker: 'NVDA',
    symbol: 'NVDAx',
    name: 'NVIDIA xStock',
    mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
    decimals: 8,
    pythFeedId: '0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593',
  },
  TSLA: {
    ticker: 'TSLA',
    symbol: 'TSLAx',
    name: 'Tesla xStock',
    mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
    decimals: 8,
    pythFeedId: '0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1',
  },
  SPY: {
    ticker: 'SPY',
    symbol: 'SPYx',
    name: 'S&P 500 xStock',
    mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
    decimals: 8,
    pythFeedId: '0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5',
  },
  QQQ: {
    ticker: 'QQQ',
    symbol: 'QQQx',
    name: 'Nasdaq 100 xStock',
    mint: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ',
    decimals: 8,
    pythFeedId: '0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d',
  },
  MSFT: {
    ticker: 'MSFT',
    symbol: 'MSFTx',
    name: 'Microsoft xStock',
    mint: 'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX',
    decimals: 8,
    pythFeedId: '0xd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1',
  },
  GOOGL: {
    ticker: 'GOOGL',
    symbol: 'GOOGLx',
    name: 'Alphabet xStock',
    mint: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN',
    decimals: 8,
    pythFeedId: '0x5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6',
  },
  META: {
    ticker: 'META',
    symbol: 'METAx',
    name: 'Meta xStock',
    mint: 'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu',
    decimals: 8,
    pythFeedId: '0x78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe',
  },
};

export const BARE_TICKERS = ['AAPL', 'NVDA', 'TSLA', 'SPY', 'QQQ', 'MSFT', 'GOOGL', 'META'] as const;
export type BareTicker = (typeof BARE_TICKERS)[number];

export const XSTOCK_TICKERS = [
  'AAPLx',
  'NVDAx',
  'TSLAx',
  'SPYx',
  'QQQx',
  'MSFTx',
  'GOOGLx',
  'METAx',
] as const;
export type XStockTicker = (typeof XSTOCK_TICKERS)[number];

// Back-compat shim for code paths that previously read `XSTOCK_MINTS[ticker]`
// as a plain string. Empty until populated by verifier.
export const XSTOCK_MINTS: Record<XStockTicker, string> = {
  AAPLx: XSTOCKS.AAPL.mint,
  NVDAx: XSTOCKS.NVDA.mint,
  TSLAx: XSTOCKS.TSLA.mint,
  SPYx: XSTOCKS.SPY.mint,
  QQQx: XSTOCKS.QQQ.mint,
  MSFTx: XSTOCKS.MSFT.mint,
  GOOGLx: XSTOCKS.GOOGL.mint,
  METAx: XSTOCKS.META.mint,
};

export const PYTH_FEED_IDS: Record<BareTicker, string> = {
  AAPL: XSTOCKS.AAPL.pythFeedId,
  NVDA: XSTOCKS.NVDA.pythFeedId,
  TSLA: XSTOCKS.TSLA.pythFeedId,
  SPY: XSTOCKS.SPY.pythFeedId,
  QQQ: XSTOCKS.QQQ.pythFeedId,
  MSFT: XSTOCKS.MSFT.pythFeedId,
  GOOGL: XSTOCKS.GOOGL.pythFeedId,
  META: XSTOCKS.META.pythFeedId,
};

// Hard guard: if any consumer pulls a still-empty value at runtime, crash with a
// clear message instead of forwarding USDC to '' or hitting Hermes with a bad ID.
export function requireMint(ticker: BareTicker | XStockTicker): string {
  const meta = ticker.endsWith('x')
    ? XSTOCKS[ticker.slice(0, -1) as BareTicker]
    : XSTOCKS[ticker as BareTicker];
  if (!meta || !meta.mint) {
    throw new Error(
      `[constants] mint address for ${ticker} is empty. Run \`pnpm --filter @hunch-it/ws-server verify:xstocks\` and paste the result into packages/shared/src/constants.ts.`,
    );
  }
  return meta.mint;
}

export function requirePythFeedId(ticker: BareTicker | XStockTicker): string {
  const meta = ticker.endsWith('x')
    ? XSTOCKS[ticker.slice(0, -1) as BareTicker]
    : XSTOCKS[ticker as BareTicker];
  if (!meta || !meta.pythFeedId) {
    throw new Error(
      `[constants] pyth feed id for ${ticker} is empty. Run \`pnpm --filter @hunch-it/ws-server fetch:pyth-feeds\` and paste the result into packages/shared/src/constants.ts.`,
    );
  }
  return meta.pythFeedId;
}

export function bareToXStock(t: BareTicker): XStockTicker {
  return `${t}x` as XStockTicker;
}
export function xStockToBare(t: XStockTicker): BareTicker {
  return t.slice(0, -1) as BareTicker;
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
      'MSFTx',
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
    id: 'bluechip_crypto',
    label: 'Bluechip Crypto',
    category: 'crypto',
    tickers: ['SOL', 'BTC', 'ETH'],
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
