// Demo-mode fixtures. Used by both apps when DEMO_MODE=true so the full UX
// loop can be showcased without Helius / Anthropic / Pyth / Cloud SQL
// credentials (or even a wallet). All data synthetic.

import type { Bar, IndicatorSnapshot, Signal } from './types';

const SIGNAL_SEEDS: Array<{
  ticker: string;
  action: 'BUY' | 'SELL';
  confidence: number;
  priceAtSignal: number;
  rsi: number;
  macdHist: number;
  rationale: string;
}> = [
  {
    ticker: 'AAPLx',
    action: 'BUY',
    confidence: 0.84,
    priceAtSignal: 232.45,
    rsi: 28.4,
    macdHist: 0.24,
    rationale: 'RSI=28.4 oversold; MACD hist +0.24 turning bullish; price crossed above MA20.',
  },
  {
    ticker: 'NVDAx',
    action: 'SELL',
    confidence: 0.78,
    priceAtSignal: 918.3,
    rsi: 74.1,
    macdHist: -0.32,
    rationale: 'RSI=74.1 overbought; bearish MACD crossover; price rolling off resistance $925.',
  },
  {
    ticker: 'TSLAx',
    action: 'BUY',
    confidence: 0.72,
    priceAtSignal: 248.92,
    rsi: 31.2,
    macdHist: 0.08,
    rationale: 'RSI=31.2 near oversold; MACD hist flipping positive; pullback to MA50 held.',
  },
  {
    ticker: 'SPYx',
    action: 'BUY',
    confidence: 0.81,
    priceAtSignal: 551.1,
    rsi: 35.4,
    macdHist: 0.11,
    rationale: 'Broad pullback to MA20 with RSI=35; MACD hist +0.11 confirms bounce.',
  },
  {
    ticker: 'QQQx',
    action: 'SELL',
    confidence: 0.77,
    priceAtSignal: 482.55,
    rsi: 72.8,
    macdHist: -0.18,
    rationale: 'Tech overextended; RSI=72.8; MACD hist -0.18 rolling over at resistance.',
  },
  {
    ticker: 'MSFTx',
    action: 'BUY',
    confidence: 0.76,
    priceAtSignal: 421.8,
    rsi: 33.1,
    macdHist: 0.15,
    rationale: 'RSI=33.1 oversold; MA20 support held twice; MACD hist flipping bullish.',
  },
  {
    ticker: 'GOOGLx',
    action: 'BUY',
    confidence: 0.73,
    priceAtSignal: 170.22,
    rsi: 29.8,
    macdHist: 0.09,
    rationale: 'RSI=29.8 oversold; bullish MACD crossover; volume on 5m bars confirms.',
  },
  {
    ticker: 'METAx',
    action: 'SELL',
    confidence: 0.79,
    priceAtSignal: 523.4,
    rsi: 75.3,
    macdHist: -0.25,
    rationale: 'META overbought at RSI=75.3; MACD hist -0.25 diverging from price.',
  },
];

// Deterministic PRNG so demo bars are stable across reloads.
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Synthesises 5-min OHLC bars via random walk, deterministic per-ticker.
 * Good enough to populate the modal chart with a believable curve.
 */
export function makeDemoBars(ticker: string, hoursBack = 24): Bar[] {
  const seed = SIGNAL_SEEDS.find((s) => s.ticker === ticker || `${s.ticker}x` === ticker);
  const basePrice = seed?.priceAtSignal ?? 100;
  const bars: Bar[] = [];
  const now = Math.floor(Date.now() / 1000);
  const step = 5 * 60;
  const count = Math.floor((hoursBack * 3600) / step);
  const rnd = mulberry32(hash(ticker));
  let price = basePrice * (1 + (rnd() - 0.5) * 0.02);
  for (let i = count - 1; i >= 0; i--) {
    const time = now - i * step;
    const drift = (rnd() - 0.5) * basePrice * 0.006;
    const open = price;
    const close = Math.max(0.01, price + drift);
    const high = Math.max(open, close) * (1 + rnd() * 0.002);
    const low = Math.min(open, close) * (1 - rnd() * 0.002);
    bars.push({ time, open, high, low, close });
    price = close;
  }
  return bars;
}

