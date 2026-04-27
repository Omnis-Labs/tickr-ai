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