export function makeDemoSignal(index: number): Signal {
  const seed = SIGNAL_SEEDS[Math.abs(index) % SIGNAL_SEEDS.length]!;
  const now = Date.now();
  const ttl = 30 + Math.floor(Math.random() * 30); // 30-60s
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `demo-${now}-${index}`;
  const jitter = 1 + (Math.random() - 0.5) * 0.004; // ±0.2%
  const indicators: IndicatorSnapshot = {
    rsi: seed.rsi,
    macd: { macd: seed.macdHist * 2.2, signal: seed.macdHist * 1.4, histogram: seed.macdHist },
    ma20: seed.priceAtSignal * (1 + (seed.action === 'BUY' ? -0.004 : 0.004)),
    ma50: seed.priceAtSignal * (1 + (seed.action === 'BUY' ? -0.012 : 0.012)),
  };
  return {
    id,
    ticker: seed.ticker,
    action: seed.action,
    confidence: seed.confidence,
    rationale: seed.rationale,
    ttlSeconds: ttl,
    priceAtSignal: +(seed.priceAtSignal * jitter).toFixed(2),
    indicators,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl * 1000).toISOString(),
  };
}

export interface DemoPortfolioPosition {
  ticker: string;
  tokenAmount: number;
  avgCost: number;
  markPrice?: number;
  pnl?: number;
}
export interface DemoPortfolioTrade {
  id: string;
  signalId: string | null;
  ticker: string;
  side: 'BUY' | 'SELL';
  tokenAmount: number;
  executionPrice: number;
  amountUsd: number;
  realizedPnl: number;
  txSignature: string;
  status: 'CONFIRMED' | 'PENDING' | 'FAILED';
  createdAt: string;
}

// One preset position + three preset trades so `/portfolio` isn't blank cold.
export function demoInitialTrades(): DemoPortfolioTrade[] {
  const now = Date.now();
  return [
    {
      id: 'demo-trade-1',
      signalId: null,
      ticker: 'AAPLx',
      side: 'BUY',
      tokenAmount: 0.02168,
      executionPrice: 230.64,
      amountUsd: 5.0,
      realizedPnl: 0,
      txSignature: 'demo-5xY8vL3kQ7hR',
      status: 'CONFIRMED',
      createdAt: new Date(now - 2 * 3600 * 1000).toISOString(),
    },
    {
      id: 'demo-trade-2',
      signalId: null,
      ticker: 'TSLAx',
      side: 'BUY',
      tokenAmount: 0.01843,
      executionPrice: 246.82,
      amountUsd: 4.55,
      realizedPnl: 0,
      txSignature: 'demo-9pLwNr1fTgKm',
      status: 'CONFIRMED',
      createdAt: new Date(now - 5 * 3600 * 1000).toISOString(),
    },
    {
      id: 'demo-trade-3',
      signalId: null,
      ticker: 'TSLAx',
      side: 'SELL',
      tokenAmount: 0.01843,
      executionPrice: 251.1,
      amountUsd: 4.63,
      realizedPnl: 0.08,
      txSignature: 'demo-2HbZs4Qj6aEp',
      status: 'CONFIRMED',
      createdAt: new Date(now - 1 * 3600 * 1000).toISOString(),
    },
  ];
}

export function demoInitialPositions(): DemoPortfolioPosition[] {
  // AAPLx position matching demo-trade-1; TSLAx opened+closed so no position.
  return [
    {
      ticker: 'AAPLx',
      tokenAmount: 0.02168,
      avgCost: 230.64,
      markPrice: 234.8,
      pnl: 0.02168 * (234.8 - 230.64),
    },
  ];
}

export const DEMO_LEADERBOARD = {
  agent: {
    totalEvaluated: 45,
    wins: 28,
    losses: 14,
    neutrals: 3,
    winRate: 28 / (28 + 14),
    avgPctMove: 0.0082,
  },
  board: [
    {
      walletAddress: 'demo7xKXtW2pVrqLKrJsN3BbYfH6hQzA4Mvt',
      realizedPnl: 34.2,
      trades: 18,
      approvalsYes: 15,
      approvalsNo: 3,
      approvalsCorrect: 12,
      approvalsEvaluated: 15,
      approvalAccuracy: 0.8,
    },
    {
      walletAddress: 'demo9aBcQ1ktT3nMwF7rLdYpGsVxEhZ2UoP',
      realizedPnl: 12.4,
      trades: 11,
      approvalsYes: 9,
      approvalsNo: 2,
      approvalsCorrect: 7,
      approvalsEvaluated: 9,
      approvalAccuracy: 7 / 9,
    },
    {
      walletAddress: 'demoBx2LqW8sYpK5JmRnVtX3fHdQcLoA1ZeP',
      realizedPnl: 8.75,
      trades: 9,
      approvalsYes: 7,
      approvalsNo: 2,
      approvalsCorrect: 5,
      approvalsEvaluated: 8,
      approvalAccuracy: 5 / 8,
    },
    {
      walletAddress: 'demoRt5HjN4kF6eWqB2xY8vLzGsMpDcAoK3n',
      realizedPnl: 3.14,
      trades: 6,
      approvalsYes: 5,
      approvalsNo: 1,
      approvalsCorrect: 3,
      approvalsEvaluated: 6,
      approvalAccuracy: 0.5,
    },
    {
      walletAddress: 'demo3Npe4fT8vZuRqY6xWsLkMjB5cHdQoAeP',
      realizedPnl: -2.1,
      trades: 5,
      approvalsYes: 4,
      approvalsNo: 1,
      approvalsCorrect: 2,
      approvalsEvaluated: 4,
      approvalAccuracy: 0.5,
    },
  ],
};

// Synthetic xStock mint used by the modal "Yes" path when real mints aren't
// populated. Never routed on-chain in demo mode.
export const DEMO_FAKE_MINT = 'DeMoMint11111111111111111111111111111111111';

// Pre-baked mandate so demo /home shows mandate-aware proposals before the
// user has filled out Screen 1. The /mandate page seeds with these values.
export const DEMO_MANDATE = {
  id: 'demo-mandate',
  userId: 'demo-user',
  holdingPeriod: '1-2 weeks' as const,
  maxDrawdown: 0.05,
  maxTradeSize: 500,
  marketFocus: ['technology_software', 'semiconductors', 'tokenized_etfs'],
  createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  updatedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
};

// ──────────────────────────────────────────────────────────────────────────
// v1.3 demo proposal fixtures — used by the demo loop in ws-server and the
// /api/proposals demo branch.
// ──────────────────────────────────────────────────────────────────────────

const PROPOSAL_TEMPLATES: Array<{
  ticker: string;
  sector: string;
  priceAtProposal: number;
  rsi: number;
  macdHist: number;
  rationale: string;
  what_changed: string;
  why_this_trade: string;
  tpPct: number; // % above entry
  slPct: number; // % below entry
}> = [
  {
    ticker: 'AAPLx',
    sector: 'Technology / Software',
    priceAtProposal: 232.45,
    rsi: 28.4,
    macdHist: 0.24,
    rationale:
      'AAPLx -3.1% on broad tech selloff. RSI=28.4 oversold. MACD hist flipping +0.24 while price reclaims MA20.',
    what_changed:
      'AAPL pulled back -3.1% intraday on broad tech rotation; RSI(14) printed 28.4 (oversold band); 5m MACD histogram crossed from -0.18 to +0.24 in the last 25 minutes.',
    why_this_trade:
      'Combination of oversold RSI + MACD histogram flip + price reclaiming the 20-bar SMA is the classic counter-trend long setup. Risk is well-defined since support at $230.10 (3-week low) sits just below the suggested SL.',
    tpPct: 0.04,
    slPct: 0.025,
  },
  {
    ticker: 'TSMx',
    sector: 'Semiconductors',
    priceAtProposal: 178.2,
    rsi: 31.1,
    macdHist: 0.18,
    rationale:
      'TSMx -4.2% on sector rotation. 12% below 20-day avg. Portfolio has 0% semis vs mandate.',
    what_changed:
      'Semi sector rolled over -3.8% on Friday; TSMx specifically -4.2%, now 12% below 20-day moving average and 6% below 50-day. RSI=31.1, near oversold.',
    why_this_trade:
      'Backwardation in TSMx vs sector peers is mean-reverting on ~5-day average. With AI capex narrative still intact and earnings 3 weeks out, dip-buying offers asymmetric R:R against the recent $174 floor.',
    tpPct: 0.05,
    slPct: 0.03,
  },
  {
    ticker: 'NVDAx',
    sector: 'Semiconductors',
    priceAtProposal: 142.3,
    rsi: 32.4,
    macdHist: 0.11,
    rationale:
      'NVDAx tagged 50-day SMA $141.80. RSI=32 oversold; volume +30% vs avg. Sector beta favourable.',
    what_changed:
      'NVDAx tagged the 50-day SMA at $141.80 for the first time in 3 weeks; volume on the bounce is +30% vs 20-bar average; semi sector breadth improved (5 of 8 names green in the last hour).',
    why_this_trade:
      'Touch-and-bounce off long-term moving averages with above-average volume tends to mark short-term lows. Suggested SL at $138 keeps risk to ~3% while the 50-day acts as a clear invalidation level.',
    tpPct: 0.06,
    slPct: 0.03,
  },
  {
    ticker: 'SPYx',
    sector: 'Tokenized ETFs',
    priceAtProposal: 551.1,
    rsi: 35.4,
    macdHist: 0.09,
    rationale:
      'SPYx -1.4% intraday, RSI=35. 5m MACD turning positive. Broad benchmark dip into MA20 zone.',
    what_changed:
      'Broad-market index pulled back to the 20-bar SMA at $550.20. RSI(14)=35.4. MACD histogram flipped to +0.09 after 4 consecutive negative bars.',
    why_this_trade:
      'A measured dip into the MA20 zone with MACD reversing is the highest-frequency long setup on SPYx (62% historical hit rate over the last 90 days based on internal back-eval). Low-vol broad-market exposure fits a swing horizon.',
    tpPct: 0.02,
    slPct: 0.012,
  },
  {
    ticker: 'METAx',
    sector: 'Technology / Software',
    priceAtProposal: 510.8,
    rsi: 33.2,
    macdHist: 0.21,
    rationale:
      'METAx pulled to $510 (key support); RSI=33; volume confirms; portfolio underweight large-cap tech.',
    what_changed:
      "META retraced 4.5% from last week's high to a $510 horizontal support that held twice in the past 30 days. RSI=33.2, MACD histogram +0.21 after 6 negative bars.",
    why_this_trade:
      'Multi-touch horizontal support combined with momentum reversal usually marks a 5-7% swing low. Suggested entry slightly above support to confirm; SL just below the support cluster.',
    tpPct: 0.04,
    slPct: 0.025,
  },
  {
    ticker: 'MSFTx',
    sector: 'Technology / Software',
    priceAtProposal: 421.8,
    rsi: 33.1,
    macdHist: 0.15,
    rationale:
      'MSFTx tested MA50 twice; both held. RSI=33; MACD +0.15. Cloud guidance 2 weeks away.',
    what_changed:
      'MSFTx tested the 50-bar SMA at $421 twice in the last 5 sessions; both bounces produced higher lows. RSI=33.1, MACD histogram +0.15.',
    why_this_trade:
      'Successive higher lows above a key MA with momentum confirmation is the cleanest long-side pattern. Cloud guidance catalyst in 2 weeks adds asymmetric upside; SL below MA50 caps downside.',
    tpPct: 0.045,
    slPct: 0.022,
  },
  {
    ticker: 'GOOGLx',
    sector: 'Technology / Software',
    priceAtProposal: 170.22,
    rsi: 29.8,
    macdHist: 0.09,
    rationale:
      'GOOGLx -3.4%; RSI=29.8 oversold. MACD bullish crossover; 5m volume +24% vs avg.',
    what_changed:
      'GOOGLx fell 3.4% on the back of broad tech weakness; RSI(14) printed 29.8 (oversold). 5m MACD line crossed above the signal line at $169.80, with volume +24% vs the 20-bar average.',
    why_this_trade:
      'Oversold RSI combined with 5-min MACD crossover and confirming volume gives a high-quality reversal entry. Suggested SL just below the recent 5-day low at $167.80 keeps risk contained.',
    tpPct: 0.05,
    slPct: 0.018,
  },
  {
    ticker: 'COINx',
    sector: 'Financials / Fintech',
    priceAtProposal: 215.4,
    rsi: 30.5,
    macdHist: 0.14,
    rationale:
      'COINx -5.8% on BTC weakness, but on-chain volume holding. RSI=30. Crypto-correlated dip into support.',
    what_changed:
      'COINx -5.8% on the back of BTC retracing 4%; however CEX volume on Coinbase is +12% w/w, suggesting fundamental decoupling. RSI=30.5, MACD histogram +0.14.',
    why_this_trade:
      "Beta dip on COINx tends to overshoot when underlying fundamentals (volume) are intact. Mean-reversion candidate with clear stop below $210 (last week's low).",
    tpPct: 0.06,
    slPct: 0.025,
  },
];

export interface DemoProposalShape {
  id: string;
  userId: string;
  ticker: string;
  action: 'BUY';
  suggestedSizeUsd: number;
  suggestedTriggerPrice: number;
  suggestedTakeProfitPrice: number;
  suggestedStopLossPrice: number;
  rationale: string;
  reasoning: {
    what_changed: string;
    why_this_trade: string;
    why_fits_mandate: string;
  };
  positionImpact: {
    weight_before: number;
    weight_after: number;
    cash_after: number;
    sector_before: number;
    sector_after: number;
  };
  confidence: number;
  priceAtProposal: number;
  indicators: {
    rsi: number;
    macd: { macd: number; signal: number; histogram: number };
    ma20: number;
    ma50: number;
  };
  status: 'ACTIVE';
  expiresAt: string;
  createdAt: string;
}

export function makeDemoProposal(index: number): DemoProposalShape {
  const t = PROPOSAL_TEMPLATES[Math.abs(index) % PROPOSAL_TEMPLATES.length]!;
  const now = Date.now();
  const ttlMin = 30 + Math.floor(Math.random() * 90); // 30–120 min
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `demo-prop-${now}-${index}`;
  const jitter = 1 + (Math.random() - 0.5) * 0.004;
  const priceAtProposal = +(t.priceAtProposal * jitter).toFixed(2);
  const triggerPrice = +(priceAtProposal * (1 - 0.003)).toFixed(2);
  const tpPrice = +(priceAtProposal * (1 + t.tpPct)).toFixed(2);
  const slPrice = +(priceAtProposal * (1 - t.slPct)).toFixed(2);
  const suggestedSize = 100 + Math.floor(Math.random() * 4) * 50; // 100/150/200/250
  const ma20 = +(priceAtProposal * 0.992).toFixed(2);
  const ma50 = +(priceAtProposal * 0.978).toFixed(2);
  return {
    id,
    userId: DEMO_MANDATE.userId,
    ticker: t.ticker,
    action: 'BUY',
    suggestedSizeUsd: suggestedSize,
    suggestedTriggerPrice: triggerPrice,
    suggestedTakeProfitPrice: tpPrice,
    suggestedStopLossPrice: slPrice,
    rationale: t.rationale,
    reasoning: {
      what_changed: t.what_changed,
      why_this_trade: t.why_this_trade,
      why_fits_mandate: `Fits your ${DEMO_MANDATE.holdingPeriod} holding period; size $${suggestedSize} is within your $${DEMO_MANDATE.maxTradeSize.toFixed(0)} max trade size; suggested SL at $${slPrice} caps risk to ${(t.slPct * 100).toFixed(1)}% (within your ${(DEMO_MANDATE.maxDrawdown! * 100).toFixed(0)}% drawdown tolerance). Adds ${t.sector} exposure that your mandate targets.`,
    },
    positionImpact: {
      weight_before: 0,
      weight_after: +(suggestedSize / 5000).toFixed(3),
      cash_after: 5000 - suggestedSize,
      sector_before: 0.34,
      sector_after: +(0.34 + suggestedSize / 5000 / 2).toFixed(3),
    },
    confidence: +(0.72 + Math.random() * 0.18).toFixed(2),
    priceAtProposal,
    indicators: {
      rsi: t.rsi,
      macd: { macd: t.macdHist * 2.2, signal: t.macdHist * 1.4, histogram: t.macdHist },
      ma20,
      ma50,
    },
    status: 'ACTIVE',
    expiresAt: new Date(now + ttlMin * 60 * 1000).toISOString(),
    createdAt: new Date(now).toISOString(),
  };
}

/** Pre-baked initial set for cold loads of /api/proposals in demo mode. */
export function demoInitialProposals(count = 4): DemoProposalShape[] {
  return Array.from({ length: count }, (_, i) => makeDemoProposal(i));
}
