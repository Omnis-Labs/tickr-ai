import {
  getAssetById,
  getSignalAssets,
  type Bar,
  type BaseMarketAnalysis,
  type BaseMarketIndicators,
} from '@hunch-it/shared';

export const MAX_AI_TRADING_TEAM_SIZE = 6;

export type AnalystVerdict = 'support' | 'challenge' | 'reject';

export interface AiAnalystCatalogItem {
  id: string;
  name: string;
  originTask: string;
  technique: string;
  dataNeeds: string;
  defaultSelected: boolean;
}

export interface AnalystBacktestSummary {
  totalReturnPct: number;
  benchmarkReturnPct: number;
  excessReturnPct: number;
  maxDrawdownPct: number;
  nTrades: number;
  exposurePct: number;
}

export interface AnalystOpinion {
  analystId: string;
  analystName: string;
  originTask: string;
  verdict: AnalystVerdict;
  confidence: number;
  thesis: string;
  whyNow: string;
  setupEntry: string;
  riskProtection: string;
  invalidation: string;
  evidence: string[];
  backtest: AnalystBacktestSummary;
  sourceFiles: string[];
  indicators: BaseMarketIndicators;
}

export interface GrillAnalysisResult {
  assetId: string;
  idea: string;
  asOf: string;
  opinions: AnalystOpinion[];
}

export interface AnalyzeGrillIdeaInput {
  assetId: string;
  idea: string;
  analystIds?: readonly string[];
  barsByAssetId: ReadonlyMap<string, readonly Bar[]>;
  now?: Date;
}

interface PreparedBar extends Bar {
  volume: number;
}

type WantLong = (index: number) => boolean | null;

export const AI_ANALYST_CATALOG: readonly AiAnalystCatalogItem[] = [
  {
    id: 'technical',
    name: 'Technical Tape',
    originTask: 'T4 Technical',
    technique: 'RSI, MACD, SMA, Bollinger, Donchian, volume-confirmation menu',
    dataNeeds: 'Pyth OHLC bars for the selected asset',
    defaultSelected: true,
  },
  {
    id: 'relative_strength',
    name: 'Relative Strength',
    originTask: 'T7 Relative Strength',
    technique: 'Ticker divided by benchmark, RS SMA, RS breakout, RS momentum',
    dataNeeds: 'Pyth OHLC bars for the selected asset and benchmark',
    defaultSelected: true,
  },
  {
    id: 'volatility_regime',
    name: 'Volatility Regime',
    originTask: 'T14 Volatility Regime',
    technique: 'Trailing realized volatility percentile, calm-regime and trend-and-calm gates',
    dataNeeds: 'Pyth OHLC bars for the selected asset',
    defaultSelected: true,
  },
  {
    id: 'seasonality',
    name: 'Seasonality',
    originTask: 'T12 Seasonality',
    technique: 'Month-of-year, sell-in-May split, and turn-of-month calendar rules',
    dataNeeds: 'Pyth OHLC bars for the selected asset',
    defaultSelected: false,
  },
  {
    id: 'overnight_gap',
    name: 'Overnight Gap',
    originTask: 'T13 Overnight / Gap',
    technique: 'Close-to-open versus open-to-close return decomposition with daily cost drag',
    dataNeeds: 'Pyth OHLC bars for the selected asset',
    defaultSelected: false,
  },
  {
    id: 'price_anomaly',
    name: 'Price Anomaly',
    originTask: 'T19 Price Anomalies',
    technique: '52-week-high momentum, MAX spike avoidance, and Dec-Jan tax-loss reversal',
    dataNeeds: 'Pyth OHLC bars for the selected asset',
    defaultSelected: false,
  },
  {
    id: 'portfolio_risk_sizer',
    name: 'Portfolio Risk Sizer',
    originTask: 'T10 Portfolio / Risk Sizing',
    technique: 'Task 4 per-name signals, inverse-vol / risk-parity / signal-proportional sizing, caps, and vol targeting',
    dataNeeds: 'Pyth OHLC bars for the selected asset and a Hunch watchlist',
    defaultSelected: false,
  },
  {
    id: 'cross_sectional_ranker',
    name: 'Cross-Sectional Ranker',
    originTask: 'T21 Ranker',
    technique: '12-1 momentum, low volatility, near-52w-high, or short-term reversal factor rank',
    dataNeeds: 'Pyth OHLC bars for the selected asset and a tradable Hunch universe',
    defaultSelected: false,
  },
  {
    id: 'pairs_trading',
    name: 'Pairs Trading',
    originTask: 'T23 Pairs Trading',
    technique: 'Trailing OLS hedge ratio, spread z-score, mean-reversion thresholds, and market-neutral caveats',
    dataNeeds: 'Pyth OHLC bars for the selected asset and an auto-selected supported pair asset',
    defaultSelected: false,
  },
  {
    id: 'meihua_null_control',
    name: 'Meihua Null Control',
    originTask: 'T26 Meihua I Ching Control',
    technique: 'Deterministic date seed, body/use five-element relation, and null-control backtest',
    dataNeeds: 'Pyth OHLC bars for the selected asset plus the bar date; no economic data by design',
    defaultSelected: false,
  },
  {
    id: 'qimen_null_control',
    name: 'Qimen Null Control',
    originTask: 'T32 Qimen Dunjia Control',
    technique: 'Simplified deterministic season/day gate, auspicious-gate rule, and null-control backtest',
    dataNeeds: 'Pyth OHLC bars for the selected asset plus the bar date; no economic data by design',
    defaultSelected: false,
  },
  {
    id: 'taiyi_null_control',
    name: 'Taiyi Null Control',
    originTask: 'T34 Taiyi Shenshu Control',
    technique: 'Deterministic accumulated-year host/guest count, host-prevails rule, and null-control backtest',
    dataNeeds: 'Pyth OHLC bars for the selected asset plus the bar date; no economic data by design',
    defaultSelected: false,
  },
];

export const DEFAULT_AI_TRADING_TEAM_IDS = AI_ANALYST_CATALOG.filter(
  (analyst) => analyst.defaultSelected,
).map((analyst) => analyst.id);

const catalogById = new Map(AI_ANALYST_CATALOG.map((analyst) => [analyst.id, analyst]));
const signalAssetIds = new Set(getSignalAssets().map((asset) => asset.assetId));

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function fmtUsd(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPct(value: number, digits = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

function prepareBars(bars: readonly Bar[]): PreparedBar[] {
  return bars
    .filter(
      (bar) =>
        Number.isFinite(bar.time) &&
        Number.isFinite(bar.open) &&
        Number.isFinite(bar.high) &&
        Number.isFinite(bar.low) &&
        Number.isFinite(bar.close) &&
        bar.open > 0 &&
        bar.high > 0 &&
        bar.low > 0 &&
        bar.close > 0,
    )
    .map((bar) => ({ ...bar, volume: 1_000 }))
    .sort((a, b) => a.time - b.time);
}

function lastDefined(series: readonly (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const value = series[i];
    if (value != null && Number.isFinite(value)) return value;
  }
  return null;
}

function smaSeries(values: readonly number[], window: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: values.length }, () => null);
  if (window <= 0) return out;
  let run = 0;
  for (let i = 0; i < values.length; i++) {
    run += values[i] ?? 0;
    if (i >= window) run -= values[i - window] ?? 0;
    if (i >= window - 1) out[i] = run / window;
  }
  return out;
}

function emaSeries(values: readonly (number | null)[], span: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: values.length }, () => null);
  if (span <= 0) return out;
  const alpha = 2 / (span + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value == null) continue;
    prev = prev == null ? value : value * alpha + prev * (1 - alpha);
    out[i] = prev;
  }
  return out;
}

function rsiSeries(closes: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: closes.length }, () => null);
  if (period <= 0 || closes.length <= period) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const change = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function macdSeries(
  closes: readonly number[],
  fast = 12,
  slow = 26,
  signal = 9,
): {
  line: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
} {
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const line = closes.map((_, index) => {
    const fastValue = emaFast[index];
    const slowValue = emaSlow[index];
    return fastValue != null && slowValue != null ? fastValue - slowValue : null;
  });
  const signalLine = emaSeries(line, signal);
  const histogram = line.map((value, index) => {
    const signalValue = signalLine[index];
    return value != null && signalValue != null ? value - signalValue : null;
  });
  return { line, signal: signalLine, histogram };
}

function priorDonchianHigh(highs: readonly number[], period: number): (number | null)[] {
  return highs.map((_, index) => {
    if (index < period) return null;
    return Math.max(...highs.slice(index - period, index));
  });
}

function baseIndicatorsFromBars(bars: readonly PreparedBar[]): BaseMarketIndicators {
  const closes = bars.map((bar) => bar.close);
  const last = closes.at(-1) ?? 0;
  const macd = macdSeries(closes);
  return {
    rsi: round(lastDefined(rsiSeries(closes, 14)) ?? 50, 2),
    macd: {
      macd: round(lastDefined(macd.line) ?? 0, 4),
      signal: round(lastDefined(macd.signal) ?? 0, 4),
      histogram: round(lastDefined(macd.histogram) ?? 0, 4),
    },
    ma20: round(lastDefined(smaSeries(closes, 20)) ?? last, 2),
    ma50: round(lastDefined(smaSeries(closes, 50)) ?? last, 2),
  };
}

function annualizedRealizedVol(closes: readonly number[], lookback = 252): number {
  const returns: number[] = [];
  const start = Math.max(1, closes.length - lookback);
  for (let i = start; i < closes.length; i++) {
    const prev = closes[i - 1] ?? 0;
    const cur = closes[i] ?? 0;
    if (prev > 0) returns.push(cur / prev - 1);
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function closeReturns(closes: readonly number[]): number[] {
  return closes.map((close, index) => {
    if (index === 0) return 0;
    const prev = closes[index - 1] ?? 0;
    return prev > 0 ? close / prev - 1 : 0;
  });
}

function realizedVolAt(returns: readonly number[], index: number, window: number): number | null {
  if (index + 1 < window) return null;
  const chunk = returns.slice(index + 1 - window, index + 1);
  if (chunk.length < 2) return null;
  const mean = chunk.reduce((sum, value) => sum + value, 0) / chunk.length;
  const variance = chunk.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (chunk.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function smaAt(closes: readonly number[], index: number, window: number): number | null {
  if (index + 1 < window) return null;
  const chunk = closes.slice(index + 1 - window, index + 1);
  return chunk.reduce((sum, value) => sum + value, 0) / chunk.length;
}

function runLongFlatBacktest(
  bars: readonly PreparedBar[],
  wantLong: WantLong,
  options: { startIndex?: number; transactionCostBps?: number } = {},
): AnalystBacktestSummary {
  const startIndex = options.startIndex ?? Math.max(0, bars.length - 252);
  const window = bars.slice(startIndex);
  if (window.length < 2) {
    return {
      totalReturnPct: 0,
      benchmarkReturnPct: 0,
      excessReturnPct: 0,
      maxDrawdownPct: 0,
      nTrades: 0,
      exposurePct: 0,
    };
  }

  const cost = (options.transactionCostBps ?? 10) / 10_000;
  const benchEntry = window[1]?.open ?? window[0]!.open;
  let cash = 1;
  let position = 0;
  let entryPrice = 0;
  let trades = 0;
  let daysInMarket = 0;
  const equityCurve: number[] = [];

  for (let i = 0; i < window.length; i++) {
    const close = window[i]!.close;
    let equity = position > 0 ? position * close : cash;
    if (position > 0) daysInMarket++;

    const canExecute = i + 1 < window.length;
    const fullIndex = startIndex + i;
    const desired = wantLong(fullIndex);
    if (canExecute && position > 0 && desired === false) {
      const fill = window[i + 1]!.open * (1 - cost);
      cash = position * fill;
      position = 0;
      entryPrice = 0;
      equity = cash;
    } else if (canExecute && position === 0 && desired === true) {
      const fill = window[i + 1]!.open * (1 + cost);
      position = cash / fill;
      entryPrice = window[i + 1]!.open;
      cash = 0;
      trades++;
    }

    if (entryPrice < 0) entryPrice = 0;
    equityCurve.push(round(equity, 6));
  }

  if (position > 0) {
    const finalFill = window.at(-1)!.close * (1 - cost);
    equityCurve[equityCurve.length - 1] = round(position * finalFill, 6);
  }

  const final = equityCurve.at(-1) ?? 1;
  const benchmark = (window.at(-1)!.close / benchEntry - 1) * 100;
  let peak = equityCurve[0] ?? 1;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point);
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, point / peak - 1);
  }

  const totalReturnPct = (final - 1) * 100;
  return {
    totalReturnPct: round(totalReturnPct),
    benchmarkReturnPct: round(benchmark),
    excessReturnPct: round(totalReturnPct - benchmark),
    maxDrawdownPct: round(maxDrawdown * 100),
    nTrades: trades,
    exposurePct: round((daysInMarket / window.length) * 100, 1),
  };
}

function technicalOpinion(input: {
  analyst: AiAnalystCatalogItem;
  assetId: string;
  idea: string;
  bars: readonly PreparedBar[];
}): AnalystOpinion {
  const closes = input.bars.map((bar) => bar.close);
  const highs = input.bars.map((bar) => bar.high);
  const last = closes.at(-1)!;
  const sma20Series = smaSeries(closes, 20);
  const sma50Series = smaSeries(closes, 50);
  const sma200Series = smaSeries(closes, 200);
  const rsi14Series = rsiSeries(closes, 14);
  const macd = macdSeries(closes);
  const donchianHigh20 = priorDonchianHigh(highs, 20);

  const sma20 = lastDefined(sma20Series) ?? last;
  const sma50 = lastDefined(sma50Series) ?? last;
  const sma200 = lastDefined(sma200Series) ?? sma50;
  const rsi14 = lastDefined(rsi14Series) ?? 50;
  const macdLine = lastDefined(macd.line) ?? 0;
  const macdSignal = lastDefined(macd.signal) ?? 0;
  const macdHistogram = lastDefined(macd.histogram) ?? 0;
  const breakout = lastDefined(donchianHigh20);
  const realizedVol = annualizedRealizedVol(closes);

  const trendRegime =
    sma50 > sma200 && last > sma200
      ? 'uptrend'
      : sma50 < sma200 && last < sma200
        ? 'downtrend'
        : 'range';

  const verdict: AnalystVerdict =
    trendRegime === 'uptrend' && macdLine > macdSignal
      ? 'support'
      : trendRegime === 'downtrend' && macdHistogram < 0
        ? 'reject'
        : 'challenge';
  const confidence = verdict === 'support' ? 0.78 : verdict === 'reject' ? 0.69 : 0.63;

  const wantLong: WantLong =
    verdict === 'support'
      ? () => true
      : verdict === 'reject'
        ? (index) => (rsi14Series[index] ?? 50) <= 30
        : (index) =>
            (macd.line[index] ?? 0) > (macd.signal[index] ?? 0) &&
            closes[index]! > (sma20Series[index] ?? Number.POSITIVE_INFINITY);
  const backtest = runLongFlatBacktest(input.bars, wantLong);

  const trigger = verdict === 'support' ? Math.max(last * 0.997, sma20) : (breakout ?? last * 1.01);
  const stop = trigger * (verdict === 'support' ? 0.92 : 0.9);

  return {
    analystId: input.analyst.id,
    analystName: input.analyst.name,
    originTask: input.analyst.originTask,
    verdict,
    confidence,
    thesis:
      verdict === 'support'
        ? `${input.assetId} is in a confirmed ${trendRegime}: price ${fmtUsd(last)} is above SMA50 ${fmtUsd(sma50)} and SMA200 ${fmtUsd(sma200)}, while MACD ${macdLine.toFixed(3)} is above signal ${macdSignal.toFixed(3)}.`
        : verdict === 'reject'
          ? `${input.assetId} is in a weak technical regime: price ${fmtUsd(last)} is below SMA50 ${fmtUsd(sma50)} and SMA200 ${fmtUsd(sma200)}, with MACD histogram ${macdHistogram.toFixed(3)} still negative.`
          : `${input.assetId} is not a clean technical buy yet. The tape is ${trendRegime}, RSI is ${rsi14.toFixed(1)}, and MACD histogram is ${macdHistogram.toFixed(3)}, so the idea needs price confirmation.`,
    whyNow: `The current read is grounded in Task 4-style as-of indicators: RSI(14) ${rsi14.toFixed(1)}, price vs SMA20 ${fmtPct((last / sma20 - 1) * 100)}, and annualized realized volatility ${realizedVol.toFixed(1)}%.`,
    setupEntry:
      verdict === 'support'
        ? `Use a disciplined trigger near ${fmtUsd(trigger)} rather than chasing far above the 20-day average.`
        : `Wait for confirmation above ${fmtUsd(trigger)} or for MACD to cross back above signal before treating the outside idea as actionable.`,
    riskProtection: `Protect the setup with a stop near ${fmtUsd(stop)} and respect the user's mandate drawdown cap before sizing.`,
    invalidation:
      verdict === 'reject'
        ? `The cautious read is wrong if price reclaims SMA50 ${fmtUsd(sma50)} and MACD histogram turns positive.`
        : `The bullish read is wrong if price loses SMA20 ${fmtUsd(sma20)} and MACD line falls back below signal.`,
    evidence: [
      `Task 4 readings: trend=${trendRegime}, RSI=${rsi14.toFixed(1)}, MACD histogram=${macdHistogram.toFixed(3)}.`,
      `Lookahead-free backtest summary: strategy ${fmtPct(backtest.totalReturnPct)} vs buy-and-hold ${fmtPct(backtest.benchmarkReturnPct)} over the trailing window.`,
      `Original Grill Idea considered: "${input.idea.trim()}".`,
    ],
    backtest,
    sourceFiles: [
      'Fundamental_analysis_agent/task4_technical/pipeline/indicators.py',
      'Fundamental_analysis_agent/task4_technical/pipeline/backtest.py',
      'Fundamental_analysis_agent/prompts/task4_technical/technical_author.md',
      'Fundamental_analysis_agent/task4_technical/tests/test_indicators.py',
      'Fundamental_analysis_agent/task4_technical/tests/test_backtest.py',
    ],
    indicators: {
      rsi: round(rsi14, 2),
      macd: {
        macd: round(macdLine, 4),
        signal: round(macdSignal, 4),
        histogram: round(macdHistogram, 4),
      },
      ma20: round(sma20, 2),
      ma50: round(sma50, 2),
    },
  };
}

function chooseBenchmarkAssetId(assetId: string): string {
  const asset = getAssetById(assetId);
  if (asset?.kind === 'CRYPTO') return assetId === 'wBTC' ? 'ETH' : 'wBTC';
  return assetId === 'SPYx' ? 'QQQx' : 'SPYx';
}

const RANKER_MAX_NAMES = 20;
const RANKER_MIN_NAMES = 3;
const PORTFOLIO_MAX_NAMES = 15;
const PORTFOLIO_MIN_NAMES = 3;

function rankerUniverseAssetIds(assetId: string): string[] {
  const asset = getAssetById(assetId);
  const sameKind = getSignalAssets()
    .filter((candidate) => !asset || candidate.kind === asset.kind)
    .map((candidate) => candidate.assetId);
  const fallback = getSignalAssets().map((candidate) => candidate.assetId);
  const out: string[] = [];

  for (const id of [assetId, ...sameKind, ...fallback]) {
    if (!signalAssetIds.has(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= RANKER_MAX_NAMES) break;
  }

  return out;
}

function portfolioUniverseAssetIds(assetId: string): string[] {
  const asset = getAssetById(assetId);
  const anchors = asset?.kind === 'CRYPTO' ? ['wBTC', 'ETH', 'BNB'] : ['SPYx', 'QQQx', 'SMHx'];
  const sameKind = getSignalAssets()
    .filter((candidate) => !asset || candidate.kind === asset.kind)
    .map((candidate) => candidate.assetId);
  const fallback = getSignalAssets().map((candidate) => candidate.assetId);
  const out: string[] = [];

  for (const id of [assetId, ...anchors, ...sameKind, ...fallback]) {
    if (!signalAssetIds.has(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= PORTFOLIO_MAX_NAMES) break;
  }

  return out;
}

function choosePairAssetId(assetId: string): string {
  const preferredByAssetId: Record<string, string> = {
    SPYx: 'QQQx',
    QQQx: 'SPYx',
    IWMx: 'SPYx',
    VTIx: 'SPYx',
    SMHx: 'QQQx',
    XLEx: 'SPYx',
    XOPx: 'XLEx',
    wBTC: 'ETH',
    ETH: 'wBTC',
    BNB: 'wBTC',
    wXRP: 'wBTC',
    TRX: 'wBTC',
    HYPE: 'wBTC',
  };
  const preferred = preferredByAssetId[assetId];
  if (preferred && preferred !== assetId && signalAssetIds.has(preferred)) return preferred;

  const asset = getAssetById(assetId);
  const candidates =
    asset?.kind === 'CRYPTO'
      ? ['wBTC', 'ETH', 'BNB']
      : ['QQQx', 'SPYx', 'SMHx', ...getSignalAssets().map((candidate) => candidate.assetId)];
  return candidates.find((candidate) => candidate !== assetId && signalAssetIds.has(candidate)) ?? chooseBenchmarkAssetId(assetId);
}

export function getRequiredGrillBarAssetIds(
  assetId: string,
  analystIds?: readonly string[],
): string[] {
  const required = new Set<string>([assetId]);
  for (const analyst of selectedAnalysts(analystIds)) {
    if (analyst.id === 'relative_strength') {
      required.add(chooseBenchmarkAssetId(assetId));
    }
    if (analyst.id === 'cross_sectional_ranker') {
      for (const universeAssetId of rankerUniverseAssetIds(assetId)) {
        required.add(universeAssetId);
      }
    }
    if (analyst.id === 'portfolio_risk_sizer') {
      for (const universeAssetId of portfolioUniverseAssetIds(assetId)) {
        required.add(universeAssetId);
      }
    }
    if (analyst.id === 'pairs_trading') {
      required.add(choosePairAssetId(assetId));
    }
  }
  return Array.from(required);
}

function alignRelativeStrength(
  assetBars: readonly PreparedBar[],
  benchmarkBars: readonly PreparedBar[],
): (number | null)[] {
  const benchmarkByTime = new Map(benchmarkBars.map((bar) => [bar.time, bar.close]));
  let lastBenchmark: number | null = null;
  return assetBars.map((bar) => {
    if (benchmarkByTime.has(bar.time)) lastBenchmark = benchmarkByTime.get(bar.time)!;
    return lastBenchmark && lastBenchmark > 0 ? bar.close / lastBenchmark : null;
  });
}

function smaNullable(series: readonly (number | null)[], window: number): (number | null)[] {
  return series.map((_, index) => {
    if (index + 1 < window) return null;
    const chunk = series.slice(index + 1 - window, index + 1);
    const numbers = chunk.filter((value): value is number => value != null);
    if (numbers.length !== window) return null;
    return numbers.reduce((sum, value) => sum + value, 0) / window;
  });
}

function priorHighNullable(
  series: readonly (number | null)[],
  lookback: number,
): (number | null)[] {
  return series.map((_, index) => {
    if (index < lookback) return null;
    const chunk = series
      .slice(index - lookback, index)
      .filter((value): value is number => value != null);
    return chunk.length > 0 ? Math.max(...chunk) : null;
  });
}

function relativeReturnPct(
  assetBars: readonly PreparedBar[],
  benchmarkBars: readonly PreparedBar[],
  index: number,
  days: number,
): number | null {
  if (index < days) return null;
  const benchmarkByTime = new Map(benchmarkBars.map((bar) => [bar.time, bar.close]));
  const startBenchmark = benchmarkByTime.get(assetBars[index - days]!.time);
  const endBenchmark = benchmarkByTime.get(assetBars[index]!.time);
  if (!startBenchmark || !endBenchmark || startBenchmark <= 0) return null;
  const assetReturn = assetBars[index]!.close / assetBars[index - days]!.close - 1;
  const benchmarkReturn = endBenchmark / startBenchmark - 1;
  return (assetReturn - benchmarkReturn) * 100;
}

function relativeStrengthOpinion(input: {
  analyst: AiAnalystCatalogItem;
  assetId: string;
  idea: string;
  bars: readonly PreparedBar[];
  benchmarkAssetId: string;
  benchmarkBars: readonly PreparedBar[];
}): AnalystOpinion {
  const rs = alignRelativeStrength(input.bars, input.benchmarkBars);
  const rsSma = smaNullable(rs, 50);
  const rsHigh = priorHighNullable(rs, 60);
  const index = input.bars.length - 1;
  const currentRs = rs[index];
  const currentSma = rsSma[index];
  const aboveSma = currentRs != null && currentSma != null && currentRs > currentSma;
  const rel3m = relativeReturnPct(input.bars, input.benchmarkBars, index, 63);
  const rel6m = relativeReturnPct(input.bars, input.benchmarkBars, index, 126);
  const rel12m = relativeReturnPct(input.bars, input.benchmarkBars, index, 252);

  const regime =
    rel6m == null
      ? 'insufficient history'
      : aboveSma && rel6m > 0
        ? 'outperforming'
        : !aboveSma && rel6m < 0
          ? 'underperforming'
          : 'inline';
  const verdict: AnalystVerdict =
    regime === 'outperforming' ? 'support' : regime === 'underperforming' ? 'reject' : 'challenge';
  const confidence = verdict === 'support' ? 0.76 : verdict === 'reject' ? 0.68 : 0.61;

  const wantLong: WantLong =
    verdict === 'support'
      ? (i) => rs[i] != null && rsSma[i] != null && rs[i]! > rsSma[i]!
      : (i) => rs[i] != null && rsHigh[i] != null && rs[i]! > rsHigh[i]!;
  const backtest = runLongFlatBacktest(input.bars, wantLong);
  const indicators = baseIndicatorsFromBars(input.bars);
  const last = input.bars.at(-1)!.close;
  const stop = last * (verdict === 'support' ? 0.91 : 0.9);

  return {
    analystId: input.analyst.id,
    analystName: input.analyst.name,
    originTask: input.analyst.originTask,
    verdict,
    confidence,
    thesis:
      verdict === 'support'
        ? `${input.assetId} is outperforming ${input.benchmarkAssetId}: six-month relative return is ${fmtPct(rel6m ?? 0)} and the RS line is above its 50-bar average.`
        : verdict === 'reject'
          ? `${input.assetId} is lagging ${input.benchmarkAssetId}: six-month relative return is ${fmtPct(rel6m ?? 0)} and the RS line is below its 50-bar average.`
          : `${input.assetId} is roughly inline with ${input.benchmarkAssetId}; relative strength has not confirmed leadership yet.`,
    whyNow: `Task 7's RS model compares ${input.assetId} price to ${input.benchmarkAssetId}. Current 3-month relative return is ${fmtPct(rel3m ?? 0)}${rel12m == null ? '' : ` and 12-month relative return is ${fmtPct(rel12m)}`}.`,
    setupEntry:
      verdict === 'support'
        ? `Treat the idea as actionable only while relative strength remains above its 50-bar average.`
        : `Wait for the RS line to break above its prior 60-bar high before adding this to a disciplined Proposal.`,
    riskProtection: `Use a stop near ${fmtUsd(stop)} because RS leadership can fail quickly when the benchmark starts winning again.`,
    invalidation:
      verdict === 'support'
        ? `The idea is wrong if ${input.assetId} falls back below its RS average versus ${input.benchmarkAssetId}.`
        : `The skeptical view is wrong if ${input.assetId} starts outperforming ${input.benchmarkAssetId} over both 3-month and 6-month windows.`,
    evidence: [
      `Benchmark: ${input.benchmarkAssetId}.`,
      `Task 7 readings: regime=${regime}, rs_above_sma=${aboveSma ? 'yes' : 'no'}, rel_6m=${fmtPct(rel6m ?? 0)}.`,
      `Lookahead-free RS backtest: strategy ${fmtPct(backtest.totalReturnPct)} vs buy-and-hold ${fmtPct(backtest.benchmarkReturnPct)}.`,
    ],
    backtest,
    sourceFiles: [
      'Fundamental_analysis_agent/task7_relative/pipeline/indicators.py',
      'Fundamental_analysis_agent/task7_relative/pipeline/backtest.py',
      'Fundamental_analysis_agent/prompts/task7_relative/relative_author.md',
      'Fundamental_analysis_agent/task7_relative/tests/test_relative.py',
    ],
    indicators,
  };
}

function volatilityRegimeOpinion(input: {
  analyst: AiAnalystCatalogItem;
  assetId: string;
  idea: string;
  bars: readonly PreparedBar[];
}): AnalystOpinion {
  const closes = input.bars.map((bar) => bar.close);
  const returns = closeReturns(closes);
  const volSeries = closes
    .map((_, index) => realizedVolAt(returns, index, 20))
    .filter((value): value is number => value != null);

  const currentVol = volSeries.at(-1) ?? 0;
  const sorted = [...volSeries].sort((a, b) => a - b);
  const medianVol = sorted[Math.floor(sorted.length / 2)] ?? currentVol;
  const percentile =
    sorted.length > 0
      ? (sorted.filter((value) => value <= currentVol).length / sorted.length) * 100
      : 50;
  const regime = percentile >= 80 ? 'stressed' : percentile <= 40 ? 'calm' : 'normal';
  const verdict: AnalystVerdict =
    regime === 'calm' ? 'support' : regime === 'stressed' ? 'reject' : 'challenge';
  const confidence = verdict === 'support' ? 0.73 : verdict === 'reject' ? 0.7 : 0.62;
  const threshold = Math.max(5, medianVol);

  const wantLong: WantLong =
    verdict === 'support'
      ? (index) => {
          const vol = realizedVolAt(returns, index, 20);
          const trend = smaAt(closes, index, 100);
          return vol != null && vol <= threshold && trend != null && closes[index]! > trend;
        }
      : (index) => {
          const vol = realizedVolAt(returns, index, 20);
          return vol != null && vol <= threshold;
        };
  const backtest = runLongFlatBacktest(input.bars, wantLong);
  const indicators = baseIndicatorsFromBars(input.bars);
  const last = input.bars.at(-1)!.close;
  const stop = last * (regime === 'stressed' ? 0.88 : 0.92);

  return {
    analystId: input.analyst.id,
    analystName: input.analyst.name,
    originTask: input.analyst.originTask,
    verdict,
    confidence,
    thesis:
      verdict === 'support'
        ? `${input.assetId} is in a calm volatility regime: current realized vol is ${currentVol.toFixed(1)}% versus median ${medianVol.toFixed(1)}%, around the ${percentile.toFixed(0)}th percentile.`
        : verdict === 'reject'
          ? `${input.assetId} is in a stressed volatility regime: current realized vol is ${currentVol.toFixed(1)}%, around the ${percentile.toFixed(0)}th percentile of its own history.`
          : `${input.assetId} volatility is not extreme, but it is not calm enough to ignore: current vol is ${currentVol.toFixed(1)}% versus median ${medianVol.toFixed(1)}%.`,
    whyNow: `Task 14 gates exposure by trailing realized volatility, using only returns available as of the latest bar.`,
    setupEntry:
      verdict === 'reject'
        ? `Do not turn this into a Proposal until realized volatility falls back below roughly ${threshold.toFixed(1)}%.`
        : `Only enter while realized volatility stays below ${threshold.toFixed(1)}% and price holds its trend filter.`,
    riskProtection: `Volatility is the risk control. Size conservatively and place stop protection near ${fmtUsd(stop)} so a volatility expansion does not dominate the mandate drawdown.`,
    invalidation:
      verdict === 'support'
        ? `The supportive read fails if realized volatility jumps above the ${threshold.toFixed(1)}% calm-regime threshold.`
        : `The cautious read is wrong if volatility compresses below ${threshold.toFixed(1)}% while price remains above its trend average.`,
    evidence: [
      `Task 14 readings: regime=${regime}, current_vol=${currentVol.toFixed(1)}%, median_vol=${medianVol.toFixed(1)}%, percentile=${percentile.toFixed(0)}.`,
      `Vol-managed backtest: strategy ${fmtPct(backtest.totalReturnPct)} vs buy-and-hold ${fmtPct(backtest.benchmarkReturnPct)}.`,
      `Original Grill Idea considered: "${input.idea.trim()}".`,
    ],
    backtest,
    sourceFiles: [
      'Fundamental_analysis_agent/task14_volatility/pipeline/backtest.py',
      'Fundamental_analysis_agent/prompts/task14_volatility/vol_author.md',
      'Fundamental_analysis_agent/task14_volatility/tests/test_volatility.py',
    ],
    indicators,
  };
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function barDate(bar: Pick<Bar, 'time'>): Date {
  return new Date(bar.time * 1000);
}

function isTurnOfMonth(
  bars: readonly PreparedBar[],
  index: number,
  before: number,
  after: number,
): boolean {
  const date = barDate(bars[index]!);
  let afterCount = 0;
  let cursor = index;
  while (cursor - 1 >= 0) {
    const prev = barDate(bars[cursor - 1]!);
    if (
      prev.getUTCMonth() !== date.getUTCMonth() ||
      prev.getUTCFullYear() !== date.getUTCFullYear()
    )
      break;
    afterCount++;
    cursor--;
    if (afterCount >= after) break;
  }
  if (afterCount < after) return true;

  let beforeCount = 0;
  cursor = index;
  while (cursor + 1 < bars.length) {
    const next = barDate(bars[cursor + 1]!);
    if (
      next.getUTCMonth() !== date.getUTCMonth() ||
      next.getUTCFullYear() !== date.getUTCFullYear()
    )
      break;
    beforeCount++;
    cursor++;
    if (beforeCount >= before) break;
  }
  return beforeCount < before;
}

function annualizedReturnPct(returns: readonly number[]): number {
  return returns.length > 0
    ? (returns.reduce((sum, value) => sum + value, 0) / returns.length) * 252 * 100
    : 0;
}

function seasonalReadings(bars: readonly PreparedBar[]): {
  bestMonths: string;
  worstMonths: string;
  bestMonthNumbers: number[];
  novAprAnnPct: number;
  mayOctAnnPct: number;
  turnOfMonthAnnPct: number;
  restOfMonthAnnPct: number;
  yearsOfHistory: number;
} {
  const byMonth = Array.from({ length: 12 }, () => [] as number[]);
  const turn: number[] = [];
  const rest: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!.close;
    const current = bars[i]!.close;
    const ret = prev > 0 ? current / prev - 1 : 0;
    const month = barDate(bars[i]!).getUTCMonth();
    byMonth[month]!.push(ret);
    (isTurnOfMonth(bars, i, 3, 3) ? turn : rest).push(ret);
  }
  const monthAnn = byMonth.map((returns, index) => ({
    month: index + 1,
    value: annualizedReturnPct(returns),
  }));
  const ranked = [...monthAnn].sort((a, b) => b.value - a.value);
  const avgMonths = (months: readonly number[]) =>
    months.reduce((sum, month) => sum + (monthAnn[month - 1]?.value ?? 0), 0) / months.length;
  return {
    bestMonths: ranked
      .slice(0, 3)
      .map(({ month, value }) => `${MONTH_LABELS[month - 1]}(${fmtPct(value, 0)})`)
      .join(', '),
    worstMonths: ranked
      .slice(-3)
      .map(({ month, value }) => `${MONTH_LABELS[month - 1]}(${fmtPct(value, 0)})`)
      .join(', '),
    bestMonthNumbers: ranked.slice(0, 3).map(({ month }) => month),
    novAprAnnPct: round(avgMonths([11, 12, 1, 2, 3, 4]), 1),
    mayOctAnnPct: round(avgMonths([5, 6, 7, 8, 9, 10]), 1),
    turnOfMonthAnnPct: round(annualizedReturnPct(turn), 1),
    restOfMonthAnnPct: round(annualizedReturnPct(rest), 1),
    yearsOfHistory: round((bars.at(-1)!.time - bars[0]!.time) / (365 * 86_400), 1),
  };
}

function seasonalWantLong(
  bars: readonly PreparedBar[],
  strategy: 'buy_and_hold' | 'best_months' | 'sell_in_may' | 'turn_of_month',
  bestMonths: readonly number[],
): WantLong {
  return (index) => {
    const month = barDate(bars[index]!).getUTCMonth() + 1;
    if (strategy === 'buy_and_hold') return true;
    if (strategy === 'best_months') return bestMonths.includes(month);
    if (strategy === 'sell_in_may') return [11, 12, 1, 2, 3, 4].includes(month);
    if (strategy === 'turn_of_month') return isTurnOfMonth(bars, index, 3, 3);
    return false;
  };
}

function seasonalityOpinion(input: {
  analyst: AiAnalystCatalogItem;
  assetId: string;
  idea: string;
  bars: readonly PreparedBar[];
}): AnalystOpinion {
  const readings = seasonalReadings(input.bars);
  const sellInMayGap = readings.novAprAnnPct - readings.mayOctAnnPct;
  const turnGap = readings.turnOfMonthAnnPct - readings.restOfMonthAnnPct;
  const strategy =
    sellInMayGap > 8
      ? 'sell_in_may'
      : turnGap > 8
        ? 'turn_of_month'
        : readings.bestMonthNumbers.length > 0 && sellInMayGap > 3
          ? 'best_months'
          : 'buy_and_hold';
  const verdict: AnalystVerdict = strategy === 'buy_and_hold' ? 'challenge' : 'support';
  const confidence = strategy === 'buy_and_hold' ? 0.56 : 0.64;
  const backtest = runLongFlatBacktest(
    input.bars,
    seasonalWantLong(input.bars, strategy, readings.bestMonthNumbers),
  );
  const indicators = baseIndicatorsFromBars(input.bars);
  const last = input.bars.at(-1)!.close;

  return {
    analystId: input.analyst.id,
    analystName: input.analyst.name,
    originTask: input.analyst.originTask,
    verdict,
    confidence,
    thesis:
      strategy === 'buy_and_hold'
        ? `${input.assetId} does not have a strong enough calendar edge to drive the trade. Best months are ${readings.bestMonths}, but the seasonal spread is not decisive.`
        : `${input.assetId} has a calendar pattern worth respecting: best months are ${readings.bestMonths}, Nov-Apr annualized return is ${fmtPct(readings.novAprAnnPct)}, and May-Oct is ${fmtPct(readings.mayOctAnnPct)}.`,
    whyNow: `Task 12 estimates calendar statistics over ${readings.yearsOfHistory.toFixed(1)} years of bars, including turn-of-month annualized return ${fmtPct(readings.turnOfMonthAnnPct)} versus rest-of-month ${fmtPct(readings.restOfMonthAnnPct)}.`,
    setupEntry:
      strategy === 'sell_in_may'
        ? `Only let the idea become a Proposal inside the Nov-Apr seasonal window.`
        : strategy === 'turn_of_month'
          ? `Prefer entries around the turn-of-month window instead of mid-month drift.`
          : strategy === 'best_months'
            ? `Prefer entries during ${readings.bestMonthNumbers.map((month) => MONTH_LABELS[month - 1]).join(', ')}.`
            : `Do not force timing from the calendar alone; require another analyst to supply the entry trigger.`,
    riskProtection: `Calendar effects are in-sample and fragile. Use normal stop protection around ${fmtUsd(last * 0.92)} and do not size larger because of seasonality.`,
    invalidation:
      strategy === 'buy_and_hold'
        ? `The challenge view is wrong if another data lens confirms momentum and the calendar is merely neutral.`
        : `The seasonal read is wrong if price action breaks down during the favored calendar window.`,
    evidence: [
      `Task 12 calendar readings: years=${readings.yearsOfHistory.toFixed(1)}, best=${readings.bestMonths}, worst=${readings.worstMonths}.`,
      `Seasonal backtest: strategy ${fmtPct(backtest.totalReturnPct)} vs buy-and-hold ${fmtPct(backtest.benchmarkReturnPct)}.`,
      `Caveat preserved: calendar effects are estimated in-sample and should not be treated as a standalone edge.`,
    ],
    backtest,
    sourceFiles: [
      'Fundamental_analysis_agent/task12_seasonality/pipeline/signals.py',
      'Fundamental_analysis_agent/task12_seasonality/pipeline/backtest.py',
      'Fundamental_analysis_agent/prompts/task12_seasonality/seasonal_author.md',
      'Fundamental_analysis_agent/task12_seasonality/tests/test_seasonality.py',
    ],
    indicators,
  };
}

function gapReadings(bars: readonly PreparedBar[]): {
  overnightAnnPct: number;
  intradayAnnPct: number;
  overnightShare: 'dominant' | 'weak';
  overnightWinRatePct: number;
  nDays: number;
} {
  const overnight: number[] = [];
  const intraday: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const previousClose = bars[i - 1]!.close;
    const open = bars[i]!.open;
    const close = bars[i]!.close;
    if (previousClose > 0 && open > 0) {
      overnight.push(open / previousClose - 1);
      intraday.push(close / open - 1);
    }
  }
  const overnightAnnPct = annualizedReturnPct(overnight);
  const intradayAnnPct = annualizedReturnPct(intraday);
  return {
    overnightAnnPct: round(overnightAnnPct, 1),
    intradayAnnPct: round(intradayAnnPct, 1),
    overnightShare:
      overnightAnnPct > Math.abs(intradayAnnPct) && overnightAnnPct > 0 ? 'dominant' : 'weak',
    overnightWinRatePct:
      overnight.length > 0
        ? round((overnight.filter((value) => value > 0).length / overnight.length) * 100, 1)
        : 0,
    nDays: overnight.length,
  };
}

function runGapBacktest(
  bars: readonly PreparedBar[],
  strategy: 'buy_and_hold' | 'overnight' | 'intraday' | 'overnight_after_up',
  transactionCostBps = 10,
): AnalystBacktestSummary {
  if (bars.length < 3) {
    return {
      totalReturnPct: 0,
      benchmarkReturnPct: 0,
      excessReturnPct: 0,
      maxDrawdownPct: 0,
      nTrades: 0,
      exposurePct: 0,
    };
  }
  const window = bars.slice(Math.max(0, bars.length - 252));
  const cost = transactionCostBps / 10_000;
  const roundTrip = (1 - cost) ** 2;
  const benchEntry = window[1]!.open;
  let equity = 1;
  let buyHoldShares = 0;
  let buyHoldCash = 1;
  let participatingDays = 0;
  let trades = 0;
  const curve: number[] = [];

  for (let i = 0; i < window.length; i++) {
    let traded = false;
    let dailyReturn = 0;
    if (i >= 1 && window[i - 1]!.close > 0 && window[i]!.open > 0) {
      if (strategy === 'overnight') {
        dailyReturn = window[i]!.open / window[i - 1]!.close - 1;
        traded = true;
      } else if (strategy === 'intraday') {
        dailyReturn = window[i]!.close / window[i]!.open - 1;
        traded = true;
      } else if (
        strategy === 'overnight_after_up' &&
        i >= 2 &&
        window[i - 1]!.close > window[i - 2]!.close
      ) {
        dailyReturn = window[i]!.open / window[i - 1]!.close - 1;
        traded = true;
      }
    }

    if (strategy === 'buy_and_hold') {
      if (i === 1) {
        buyHoldShares = buyHoldCash / (window[1]!.open * (1 + cost));
        buyHoldCash = 0;
        trades = 1;
      }
      equity = buyHoldShares > 0 ? buyHoldShares * window[i]!.close : buyHoldCash;
      if (i >= 1) participatingDays++;
    } else if (traded) {
      equity *= (1 + dailyReturn) * roundTrip;
      participatingDays++;
      trades++;
    }

    curve.push(round(equity, 6));
  }

  const final = curve.at(-1) ?? 1;
  const benchmark = (window.at(-1)!.close / benchEntry - 1) * 100;
  let peak = curve[0] ?? 1;
  let maxDrawdown = 0;
  for (const point of curve) {
    peak = Math.max(peak, point);
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, point / peak - 1);
  }
  const totalReturnPct = (final - 1) * 100;
  return {
    totalReturnPct: round(totalReturnPct),
    benchmarkReturnPct: round(benchmark),
    excessReturnPct: round(totalReturnPct - benchmark),
    maxDrawdownPct: round(maxDrawdown * 100),
    nTrades: trades,
    exposurePct: round((participatingDays / window.length) * 100, 1),
  };
}

function overnightGapOpinion(input: {
  analyst: AiAnalystCatalogItem;
  assetId: string;
  idea: string;
  bars: readonly PreparedBar[];
}): AnalystOpinion {
  const readings = gapReadings(input.bars);
  const strategy =
    readings.overnightShare === 'dominant' && readings.overnightWinRatePct > 52
      ? 'overnight_after_up'
      : readings.intradayAnnPct > readings.overnightAnnPct && readings.intradayAnnPct > 5
        ? 'intraday'
        : 'buy_and_hold';
  const verdict: AnalystVerdict = strategy === 'buy_and_hold' ? 'challenge' : 'support';
  const confidence = strategy === 'buy_and_hold' ? 0.58 : 0.64;
  const backtest = runGapBacktest(input.bars, strategy);
  const indicators = baseIndicatorsFromBars(input.bars);
  const last = input.bars.at(-1)!.close;

  return {
    analystId: input.analyst.id,
    analystName: input.analyst.name,
    originTask: input.analyst.originTask,
    verdict,
    confidence,
    thesis:
      strategy === 'buy_and_hold'
        ? `${input.assetId} does not have a clean tradable overnight gap edge after costs. Overnight annualized return is ${fmtPct(readings.overnightAnnPct)} and intraday is ${fmtPct(readings.intradayAnnPct)}.`
        : `${input.assetId} has a meaningful overnight gap profile: overnight annualized return is ${fmtPct(readings.overnightAnnPct)}, intraday is ${fmtPct(readings.intradayAnnPct)}, and overnight wins ${readings.overnightWinRatePct.toFixed(1)}% of sessions.`,
    whyNow: `Task 13 decomposes each bar into prior close to open and open to close. The current split says overnight share is ${readings.overnightShare}.`,
    setupEntry:
      strategy === 'overnight_after_up'
        ? `If this becomes a Proposal, prefer a trigger after an up close rather than a blind daily entry.`
        : strategy === 'intraday'
          ? `Favor an intraday confirmation trigger, because the open-to-close segment has carried more of the return.`
          : `Use another analyst for the trigger; the gap lens alone argues against a special entry window.`,
    riskProtection: `Daily overnight-only rules pay round-trip cost every session. Keep turnover low, avoid oversizing, and protect below ${fmtUsd(last * 0.93)}.`,
    invalidation:
      strategy === 'buy_and_hold'
        ? `The challenge view is wrong if overnight return remains dominant even after the cost model.`
        : `The gap read is wrong if the next sessions stop opening above the prior close or if costs erase the gross edge.`,
    evidence: [
      `Task 13 readings: overnight=${fmtPct(readings.overnightAnnPct)}, intraday=${fmtPct(readings.intradayAnnPct)}, win_rate=${readings.overnightWinRatePct.toFixed(1)}%.`,
      `Gap backtest with 10 bps per side: strategy ${fmtPct(backtest.totalReturnPct)} vs buy-and-hold ${fmtPct(backtest.benchmarkReturnPct)}.`,
      `Cost caveat preserved: overnight-only and intraday-only variants can be destroyed by daily round-trip costs.`,
    ],
    backtest,
    sourceFiles: [
      'Fundamental_analysis_agent/task13_overnight/pipeline/backtest.py',
      'Fundamental_analysis_agent/prompts/task13_overnight/gap_author.md',
      'Fundamental_analysis_agent/task13_overnight/tests/test_overnight.py',
    ],
    indicators,
  };
}

function anomalyReadings(bars: readonly PreparedBar[]): {
  regime: 'near_high' | 'mid_range' | 'deep_below_high';
  pctBelow52wHigh: number;
  recentMaxDailyPct: number;
  trailing11mReturnPct: number | null;
  currentMonth: number;
} {
  const closes = bars.map((bar) => bar.close);
  const index = bars.length - 1;
  const highStart = Math.max(0, index - 251);
  const high52 = Math.max(...closes.slice(highStart, index + 1));
  const pctBelow52wHigh = high52 > 0 ? (1 - closes[index]! / high52) * 100 : 0;
  const maxStart = Math.max(1, index - 20);
  let recentMaxDailyPct = 0;
  for (let i = maxStart; i <= index; i++) {
    const prev = closes[i - 1] ?? 0;
    if (prev > 0) recentMaxDailyPct = Math.max(recentMaxDailyPct, (closes[i]! / prev - 1) * 100);
  }
  const trailing11mReturnPct =
    index >= 231 && closes[index - 231]! > 0
      ? (closes[index]! / closes[index - 231]! - 1) * 100
      : null;
  return {
    regime:
      pctBelow52wHigh <= 5 ? 'near_high' : pctBelow52wHigh <= 25 ? 'mid_range' : 'deep_below_high',
    pctBelow52wHigh: round(pctBelow52wHigh, 1),
    recentMaxDailyPct: round(recentMaxDailyPct, 1),
    trailing11mReturnPct: trailing11mReturnPct == null ? null : round(trailing11mReturnPct, 1),
    currentMonth: barDate(bars[index]!).getUTCMonth() + 1,
  };
}

function anomalyWantLong(
  bars: readonly PreparedBar[],
  strategy: 'buy_and_hold' | 'near_52w_high' | 'avoid_max_lottery' | 'tax_loss_reversal',
): WantLong {
  const closes = bars.map((bar) => bar.close);
  return (index) => {
    if (strategy === 'buy_and_hold') return true;
    if (strategy === 'near_52w_high') {
      const highStart = Math.max(0, index - 251);
      const high52 = Math.max(...closes.slice(highStart, index + 1));
      return high52 > 0 && closes[index]! >= high52 * 0.95;
    }
    if (strategy === 'avoid_max_lottery') {
      const start = Math.max(1, index - 20);
      for (let i = start; i <= index; i++) {
        const prev = closes[i - 1] ?? 0;
        if (prev > 0 && closes[i]! / prev - 1 >= 0.1) return false;
      }
      return true;
    }
    if (strategy === 'tax_loss_reversal') {
      const month = barDate(bars[index]!).getUTCMonth() + 1;
      return (
        [12, 1].includes(month) &&
        index >= 231 &&
        closes[index - 231]! > 0 &&
        closes[index]! / closes[index - 231]! - 1 < 0
      );
    }
    return false;
  };
}

function priceAnomalyOpinion(input: {
  analyst: AiAnalystCatalogItem;
  assetId: string;
  idea: string;
  bars: readonly PreparedBar[];
}): AnalystOpinion {
  const readings = anomalyReadings(input.bars);
  const strategy =
    readings.regime === 'near_high'
      ? 'near_52w_high'
      : readings.recentMaxDailyPct >= 10
        ? 'avoid_max_lottery'
        : readings.trailing11mReturnPct != null &&
            readings.trailing11mReturnPct < 0 &&
            [12, 1].includes(readings.currentMonth)
          ? 'tax_loss_reversal'
          : 'buy_and_hold';
  const verdict: AnalystVerdict =
    strategy === 'near_52w_high' || strategy === 'tax_loss_reversal'
      ? 'support'
      : strategy === 'avoid_max_lottery'
        ? 'reject'
        : 'challenge';
  const confidence = verdict === 'support' ? 0.69 : verdict === 'reject' ? 0.67 : 0.58;
  const backtest = runLongFlatBacktest(input.bars, anomalyWantLong(input.bars, strategy));
  const indicators = baseIndicatorsFromBars(input.bars);
  const last = input.bars.at(-1)!.close;

  return {
    analystId: input.analyst.id,
    analystName: input.analyst.name,
    originTask: input.analyst.originTask,
    verdict,
    confidence,
    thesis:
      strategy === 'near_52w_high'
        ? `${input.assetId} is a 52-week-high momentum candidate: it sits only ${readings.pctBelow52wHigh.toFixed(1)}% below its trailing high.`
        : strategy === 'avoid_max_lottery'
          ? `${input.assetId} has a MAX / lottery warning: the largest recent daily move is ${fmtPct(readings.recentMaxDailyPct)}, which argues against chasing the spike.`
          : strategy === 'tax_loss_reversal'
            ? `${input.assetId} fits a tax-loss reversal pattern with trailing 11-month return ${fmtPct(readings.trailing11mReturnPct ?? 0)} in month ${readings.currentMonth}.`
            : `${input.assetId} does not show a strong price-anomaly edge. It is ${readings.pctBelow52wHigh.toFixed(1)}% below its 52-week high and recent MAX is ${fmtPct(readings.recentMaxDailyPct)}.`,
    whyNow: `Task 19 uses trailing windows only: 52-week high proximity, recent 21-bar MAX move, and an 11-month loser check for Dec-Jan.`,
    setupEntry:
      strategy === 'near_52w_high'
        ? `Let the idea proceed only while price remains within 5% of its trailing 52-week high.`
        : strategy === 'avoid_max_lottery'
          ? `Wait for the spike window to cool before creating a Proposal.`
          : strategy === 'tax_loss_reversal'
            ? `Only use this as a short seasonal reversal setup in Dec-Jan, not a broad trend thesis.`
            : `Require another analyst to supply the entry trigger; anomaly evidence is neutral.`,
    riskProtection: `Use a stop near ${fmtUsd(last * 0.91)} because anomaly effects are statistical, not company-specific protection.`,
    invalidation:
      strategy === 'near_52w_high'
        ? `The momentum anomaly fails if price drops more than 5% below the trailing high.`
        : strategy === 'avoid_max_lottery'
          ? `The rejection is wrong if the MAX spike exits the lookback window without price deterioration.`
          : `The neutral anomaly view is wrong if price presses back to a fresh 52-week high.`,
    evidence: [
      `Task 19 trailing readings: regime=${readings.regime}, pct_below_52w_high=${readings.pctBelow52wHigh.toFixed(1)}%, recent_MAX=${fmtPct(readings.recentMaxDailyPct)}.`,
      `Anomaly backtest: strategy ${fmtPct(backtest.totalReturnPct)} vs buy-and-hold ${fmtPct(backtest.benchmarkReturnPct)}.`,
      `Original Grill Idea considered: "${input.idea.trim()}".`,
    ],
    backtest,
    sourceFiles: [
      'Fundamental_analysis_agent/task19_anomaly/pipeline/signals.py',
      'Fundamental_analysis_agent/task19_anomaly/pipeline/orchestrator.py',
      'Fundamental_analysis_agent/prompts/task19_anomaly/anomaly_author.md',
      'Fundamental_analysis_agent/task19_anomaly/tests/test_anomaly.py',
    ],
    indicators,
  };
}

type RankFactor = 'momentum_12_1' | 'low_volatility' | 'near_52w_high' | 'short_term_reversal';

interface RankerSpec {
  factor: RankFactor;
  topN: number;
  rebalance: 'weekly' | 'monthly' | 'quarterly';
  lookbackDays: number;
  stance: 'bullish' | 'neutral' | 'cautious';
}

interface RankerUniverse {
  assetIds: string[];
  commonTimes: number[];
  alignedBarsByAssetId: Map<string, PreparedBar[]>;
  closesByAssetId: Map<string, number[]>;
}

interface RankerReadings {
  nNames: number;
  momentumSpread: string;
  volSpread: string;
  highProximitySpread: string;
  reversalSpread: string;
  momentumDispersionPct: number;
  volDispersionPct: number;
  reversalDispersionPct: number;
}

const RANKER_TRADING_DAYS = 252;
const RANKER_MONTH = 21;

function rankerAnnVol(closes: readonly number[]): number {
  if (closes.length < 3) return 0;
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1] ?? 0;
    const current = closes[i] ?? 0;
    if (prev > 0) returns.push(current / prev - 1);
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(RANKER_TRADING_DAYS);
}

function rankFactorValue(
  closes: readonly number[],
  end: number,
  factor: RankFactor,
  lookback: number,
): number | null {
  if (end <= 0) return null;
  const hist = closes.slice(0, end);
  const n = hist.length;
  const last = hist.at(-1);
  if (last == null) return null;

  if (factor === 'momentum_12_1') {
    if (n < lookback + 1) return null;
    const old = hist[n - lookback];
    const recent = hist[n - RANKER_MONTH - 1];
    return old && recent && old > 0 ? recent / old - 1 : null;
  }

  if (factor === 'low_volatility') {
    if (n < lookback) return null;
    return -rankerAnnVol(hist.slice(n - lookback));
  }

  if (factor === 'near_52w_high') {
    if (n < lookback) return null;
    const high = Math.max(...hist.slice(n - lookback));
    return high > 0 ? last / high : null;
  }

  if (factor === 'short_term_reversal') {
    if (n < RANKER_MONTH + 1) return null;
    const old = hist[n - RANKER_MONTH - 1];
    return old && old > 0 ? -(last / old - 1) : null;
  }

  return null;
}

function spreadString(values: readonly number[]): string {
  if (values.length === 0) return '0.0 / 0.0 / 0.0';
  const min = Math.min(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const max = Math.max(...values);
  return `${round(min, 1)} / ${round(mean, 1)} / ${round(max, 1)}`;
}

function rankerReadings(closesByAssetId: ReadonlyMap<string, readonly number[]>): RankerReadings {
  const momentum: number[] = [];
  const vol: number[] = [];
  const proximity: number[] = [];
  const reversal: number[] = [];

  for (const closes of closesByAssetId.values()) {
    const n = closes.length;
    const momentumValue = rankFactorValue(closes, n, 'momentum_12_1', RANKER_TRADING_DAYS);
    if (momentumValue != null) momentum.push(momentumValue * 100);
    const volValue = rankFactorValue(closes, n, 'low_volatility', 63);
    if (volValue != null) vol.push(-volValue * 100);
    const proximityValue = rankFactorValue(closes, n, 'near_52w_high', RANKER_TRADING_DAYS);
    if (proximityValue != null) proximity.push(proximityValue * 100);
    const reversalValue = rankFactorValue(closes, n, 'short_term_reversal', RANKER_MONTH);
    if (reversalValue != null) reversal.push(-reversalValue * 100);
  }

  const momentumDispersion =
    momentum.length > 0 ? Math.max(...momentum) - Math.min(...momentum) : 0;
  const volDispersion = vol.length > 0 ? Math.max(...vol) - Math.min(...vol) : 0;
  const reversalDispersion =
    reversal.length > 0 ? Math.max(...reversal) - Math.min(...reversal) : 0;

  return {
    nNames: closesByAssetId.size,
    momentumSpread: spreadString(momentum),
    volSpread: spreadString(vol),
    highProximitySpread: spreadString(proximity),
    reversalSpread: spreadString(reversal),
    momentumDispersionPct: round(momentumDispersion, 1),
    volDispersionPct: round(volDispersion, 1),
    reversalDispersionPct: round(reversalDispersion, 1),
  };
}

function chooseRankerSpec(readings: RankerReadings): RankerSpec {
  const factor: RankFactor =
    readings.momentumDispersionPct >= 12 &&
    readings.momentumDispersionPct >= readings.volDispersionPct * 0.6
      ? 'momentum_12_1'
      : readings.volDispersionPct >= 15
        ? 'low_volatility'
        : readings.reversalDispersionPct >= 8
          ? 'short_term_reversal'
          : 'near_52w_high';

  return {
    factor,
    topN: Math.max(1, Math.min(readings.nNames - 1, Math.ceil(readings.nNames / 3))),
    rebalance:
      factor === 'short_term_reversal'
        ? 'weekly'
        : factor === 'near_52w_high'
          ? 'quarterly'
          : 'monthly',
    lookbackDays: factor === 'low_volatility' ? 63 : RANKER_TRADING_DAYS,
    stance: factor === 'low_volatility' ? 'cautious' : 'bullish',
  };
}

function buildRankerUniverse(input: {
  assetId: string;
  barsByAssetId: ReadonlyMap<string, readonly Bar[]>;
}): RankerUniverse {
  const alignedCandidates = rankerUniverseAssetIds(input.assetId)
    .map((assetId) => ({ assetId, bars: prepareBars(input.barsByAssetId.get(assetId) ?? []) }))
    .filter(({ bars }) => bars.length >= 260);

  const selected = alignedCandidates.find((candidate) => candidate.assetId === input.assetId);
  if (!selected) {
    throw new Error(`Not enough cross-sectional history for ${input.assetId}.`);
  }
  if (alignedCandidates.length < RANKER_MIN_NAMES) {
    throw new Error(
      `Need at least ${RANKER_MIN_NAMES} Hunch assets with ranker history; got ${alignedCandidates.length}.`,
    );
  }

  const timeSets = alignedCandidates.map(({ bars }) => new Set(bars.map((bar) => bar.time)));
  const commonTimes = Array.from(timeSets[0] ?? [])
    .filter((time) => timeSets.every((set) => set.has(time)))
    .sort((a, b) => a - b);
  const trailingTimes = commonTimes.slice(-756);
  if (trailingTimes.length < 260) {
    throw new Error(`Only ${trailingTimes.length} shared ranker bars; need at least 260.`);
  }

  const alignedBarsByAssetId = new Map<string, PreparedBar[]>();
  const closesByAssetId = new Map<string, number[]>();
  for (const { assetId, bars } of alignedCandidates) {
    const byTime = new Map(bars.map((bar) => [bar.time, bar]));
    const alignedBars: PreparedBar[] = [];
    for (const time of trailingTimes) {
      const bar = byTime.get(time);
      if (bar) alignedBars.push(bar);
    }
    if (alignedBars.length !== trailingTimes.length) continue;
    alignedBarsByAssetId.set(assetId, alignedBars);
    closesByAssetId.set(
      assetId,
      alignedBars.map((bar) => bar.close),
    );
  }

  return {
    assetIds: Array.from(closesByAssetId.keys()),
    commonTimes: trailingTimes,
    alignedBarsByAssetId,
    closesByAssetId,
  };
}

function buildRankerMembership(input: { universe: RankerUniverse; spec: RankerSpec }): {
  inMarketByAssetId: Map<string, boolean[]>;
  latestFactorByAssetId: Map<string, number | null>;
  latestRankByAssetId: Map<string, number | null>;
} {
  const inMarketByAssetId = new Map(
    input.universe.assetIds.map((assetId) => [
      assetId,
      Array.from({ length: input.universe.commonTimes.length }, () => false),
    ]),
  );
  const latestFactorByAssetId = new Map<string, number | null>(
    input.universe.assetIds.map((assetId) => [assetId, null]),
  );
  const latestRankByAssetId = new Map<string, number | null>(
    input.universe.assetIds.map((assetId) => [assetId, null]),
  );

  for (let i = 0; i < input.universe.commonTimes.length; i++) {
    const ranked = input.universe.assetIds
      .map((assetId) => ({
        assetId,
        value: rankFactorValue(
          input.universe.closesByAssetId.get(assetId) ?? [],
          i,
          input.spec.factor,
          input.spec.lookbackDays,
        ),
      }))
      .filter((entry): entry is { assetId: string; value: number } => entry.value != null)
      .sort((a, b) => b.value - a.value);

    for (const { assetId } of ranked.slice(0, input.spec.topN)) {
      inMarketByAssetId.get(assetId)![i] = true;
    }

    if (i === input.universe.commonTimes.length - 1) {
      for (const { assetId, value } of ranked) latestFactorByAssetId.set(assetId, value);
      ranked.forEach(({ assetId }, index) => latestRankByAssetId.set(assetId, index + 1));
    }
  }

  return { inMarketByAssetId, latestFactorByAssetId, latestRankByAssetId };
}

function crossSectionalRankerOpinion(input: {
  analyst: AiAnalystCatalogItem;
  assetId: string;
  idea: string;
  barsByAssetId: ReadonlyMap<string, readonly Bar[]>;
}): AnalystOpinion {
  const universe = buildRankerUniverse({
    assetId: input.assetId,
    barsByAssetId: input.barsByAssetId,
  });
  const readings = rankerReadings(universe.closesByAssetId);
  const spec = chooseRankerSpec(readings);
  const membership = buildRankerMembership({ universe, spec });
  const rank = membership.latestRankByAssetId.get(input.assetId) ?? null;
  const selectedNow = membership.inMarketByAssetId.get(input.assetId)?.at(-1) ?? false;
  const targetBars = universe.alignedBarsByAssetId.get(input.assetId);
  if (!targetBars) throw new Error(`No aligned ranker bars for ${input.assetId}.`);
  const backtest = runLongFlatBacktest(
    targetBars,
    (index) => membership.inMarketByAssetId.get(input.assetId)?.[index] ?? false,
  );
  const indicators = baseIndicatorsFromBars(targetBars);
  const nNames = universe.assetIds.length;
  const percentile = rank == null || nNames <= 1 ? 0.5 : 1 - (rank - 1) / Math.max(1, nNames - 1);
  const verdict: AnalystVerdict =
    selectedNow && rank != null && rank <= spec.topN
      ? 'support'
      : rank != null && rank > Math.ceil(nNames * 0.75)
        ? 'reject'
        : 'challenge';
  const confidence =
    verdict === 'support' ? 0.72 : verdict === 'reject' ? 0.66 : 0.6 + percentile * 0.08;
  const last = targetBars.at(-1)!.close;

  return {
    analystId: input.analyst.id,
    analystName: input.analyst.name,
    originTask: input.analyst.originTask,
    verdict,
    confidence: round(Math.min(0.78, confidence), 2),
    thesis:
      verdict === 'support'
        ? `${input.assetId} ranks inside the top ${spec.topN} of ${nNames} Hunch tradable assets on the ${spec.factor} factor.`
        : verdict === 'reject'
          ? `${input.assetId} sits near the bottom of the ${nNames}-asset Hunch universe on the ${spec.factor} factor, so the outside idea lacks cross-sectional support.`
          : `${input.assetId} is not currently a top-${spec.topN} name in the ${nNames}-asset Hunch universe on the ${spec.factor} factor.`,
    whyNow: `Task 21 ranks the universe with trailing data only. Current universe stats: momentum spread ${readings.momentumSpread}, vol spread ${readings.volSpread}, and 52-week-high proximity ${readings.highProximitySpread}.`,
    setupEntry:
      verdict === 'support'
        ? `Let the idea proceed only while ${input.assetId} remains in the selected top-${spec.topN} rank bucket at the next ${spec.rebalance} check.`
        : `Wait until ${input.assetId} climbs into the top-${spec.topN} rank bucket before creating a Proposal from this lens.`,
    riskProtection: `Cross-sectional factors are relative, not absolute. Use normal stop protection near ${fmtUsd(last * 0.91)} and avoid oversizing if the whole universe is weak.`,
    invalidation:
      verdict === 'support'
        ? `The supportive ranker read is wrong if ${input.assetId} drops out of the top-${spec.topN} by the next rebalance.`
        : `The cautious read is wrong if ${input.assetId} rises into the selected top-${spec.topN} factor bucket.`,
    evidence: [
      `Task 21 factor policy: factor=${spec.factor}, top_n=${spec.topN}, rebalance=${spec.rebalance}, lookback_days=${spec.lookbackDays}.`,
      `Current rank: ${rank == null ? 'ineligible' : `${rank}/${nNames}`}; selected_now=${selectedNow ? 'yes' : 'no'}.`,
      `Lookahead-free ranker backtest for ${input.assetId}: strategy ${fmtPct(backtest.totalReturnPct)} vs buy-and-hold ${fmtPct(backtest.benchmarkReturnPct)}.`,
      `Original Grill Idea considered: "${input.idea.trim()}".`,
    ],
    backtest,
    sourceFiles: [
      'Fundamental_analysis_agent/task21_ranker/pipeline/rank.py',
      'Fundamental_analysis_agent/task21_ranker/pipeline/orchestrator.py',
      'Fundamental_analysis_agent/prompts/task21_ranker/rank_author.md',
      'Fundamental_analysis_agent/task21_ranker/tests/test_rank.py',
      'Fundamental_analysis_agent/task10_portfolio/pipeline/backtest.py',
    ],
    indicators,
  };
}

type PortfolioMethod = 'equal_weight' | 'inverse_vol' | 'risk_parity' | 'signal_proportional';
type PortfolioRebalance = 'weekly' | 'monthly' | 'quarterly';

interface PortfolioSpec {
  method: PortfolioMethod;
  maxWeight: number;
  grossCap: number;
  targetVolPct: number;
  rebalance: PortfolioRebalance;
  volLookbackDays: number;
  stance: 'bullish' | 'neutral' | 'cautious';
}

interface PortfolioUniverse {
  assetIds: string[];
  commonTimes: number[];
  alignedBarsByAssetId: Map<string, PreparedBar[]>;
  closesByAssetId: Map<string, number[]>;
}

interface PortfolioNameSignal {
  inMarket: boolean[];
  score: number;
  stance: 'bullish' | 'neutral' | 'cautious';
  note: string;
}

interface PortfolioReadings {
  nNames: number;
  nLongNow: number;
  breadthPctLongNow: number;
  meanAnnVolPct: number;
  minAnnVolPct: number;
  maxAnnVolPct: number;
  meanPairwiseCorrelation: number;
}

interface PortfolioBacktestResult {
  summary: AnalystBacktestSummary;
  avgWeightPctByAssetId: Map<string, number>;
  latestWeightPctByAssetId: Map<string, number>;
  longAsOfByAssetId: Map<string, boolean>;
  nRebalances: number;
  turnoverAnnualPct: number;
}

const PORTFOLIO_TRADING_DAYS = 252;
const PORTFOLIO_REBALANCE_STEP: Record<PortfolioRebalance, number> = {
  weekly: 5,
  monthly: 21,
  quarterly: 63,
};

function dailyReturnsFromCloses(closes: readonly number[]): number[] {
  const out = [0];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1] ?? 0;
    const current = closes[i] ?? 0;
    out.push(prev > 0 ? current / prev - 1 : 0);
  }
  return out;
}

function annualisedVolFromReturns(returns: readonly number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(PORTFOLIO_TRADING_DAYS);
}

function covarianceFromReturns(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const aa = a.slice(-n);
  const bb = b.slice(-n);
  const meanA = aa.reduce((sum, value) => sum + value, 0) / n;
  const meanB = bb.reduce((sum, value) => sum + value, 0) / n;
  return (
    (aa.reduce((sum, value, index) => sum + (value - meanA) * ((bb[index] ?? 0) - meanB), 0) /
      (n - 1)) *
    PORTFOLIO_TRADING_DAYS
  );
}

function normaliseWeights(weights: readonly number[]): number[] {
  const sum = weights.reduce((total, value) => total + value, 0);
  if (sum > 1e-12) return weights.map((value) => value / sum);
  return weights.length > 0 ? weights.map(() => 1 / weights.length) : [];
}

function equalPortfolioWeights(n: number): number[] {
  return n > 0 ? Array.from({ length: n }, () => 1 / n) : [];
}

function inverseVolPortfolioWeights(vols: readonly number[]): number[] {
  const inverse = vols.map((vol) => (vol > 1e-9 ? 1 / vol : 0));
  return inverse.reduce((sum, value) => sum + value, 0) > 1e-12
    ? normaliseWeights(inverse)
    : equalPortfolioWeights(vols.length);
}

function signalProportionalPortfolioWeights(scores: readonly number[]): number[] {
  const positive = scores.map((score) => Math.max(0, score));
  return positive.reduce((sum, value) => sum + value, 0) > 1e-12
    ? normaliseWeights(positive)
    : equalPortfolioWeights(scores.length);
}

function riskParityPortfolioWeights(cov: readonly (readonly number[])[], iterations = 100): number[] {
  const n = cov.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  const vols = cov.map((row, index) => Math.sqrt(Math.max(0, row[index] ?? 0)));
  let weights = inverseVolPortfolioWeights(vols);

  for (let iter = 0; iter < iterations; iter++) {
    const marginalRisk = cov.map((row) =>
      row.reduce((sum, value, index) => sum + value * (weights[index] ?? 0), 0),
    );
    const portVariance = weights.reduce(
      (sum, weight, index) => sum + weight * (marginalRisk[index] ?? 0),
      0,
    );
    if (portVariance <= 1e-18) return inverseVolPortfolioWeights(vols);
    const target = portVariance / n;
    weights = normaliseWeights(
      weights.map((weight, index) => {
        const contribution = weight * (marginalRisk[index] ?? 0);
        return weight * target / (contribution > 1e-18 ? contribution : 1e-18);
      }),
    );
  }

  return weights;
}

function applyPortfolioMaxWeight(weights: readonly number[], cap: number): number[] {
  const n = weights.length;
  if (n === 0 || cap <= 0) return [...weights];
  if (cap * n <= 1 + 1e-9) return equalPortfolioWeights(n);
  const out = [...weights];
  for (let iter = 0; iter < 2 * n + 2; iter++) {
    const over = out.map((weight, index) => ({ weight, index })).filter(({ weight }) => weight > cap + 1e-12);
    if (over.length === 0) break;
    const excess = over.reduce((sum, { weight }) => sum + weight - cap, 0);
    for (const { index } of over) out[index] = cap;
    const free = out
      .map((weight, index) => ({ weight, index }))
      .filter(({ weight }) => weight < cap - 1e-12);
    const freeSum = free.reduce((sum, { weight }) => sum + weight, 0);
    if (free.length === 0 || freeSum <= 1e-12) break;
    for (const { weight, index } of free) out[index] = weight + (excess * weight) / freeSum;
  }
  return out;
}

function scalePortfolioGrossAndVol(input: {
  weights: readonly number[];
  cov: readonly (readonly number[])[];
  grossCap: number;
  targetVolPct: number;
}): { weights: number[]; gross: number } {
  let gross = Math.min(1, Math.max(0, input.grossCap));
  if (input.targetVolPct > 0 && input.weights.length > 0) {
    const variance = input.weights.reduce(
      (sum, weight, row) =>
        sum +
        weight *
          input.weights.reduce(
            (inner, otherWeight, col) => inner + (input.cov[row]?.[col] ?? 0) * otherWeight,
            0,
          ),
      0,
    );
    const portVolPct = variance > 0 ? Math.sqrt(variance) * 100 : 0;
    if (portVolPct > input.targetVolPct && portVolPct > 1e-9) {
      gross = Math.min(gross, input.targetVolPct / portVolPct);
    }
  }
  return { weights: input.weights.map((weight) => weight * gross), gross };
}

function targetPortfolioWeights(input: {
  method: PortfolioMethod;
  vols: readonly number[];
  cov: readonly (readonly number[])[];
  scores: readonly number[];
  maxWeight: number;
  grossCap: number;
  targetVolPct: number;
}): { weights: number[]; gross: number } {
  const raw =
    input.method === 'inverse_vol'
      ? inverseVolPortfolioWeights(input.vols)
      : input.method === 'risk_parity'
        ? riskParityPortfolioWeights(input.cov)
        : input.method === 'signal_proportional'
          ? signalProportionalPortfolioWeights(input.scores)
          : equalPortfolioWeights(input.vols.length);
  const capped = applyPortfolioMaxWeight(raw, input.maxWeight);
  return scalePortfolioGrossAndVol({
    weights: capped,
    cov: input.cov,
    grossCap: input.grossCap,
    targetVolPct: input.targetVolPct,
  });
}

function buildPortfolioUniverse(input: {
  assetId: string;
  barsByAssetId: ReadonlyMap<string, readonly Bar[]>;
}): PortfolioUniverse {
  const candidates = portfolioUniverseAssetIds(input.assetId)
    .map((assetId) => ({ assetId, bars: prepareBars(input.barsByAssetId.get(assetId) ?? []) }))
    .filter(({ bars }) => bars.length >= 200);

  if (!candidates.some((candidate) => candidate.assetId === input.assetId)) {
    throw new Error(`Not enough portfolio history for ${input.assetId}.`);
  }
  if (candidates.length < PORTFOLIO_MIN_NAMES) {
    throw new Error(
      `Need at least ${PORTFOLIO_MIN_NAMES} Hunch assets with portfolio history; got ${candidates.length}.`,
    );
  }

  const timeSets = candidates.map(({ bars }) => new Set(bars.map((bar) => bar.time)));
  const commonTimes = Array.from(timeSets[0] ?? [])
    .filter((time) => timeSets.every((set) => set.has(time)))
    .sort((a, b) => a - b)
    .slice(-756);
  if (commonTimes.length < 200) {
    throw new Error(`Only ${commonTimes.length} shared portfolio bars; need at least 200.`);
  }

  const alignedBarsByAssetId = new Map<string, PreparedBar[]>();
  const closesByAssetId = new Map<string, number[]>();
  for (const { assetId, bars } of candidates) {
    const byTime = new Map(bars.map((bar) => [bar.time, bar]));
    const alignedBars = commonTimes.map((time) => byTime.get(time)).filter((bar): bar is PreparedBar => Boolean(bar));
    if (alignedBars.length !== commonTimes.length) continue;
    alignedBarsByAssetId.set(assetId, alignedBars);
    closesByAssetId.set(
      assetId,
      alignedBars.map((bar) => bar.close),
    );
  }

  return {
    assetIds: Array.from(closesByAssetId.keys()),
    commonTimes,
    alignedBarsByAssetId,
    closesByAssetId,
  };
}

function buildPortfolioSignals(universe: PortfolioUniverse): Map<string, PortfolioNameSignal> {
  const signals = new Map<string, PortfolioNameSignal>();
  for (const assetId of universe.assetIds) {
    const closes = universe.closesByAssetId.get(assetId) ?? [];
    const sma50 = smaSeries(closes, 50);
    const sma200 = smaSeries(closes, 200);
    const macd = macdSeries(closes);
    const inMarket = closes.map((close, index) => {
      const trend = sma50[index];
      const macdLine = macd.line[index];
      const macdSignal = macd.signal[index];
      return (
        trend != null &&
        macdLine != null &&
        macdSignal != null &&
        close > trend &&
        macdLine > macdSignal
      );
    });
    const last = closes.at(-1) ?? 0;
    const currentSma50 = lastDefined(sma50) ?? last;
    const currentSma200 = lastDefined(sma200) ?? currentSma50;
    const currentMacd = lastDefined(macd.line) ?? 0;
    const currentSignal = lastDefined(macd.signal) ?? 0;
    const bullish = last > currentSma50 && currentSma50 >= currentSma200 && currentMacd >= currentSignal;
    const cautious = last < currentSma50 && currentMacd < currentSignal;
    const stance = bullish ? 'bullish' : cautious ? 'cautious' : 'neutral';
    signals.set(assetId, {
      inMarket,
      stance,
      score: stance === 'bullish' ? 1 : stance === 'neutral' ? 0.5 : 0.25,
      note: `Task 4 projected signal: ${stance}`,
    });
  }
  return signals;
}

function portfolioReadings(
  universe: PortfolioUniverse,
  signals: ReadonlyMap<string, PortfolioNameSignal>,
): PortfolioReadings {
  const rets = new Map<string, number[]>();
  const vols: number[] = [];
  for (const assetId of universe.assetIds) {
    const returns = dailyReturnsFromCloses(universe.closesByAssetId.get(assetId) ?? []).slice(-63);
    rets.set(assetId, returns);
    const vol = annualisedVolFromReturns(returns);
    if (vol > 0) vols.push(vol);
  }

  const correlations: number[] = [];
  for (let i = 0; i < universe.assetIds.length; i++) {
    for (let j = i + 1; j < universe.assetIds.length; j++) {
      const a = universe.assetIds[i]!;
      const b = universe.assetIds[j]!;
      const volA = annualisedVolFromReturns(rets.get(a) ?? []);
      const volB = annualisedVolFromReturns(rets.get(b) ?? []);
      if (volA > 1e-9 && volB > 1e-9) {
        correlations.push(covarianceFromReturns(rets.get(a) ?? [], rets.get(b) ?? []) / (volA * volB));
      }
    }
  }

  const nLongNow = universe.assetIds.filter((assetId) => signals.get(assetId)?.inMarket.at(-1)).length;
  const meanVol = vols.length > 0 ? vols.reduce((sum, value) => sum + value, 0) / vols.length : 0;
  return {
    nNames: universe.assetIds.length,
    nLongNow,
    breadthPctLongNow: universe.assetIds.length > 0 ? round((nLongNow / universe.assetIds.length) * 100, 1) : 0,
    meanAnnVolPct: round(meanVol * 100, 1),
    minAnnVolPct: round((vols.length > 0 ? Math.min(...vols) : 0) * 100, 1),
    maxAnnVolPct: round((vols.length > 0 ? Math.max(...vols) : 0) * 100, 1),
    meanPairwiseCorrelation:
      correlations.length > 0
        ? round(correlations.reduce((sum, value) => sum + value, 0) / correlations.length, 2)
        : 0,
  };
}

function choosePortfolioSpec(readings: PortfolioReadings): PortfolioSpec {
  const volDispersion = readings.maxAnnVolPct - readings.minAnnVolPct;
  const method: PortfolioMethod =
    volDispersion >= 20 && readings.meanPairwiseCorrelation >= 0.55
      ? 'risk_parity'
      : volDispersion >= 15
        ? 'inverse_vol'
        : readings.breadthPctLongNow <= 35
          ? 'signal_proportional'
          : 'equal_weight';
  const minWeight = readings.nNames > 0 ? 1 / readings.nNames : 1;
  return {
    method,
    maxWeight: round(Math.max(minWeight, readings.breadthPctLongNow <= 35 ? 0.35 : 0.45), 2),
    grossCap: readings.breadthPctLongNow <= 35 ? 0.65 : readings.meanAnnVolPct >= 55 ? 0.8 : 1,
    targetVolPct:
      readings.meanAnnVolPct >= 55 ? 15 : readings.meanPairwiseCorrelation >= 0.7 ? 18 : 0,
    rebalance: readings.breadthPctLongNow <= 35 ? 'weekly' : 'monthly',
    volLookbackDays: 63,
    stance:
      readings.breadthPctLongNow >= 60
        ? 'bullish'
        : readings.breadthPctLongNow <= 25
          ? 'cautious'
          : 'neutral',
  };
}

function runPortfolioSizingBacktest(input: {
  universe: PortfolioUniverse;
  signals: ReadonlyMap<string, PortfolioNameSignal>;
  spec: PortfolioSpec;
}): PortfolioBacktestResult {
  const names = input.universe.assetIds;
  const nDays = input.universe.commonTimes.length;
  const returnsByAssetId = new Map(
    names.map((assetId) => [
      assetId,
      dailyReturnsFromCloses(input.universe.closesByAssetId.get(assetId) ?? []),
    ]),
  );
  const step = PORTFOLIO_REBALANCE_STEP[input.spec.rebalance];
  const warmup = Math.min(Math.max(input.spec.volLookbackDays, step), Math.floor(nDays / 4));
  let cash = 1;
  let values = new Map(names.map((assetId) => [assetId, 0]));
  let benchmarkValues = new Map(names.map((assetId) => [assetId, 1 / names.length]));
  let nRebalances = 0;
  let turnoverTotal = 0;
  let investedDays = 0;
  let grossSum = 0;
  const weightSum = new Map(names.map((assetId) => [assetId, 0]));
  const latestWeight = new Map(names.map((assetId) => [assetId, 0]));
  const strategyCurve: number[] = [];
  const benchmarkCurve: number[] = [];
  const cost = 10 / 10_000;

  for (let i = 0; i < nDays; i++) {
    if (i > 0) {
      for (const assetId of names) {
        const ret = returnsByAssetId.get(assetId)?.[i] ?? 0;
        values.set(assetId, (values.get(assetId) ?? 0) * (1 + ret));
        benchmarkValues.set(assetId, (benchmarkValues.get(assetId) ?? 0) * (1 + ret));
      }
    }

    let equity = cash + Array.from(values.values()).reduce((sum, value) => sum + value, 0);
    if (i >= warmup && (i - warmup) % step === 0 && equity > 0) {
      const longs = names.filter((assetId) => input.signals.get(assetId)?.inMarket[i]);
      const targetValues = new Map(names.map((assetId) => [assetId, 0]));

      if (longs.length > 0) {
        const vols = longs.map((assetId) =>
          annualisedVolFromReturns(
            (returnsByAssetId.get(assetId) ?? []).slice(Math.max(0, i - input.spec.volLookbackDays), i),
          ),
        );
        const cov = longs.map((a) =>
          longs.map((b) =>
            covarianceFromReturns(
              (returnsByAssetId.get(a) ?? []).slice(Math.max(0, i - input.spec.volLookbackDays), i),
              (returnsByAssetId.get(b) ?? []).slice(Math.max(0, i - input.spec.volLookbackDays), i),
            ),
          ),
        );
        const scores = longs.map((assetId) => input.signals.get(assetId)?.score ?? 0.5);
        const { weights } = targetPortfolioWeights({
          method: input.spec.method,
          vols,
          cov,
          scores,
          maxWeight: input.spec.maxWeight,
          grossCap: input.spec.grossCap,
          targetVolPct: input.spec.targetVolPct,
        });
        longs.forEach((assetId, index) => targetValues.set(assetId, (weights[index] ?? 0) * equity));
      }

      const turnover = names.reduce(
        (sum, assetId) => sum + Math.abs((targetValues.get(assetId) ?? 0) - (values.get(assetId) ?? 0)),
        0,
      );
      turnoverTotal += turnover / equity;
      cash = equity - Array.from(targetValues.values()).reduce((sum, value) => sum + value, 0) - turnover * cost;
      values = targetValues;
      nRebalances++;
      equity = cash + Array.from(values.values()).reduce((sum, value) => sum + value, 0);
      for (const assetId of names) {
        latestWeight.set(assetId, equity > 0 ? ((values.get(assetId) ?? 0) / equity) * 100 : 0);
      }
    }

    equity = cash + Array.from(values.values()).reduce((sum, value) => sum + value, 0);
    const invested = Array.from(values.values()).reduce((sum, value) => sum + value, 0);
    if (invested > 1e-9 && equity > 0) {
      investedDays++;
      grossSum += invested / equity;
      for (const assetId of names) {
        weightSum.set(assetId, (weightSum.get(assetId) ?? 0) + ((values.get(assetId) ?? 0) / equity) * 100);
      }
    }
    strategyCurve.push(round(equity, 6));
    benchmarkCurve.push(round(Array.from(benchmarkValues.values()).reduce((sum, value) => sum + value, 0), 6));
  }

  const final = strategyCurve.at(-1) ?? 1;
  const benchmark = benchmarkCurve.at(-1) ?? 1;
  let peak = strategyCurve[0] ?? 1;
  let maxDrawdown = 0;
  for (const point of strategyCurve) {
    peak = Math.max(peak, point);
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, point / peak - 1);
  }
  const totalReturnPct = (final - 1) * 100;
  const benchmarkReturnPct = (benchmark - 1) * 100;
  const days =
    ((input.universe.commonTimes.at(-1) ?? 0) - (input.universe.commonTimes[0] ?? 0)) / 86_400 || 1;
  const years = days / 365;
  const avgWeightPctByAssetId = new Map(
    names.map((assetId) => [
      assetId,
      round((weightSum.get(assetId) ?? 0) / Math.max(1, investedDays), 2),
    ]),
  );

  return {
    summary: {
      totalReturnPct: round(totalReturnPct),
      benchmarkReturnPct: round(benchmarkReturnPct),
      excessReturnPct: round(totalReturnPct - benchmarkReturnPct),
      maxDrawdownPct: round(maxDrawdown * 100),
      nTrades: nRebalances,
      exposurePct: round((grossSum / Math.max(1, investedDays)) * 100, 1),
    },
    avgWeightPctByAssetId,
    latestWeightPctByAssetId: latestWeight,
    longAsOfByAssetId: new Map(names.map((assetId) => [assetId, input.signals.get(assetId)?.inMarket.at(-1) ?? false])),
    nRebalances,
    turnoverAnnualPct: round(turnoverTotal / Math.max(years, 1e-9) * 100, 1),
  };
}

function portfolioRiskSizerOpinion(input: {
  analyst: AiAnalystCatalogItem;
  assetId: string;
  idea: string;
  barsByAssetId: ReadonlyMap<string, readonly Bar[]>;
}): AnalystOpinion {
  const universe = buildPortfolioUniverse({
    assetId: input.assetId,
    barsByAssetId: input.barsByAssetId,
  });
  const signals = buildPortfolioSignals(universe);
  const readings = portfolioReadings(universe, signals);
  const spec = choosePortfolioSpec(readings);
  const portfolio = runPortfolioSizingBacktest({ universe, signals, spec });
  const targetWeight = portfolio.latestWeightPctByAssetId.get(input.assetId) ?? 0;
  const avgWeight = portfolio.avgWeightPctByAssetId.get(input.assetId) ?? 0;
  const longAsOf = portfolio.longAsOfByAssetId.get(input.assetId) ?? false;
  const targetBars = universe.alignedBarsByAssetId.get(input.assetId);
  if (!targetBars) throw new Error(`No aligned portfolio bars for ${input.assetId}.`);
  const indicators = baseIndicatorsFromBars(targetBars);
  const last = targetBars.at(-1)!.close;
  const verdict: AnalystVerdict =
    longAsOf && targetWeight >= Math.max(5, 100 / universe.assetIds.length / 2)
      ? 'support'
      : !longAsOf && targetWeight <= 0.1
        ? 'reject'
        : 'challenge';
  const confidence =
    verdict === 'support' ? 0.72 : verdict === 'reject' ? 0.67 : 0.59 + Math.min(0.08, targetWeight / 100);

  return {
    analystId: input.analyst.id,
    analystName: input.analyst.name,
    originTask: input.analyst.originTask,
    verdict,
    confidence: round(confidence, 2),
    thesis:
      verdict === 'support'
        ? `${input.assetId} earns ${targetWeight.toFixed(1)}% target weight in a ${universe.assetIds.length}-asset Hunch portfolio using ${spec.method} sizing, so the idea has portfolio-risk support.`
        : verdict === 'reject'
          ? `${input.assetId} does not earn current portfolio allocation under the Task 10 sizing policy; its projected Task 4 leg is flat while breadth is ${readings.breadthPctLongNow.toFixed(1)}%.`
          : `${input.assetId} is not a clear portfolio allocation yet: current target weight is ${targetWeight.toFixed(1)}% and average backtest weight is ${avgWeight.toFixed(1)}%.`,
    whyNow: `Task 10 sizes only the names whose Task 4 technical legs are long, then applies caps and optional vol targeting. Current breadth is ${readings.nLongNow}/${readings.nNames}, mean vol is ${readings.meanAnnVolPct.toFixed(1)}%, and mean pairwise correlation is ${readings.meanPairwiseCorrelation.toFixed(2)}.`,
    setupEntry:
      verdict === 'support'
        ? `Let the idea proceed only while ${input.assetId} keeps a positive Task 10 target weight at the next ${spec.rebalance} rebalance.`
        : `Wait for ${input.assetId} to regain a positive target weight before turning the outside idea into one Proposal.`,
    riskProtection: `Respect the sizing policy: max single-name weight ${fmtPct(spec.maxWeight * 100)}, gross cap ${fmtPct(spec.grossCap * 100)}, ${spec.targetVolPct > 0 ? `target vol ${spec.targetVolPct.toFixed(0)}%` : 'no active vol target'}, and normal stop protection near ${fmtUsd(last * 0.92)}.`,
    invalidation:
      verdict === 'support'
        ? `The supportive portfolio read is wrong if ${input.assetId} drops out of the long set or the sizing policy cuts its weight to zero.`
        : `The cautious read is wrong if the next rebalance assigns ${input.assetId} a positive risk-budget weight.`,
    evidence: [
      `Task 10 sizing policy: method=${spec.method}, max_weight=${fmtPct(spec.maxWeight * 100)}, gross_cap=${fmtPct(spec.grossCap * 100)}, rebalance=${spec.rebalance}.`,
      `Current weight=${targetWeight.toFixed(1)}%, average backtest weight=${avgWeight.toFixed(1)}%, long_as_of=${longAsOf ? 'yes' : 'no'}.`,
      `Portfolio backtest: strategy ${fmtPct(portfolio.summary.totalReturnPct)} vs equal-weight basket ${fmtPct(portfolio.summary.benchmarkReturnPct)}, turnover annualized ${portfolio.turnoverAnnualPct.toFixed(1)}%.`,
      `Original Grill Idea considered: "${input.idea.trim()}".`,
    ],
    backtest: portfolio.summary,
    sourceFiles: [
      'Fundamental_analysis_agent/task10_portfolio/pipeline/signals.py',
      'Fundamental_analysis_agent/task10_portfolio/pipeline/sizing.py',
      'Fundamental_analysis_agent/task10_portfolio/pipeline/backtest.py',
      'Fundamental_analysis_agent/prompts/task10_portfolio/portfolio_author.md',
      'Fundamental_analysis_agent/task10_portfolio/tests/test_sizing.py',
    ],
    indicators,
  };
}

interface PairSpec {
  formationWindow: number;
  zEntry: number;
  zExit: number;
  stopZ: number;
  maxHoldingDays: number;
  stance: 'bullish' | 'neutral' | 'cautious';
}

interface PairReadings {
  spreadRegime: 'stretched' | 'diverging' | 'tight';
  returnCorrelation: number;
  currentZScore: number;
  hedgeRatioBeta: number;
  halfLifeDays: number;
}

interface PairSeries {
  commonTimes: number[];
  closesA: number[];
  closesB: number[];
  barsA: PreparedBar[];
}

function olsBeta(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 1;
  const x = xs.slice(-n);
  const y = ys.slice(-n);
  const meanX = x.reduce((sum, value) => sum + value, 0) / n;
  const meanY = y.reduce((sum, value) => sum + value, 0) / n;
  const variance = x.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
  if (variance <= 1e-12) return 1;
  return x.reduce((sum, value, index) => sum + (value - meanX) * ((y[index] ?? 0) - meanY), 0) / variance;
}

function pairHalfLife(spread: readonly number[]): number {
  if (spread.length < 4) return 0;
  const prev = spread.slice(0, -1);
  const delta = spread.slice(1).map((value, index) => value - (spread[index] ?? value));
  const beta = olsBeta(prev, delta);
  if (beta >= 0 || 1 + beta <= 0) return 0;
  return -Math.log(2) / Math.log(1 + beta);
}

function computePairZSeries(
  closesA: readonly number[],
  closesB: readonly number[],
  window: number,
): { z: (number | null)[]; beta: (number | null)[] } {
  const logA = closesA.map((close) => (close > 0 ? Math.log(close) : 0));
  const logB = closesB.map((close) => (close > 0 ? Math.log(close) : 0));
  const z: (number | null)[] = Array.from({ length: logA.length }, () => null);
  const beta: (number | null)[] = Array.from({ length: logA.length }, () => null);

  for (let i = 0; i < logA.length; i++) {
    if (i < window) continue;
    const xs = logB.slice(i - window, i);
    const ys = logA.slice(i - window, i);
    const hedge = olsBeta(xs, ys);
    const spreadWindow = ys.map((value, index) => value - hedge * (xs[index] ?? 0));
    const mean = spreadWindow.reduce((sum, value) => sum + value, 0) / spreadWindow.length;
    const variance =
      spreadWindow.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      Math.max(1, spreadWindow.length - 1);
    const stdev = Math.sqrt(variance);
    if (stdev <= 1e-9) continue;
    z[i] = (logA[i]! - hedge * logB[i]! - mean) / stdev;
    beta[i] = hedge;
  }

  return { z, beta };
}

function pairReadings(
  closesA: readonly number[],
  closesB: readonly number[],
  z: readonly (number | null)[],
  beta: readonly (number | null)[],
  window: number,
): PairReadings {
  const returnsA = dailyReturnsFromCloses(closesA).slice(1);
  const returnsB = dailyReturnsFromCloses(closesB).slice(1);
  const n = Math.min(returnsA.length, returnsB.length);
  const a = returnsA.slice(-n);
  const b = returnsB.slice(-n);
  const volA = annualisedVolFromReturns(a);
  const volB = annualisedVolFromReturns(b);
  const correlation = volA > 1e-9 && volB > 1e-9 ? covarianceFromReturns(a, b) / (volA * volB) : 0;
  const currentZ = lastDefined(z) ?? 0;
  const currentBeta = lastDefined(beta) ?? 1;
  const logA = closesA.slice(-window).map((close) => (close > 0 ? Math.log(close) : 0));
  const logB = closesB.slice(-window).map((close) => (close > 0 ? Math.log(close) : 0));
  const halfLife = pairHalfLife(logA.map((value, index) => value - currentBeta * (logB[index] ?? 0)));
  const absZ = Math.abs(currentZ);
  return {
    spreadRegime: absZ >= 2 ? 'stretched' : absZ >= 1 ? 'diverging' : 'tight',
    returnCorrelation: round(correlation, 2),
    currentZScore: round(currentZ, 2),
    hedgeRatioBeta: round(currentBeta, 3),
    halfLifeDays: halfLife > 0 && halfLife < 10_000 ? round(halfLife, 1) : 0,
  };
}

function choosePairSpec(readings: PairReadings): PairSpec {
  const reliable = readings.returnCorrelation >= 0.5 && readings.halfLifeDays > 0 && readings.halfLifeDays <= 90;
  const formationWindow = reliable
    ? Math.max(30, Math.min(126, Math.round(readings.halfLifeDays * 3)))
    : 63;
  return {
    formationWindow,
    zEntry: reliable && readings.halfLifeDays <= 20 ? 1.5 : reliable ? 2 : 2.5,
    zExit: reliable ? 0.5 : 0.25,
    stopZ: reliable ? 4 : 4.5,
    maxHoldingDays: reliable ? 60 : 30,
    stance:
      !reliable || readings.currentZScore > 1
        ? 'cautious'
        : readings.currentZScore < -1
          ? 'bullish'
          : 'neutral',
  };
}

function alignPairSeries(input: {
  assetBars: readonly PreparedBar[];
  pairBars: readonly PreparedBar[];
}): PairSeries {
  const assetTimes = new Set(input.assetBars.map((bar) => bar.time));
  const pairTimes = new Set(input.pairBars.map((bar) => bar.time));
  const commonTimes = Array.from(assetTimes)
    .filter((time) => pairTimes.has(time))
    .sort((a, b) => a - b)
    .slice(-756);
  if (commonTimes.length < 250) {
    throw new Error(`Only ${commonTimes.length} overlapping pair bars; need at least 250.`);
  }
  const assetByTime = new Map(input.assetBars.map((bar) => [bar.time, bar]));
  const pairByTime = new Map(input.pairBars.map((bar) => [bar.time, bar]));
  const barsA = commonTimes.map((time) => assetByTime.get(time)).filter((bar): bar is PreparedBar => Boolean(bar));
  const barsB = commonTimes.map((time) => pairByTime.get(time)).filter((bar): bar is PreparedBar => Boolean(bar));
  if (barsA.length !== commonTimes.length || barsB.length !== commonTimes.length) {
    throw new Error('Pair bars could not be aligned.');
  }
  return {
    commonTimes,
    barsA,
    closesA: barsA.map((bar) => bar.close),
    closesB: barsB.map((bar) => bar.close),
  };
}

function runPairsBacktest(input: {
  pair: PairSeries;
  spec: PairSpec;
  transactionCostBps?: number;
}): AnalystBacktestSummary {
  const n = input.pair.commonTimes.length;
  const { z } = computePairZSeries(input.pair.closesA, input.pair.closesB, input.spec.formationWindow);
  const returnsA = dailyReturnsFromCloses(input.pair.closesA);
  const returnsB = dailyReturnsFromCloses(input.pair.closesB);
  const cost = (input.transactionCostBps ?? 10) / 10_000;
  let equity = 1;
  let position = 0;
  let held = 0;
  let openedTrades = 0;
  let closedTrades = 0;
  let inMarketDays = 0;
  const strategy: number[] = [];
  const benchmark: number[] = [];
  const entryA = input.pair.closesA[0] ?? 1;
  const entryB = input.pair.closesB[0] ?? 1;

  for (let i = 0; i < n; i++) {
    if (i > 0 && position !== 0) {
      equity *= 1 + position * 0.5 * ((returnsA[i] ?? 0) - (returnsB[i] ?? 0));
      held++;
      inMarketDays++;
    }

    const currentZ = z[i];
    let target = position;
    if (position === 0) {
      if (currentZ != null && currentZ <= -input.spec.zEntry) target = 1;
      else if (currentZ != null && currentZ >= input.spec.zEntry) target = -1;
    } else {
      const reverted = currentZ != null && Math.abs(currentZ) <= input.spec.zExit;
      const stopped = currentZ != null && Math.abs(currentZ) >= input.spec.stopZ;
      if (reverted || stopped || held >= input.spec.maxHoldingDays) target = 0;
    }

    if (target !== position) {
      equity *= 1 - cost * Math.abs(target - position);
      if (position === 0 && target !== 0) {
        openedTrades++;
        held = 0;
      } else if (position !== 0 && target === 0) {
        closedTrades++;
      }
      position = target;
    }

    strategy.push(round(equity, 6));
    benchmark.push(
      entryA > 0 && entryB > 0
        ? round(0.5 * (input.pair.closesA[i]! / entryA) + 0.5 * (input.pair.closesB[i]! / entryB), 6)
        : 1,
    );
  }

  const final = strategy.at(-1) ?? 1;
  const basket = benchmark.at(-1) ?? 1;
  let peak = strategy[0] ?? 1;
  let maxDrawdown = 0;
  for (const point of strategy) {
    peak = Math.max(peak, point);
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, point / peak - 1);
  }
  const totalReturnPct = (final - 1) * 100;
  const benchmarkReturnPct = (basket - 1) * 100;
  return {
    totalReturnPct: round(totalReturnPct),
    benchmarkReturnPct: round(benchmarkReturnPct),
    excessReturnPct: round(totalReturnPct - benchmarkReturnPct),
    maxDrawdownPct: round(maxDrawdown * 100),
    nTrades: closedTrades || openedTrades,
    exposurePct: round((inMarketDays / Math.max(1, n)) * 100, 1),
  };
}

function pairsTradingOpinion(input: {
  analyst: AiAnalystCatalogItem;
  assetId: string;
  idea: string;
  bars: readonly PreparedBar[];
  pairAssetId: string;
  pairBars: readonly PreparedBar[];
}): AnalystOpinion {
  const pair = alignPairSeries({ assetBars: input.bars, pairBars: input.pairBars });
  const initial = computePairZSeries(pair.closesA, pair.closesB, 63);
  let readings = pairReadings(pair.closesA, pair.closesB, initial.z, initial.beta, 63);
  const spec = choosePairSpec(readings);
  const chosen = spec.formationWindow === 63 ? initial : computePairZSeries(pair.closesA, pair.closesB, spec.formationWindow);
  if (spec.formationWindow !== 63) {
    readings = pairReadings(pair.closesA, pair.closesB, chosen.z, chosen.beta, spec.formationWindow);
  }
  const backtest = runPairsBacktest({ pair, spec });
  const indicators = baseIndicatorsFromBars(pair.barsA);
  const last = pair.barsA.at(-1)!.close;
  const reliable = readings.returnCorrelation >= 0.5 && readings.halfLifeDays > 0 && readings.halfLifeDays <= 90;
  const verdict: AnalystVerdict =
    reliable && readings.currentZScore <= -spec.zEntry
      ? 'support'
      : readings.currentZScore >= spec.zEntry
        ? 'reject'
        : 'challenge';
  const confidence =
    verdict === 'support'
      ? 0.69
      : verdict === 'reject'
        ? 0.68
        : reliable
          ? 0.6
          : 0.54;

  return {
    analystId: input.analyst.id,
    analystName: input.analyst.name,
    originTask: input.analyst.originTask,
    verdict,
    confidence,
    thesis:
      verdict === 'support'
        ? `${input.assetId} is cheap versus ${input.pairAssetId} on the Task 23 pair spread: z-score ${readings.currentZScore.toFixed(2)}, beta ${readings.hedgeRatioBeta.toFixed(2)}, correlation ${readings.returnCorrelation.toFixed(2)}.`
        : verdict === 'reject'
          ? `${input.assetId} is rich versus ${input.pairAssetId} on the Task 23 pair spread: z-score ${readings.currentZScore.toFixed(2)}, which argues against a fresh long-only BUY.`
          : `${input.assetId}/${input.pairAssetId} is not stretched enough for a clean pair signal. Spread z-score is ${readings.currentZScore.toFixed(2)} with correlation ${readings.returnCorrelation.toFixed(2)}.`,
    whyNow: `Task 23 estimates beta and z-score on trailing windows only. Current spread regime is ${readings.spreadRegime}, half-life is ${readings.halfLifeDays.toFixed(1)} days, and the selected entry threshold is ${spec.zEntry.toFixed(1)} standard deviations.`,
    setupEntry:
      verdict === 'support'
        ? `Use the long idea only while the spread remains below -${spec.zEntry.toFixed(1)} z; the pure Task 23 trade would be long ${input.assetId} and short ${input.pairAssetId}.`
        : verdict === 'reject'
          ? `Do not create a long-only Proposal while the pair says ${input.assetId} is rich versus ${input.pairAssetId}.`
          : `Wait for a spread stretch beyond +/-${spec.zEntry.toFixed(1)} z before treating this as pair-confirmed.`,
    riskProtection: `The source agent is market-neutral and models a short leg, borrow risk, relationship breaks, and stop_z ${spec.stopZ.toFixed(1)}. Hunch can only create one long Proposal here, so treat this as relative timing evidence and protect below ${fmtUsd(last * 0.91)}.`,
    invalidation:
      verdict === 'support'
        ? `The supportive pair read is wrong if the spread keeps widening past stop_z ${spec.stopZ.toFixed(1)} or correlation breaks below 0.5.`
        : `The cautious read is wrong if ${input.assetId} becomes cheap versus ${input.pairAssetId} with a reliable mean-reversion half-life.`,
    evidence: [
      `Task 23 pair readings: pair=${input.assetId}/${input.pairAssetId}, z=${readings.currentZScore.toFixed(2)}, beta=${readings.hedgeRatioBeta.toFixed(3)}, corr=${readings.returnCorrelation.toFixed(2)}, half_life=${readings.halfLifeDays.toFixed(1)}d.`,
      `Pair rule: formation_window=${spec.formationWindow}, z_entry=${spec.zEntry.toFixed(1)}, z_exit=${spec.zExit.toFixed(1)}, stop_z=${spec.stopZ.toFixed(1)}, max_holding_days=${spec.maxHoldingDays}.`,
      `Market-neutral backtest: strategy ${fmtPct(backtest.totalReturnPct)} vs 50/50 basket ${fmtPct(backtest.benchmarkReturnPct)}.`,
      `Original Grill Idea considered: "${input.idea.trim()}".`,
    ],
    backtest,
    sourceFiles: [
      'Fundamental_analysis_agent/task23_pairs/pipeline/pairs.py',
      'Fundamental_analysis_agent/task23_pairs/pipeline/orchestrator.py',
      'Fundamental_analysis_agent/prompts/task23_pairs/pairs_author.md',
      'Fundamental_analysis_agent/task23_pairs/tests/test_pairs.py',
    ],
    indicators,
  };
}

type MeihuaTrigramName =
  | 'heaven'
  | 'lake'
  | 'fire'
  | 'thunder'
  | 'wind'
  | 'water'
  | 'mountain'
  | 'earth';
type MeihuaElement = 'metal' | 'fire' | 'wood' | 'water' | 'earth';

interface MeihuaDivination {
  upper: MeihuaTrigramName;
  lower: MeihuaTrigramName;
  moving: number;
  hexagram: number;
  changedHexagram: number;
  ti: MeihuaTrigramName;
  yong: MeihuaTrigramName;
  tiElement: MeihuaElement;
  yongElement: MeihuaElement;
  relation: string;
  auspicious: boolean;
  tiIsYang: boolean;
}

const MEIHUA_ORDER: MeihuaTrigramName[] = [
  'heaven',
  'lake',
  'fire',
  'thunder',
  'wind',
  'water',
  'mountain',
  'earth',
];

const MEIHUA_TRIGRAMS: Record<
  MeihuaTrigramName,
  { lines: readonly [number, number, number]; element: MeihuaElement; yang: boolean }
> = {
  heaven: { lines: [1, 1, 1], element: 'metal', yang: true },
  lake: { lines: [1, 1, 0], element: 'metal', yang: false },
  fire: { lines: [1, 0, 1], element: 'fire', yang: false },
  thunder: { lines: [1, 0, 0], element: 'wood', yang: true },
  wind: { lines: [0, 1, 1], element: 'wood', yang: false },
  water: { lines: [0, 1, 0], element: 'water', yang: true },
  mountain: { lines: [0, 0, 1], element: 'earth', yang: true },
  earth: { lines: [0, 0, 0], element: 'earth', yang: false },
};

const MEIHUA_KING_WEN: Record<MeihuaTrigramName, readonly number[]> = {
  heaven: [1, 43, 14, 34, 9, 5, 26, 11],
  lake: [10, 58, 38, 54, 61, 60, 41, 19],
  fire: [13, 49, 30, 21, 37, 63, 22, 36],
  thunder: [25, 17, 55, 51, 42, 3, 27, 24],
  wind: [44, 28, 50, 32, 57, 48, 18, 46],
  water: [6, 47, 64, 40, 59, 29, 4, 7],
  mountain: [33, 31, 56, 62, 53, 39, 52, 15],
  earth: [12, 45, 35, 16, 20, 8, 23, 2],
};

const MEIHUA_GENERATES: Record<MeihuaElement, MeihuaElement> = {
  metal: 'water',
  water: 'wood',
  wood: 'fire',
  fire: 'earth',
  earth: 'metal',
};

const MEIHUA_CONTROLS: Record<MeihuaElement, MeihuaElement> = {
  metal: 'wood',
  wood: 'earth',
  earth: 'water',
  water: 'fire',
  fire: 'metal',
};

function dayOfYearUtc(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86_400_000) + 1;
}

function meihuaModIndex(value: number, size: number): number {
  const remainder = ((value % size) + size) % size;
  return remainder === 0 ? size - 1 : remainder - 1;
}

function meihuaLines(upper: MeihuaTrigramName, lower: MeihuaTrigramName): number[] {
  return [...MEIHUA_TRIGRAMS[lower].lines, ...MEIHUA_TRIGRAMS[upper].lines];
}

function meihuaTrigramByLines(lines: readonly number[]): MeihuaTrigramName {
  const found = MEIHUA_ORDER.find((name) =>
    MEIHUA_TRIGRAMS[name].lines.every((line, index) => line === lines[index]),
  );
  if (!found) throw new Error(`No Meihua trigram for lines: ${lines.join('')}`);
  return found;
}

function meihuaKingWen(upper: MeihuaTrigramName, lower: MeihuaTrigramName): number {
  return MEIHUA_KING_WEN[lower][MEIHUA_ORDER.indexOf(upper)] ?? 1;
}

function meihuaRelation(ti: MeihuaTrigramName, yong: MeihuaTrigramName): {
  label: string;
  auspicious: boolean;
} {
  const tiElement = MEIHUA_TRIGRAMS[ti].element;
  const yongElement = MEIHUA_TRIGRAMS[yong].element;
  if (tiElement === yongElement) return { label: 'same-element harmony', auspicious: true };
  if (MEIHUA_GENERATES[yongElement] === tiElement) {
    return { label: 'use generates body', auspicious: true };
  }
  if (MEIHUA_CONTROLS[tiElement] === yongElement) {
    return { label: 'body controls use', auspicious: true };
  }
  if (MEIHUA_GENERATES[tiElement] === yongElement) {
    return { label: 'body drains into use', auspicious: false };
  }
  if (MEIHUA_CONTROLS[yongElement] === tiElement) {
    return { label: 'use controls body', auspicious: false };
  }
  return { label: 'neutral relation', auspicious: false };
}

function meihuaDivine(date: Date, seed = 0): MeihuaDivination {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const doy = dayOfYearUtc(date);
  const upper = MEIHUA_ORDER[meihuaModIndex(year + month + day + seed, 8)]!;
  const lower = MEIHUA_ORDER[meihuaModIndex(year + month + day + doy + seed, 8)]!;
  const moving = ((year + month + day + doy + seed) % 6) || 6;
  const lines = meihuaLines(upper, lower);
  const changed = [...lines];
  changed[moving - 1] = changed[moving - 1] === 1 ? 0 : 1;
  const changedLower = meihuaTrigramByLines(changed.slice(0, 3));
  const changedUpper = meihuaTrigramByLines(changed.slice(3, 6));
  const yong = moving <= 3 ? lower : upper;
  const ti = moving <= 3 ? upper : lower;
  const relation = meihuaRelation(ti, yong);

  return {
    upper,
    lower,
    moving,
    hexagram: meihuaKingWen(upper, lower),
    changedHexagram: meihuaKingWen(changedUpper, changedLower),
    ti,
    yong,
    tiElement: MEIHUA_TRIGRAMS[ti].element,
    yongElement: MEIHUA_TRIGRAMS[yong].element,
    relation: relation.label,
    auspicious: relation.auspicious,
    tiIsYang: MEIHUA_TRIGRAMS[ti].yang,
  };
}

function meihuaNullControlOpinion(input: {
  analyst: AiAnalystCatalogItem;
  assetId: string;
  idea: string;
  bars: readonly PreparedBar[];
}): AnalystOpinion {
  const seed = 0;
  const current = meihuaDivine(barDate(input.bars.at(-1)!), seed);
  const backtest = runLongFlatBacktest(
    input.bars,
    (index) => meihuaDivine(barDate(input.bars[index]!), seed).auspicious,
  );
  const indicators = baseIndicatorsFromBars(input.bars);
  const last = input.bars.at(-1)!.close;
  const signal = current.auspicious ? 'hold' : 'flat';

  return {
    analystId: input.analyst.id,
    analystName: input.analyst.name,
    originTask: input.analyst.originTask,
    verdict: 'challenge',
    confidence: 0.42,
    thesis: `Meihua is a control / placebo read, not economic evidence. The deterministic date seed maps the latest bar to hexagram ${current.hexagram} changing to ${current.changedHexagram}; its body/use relation is ${current.relation}, so the null signal says ${signal}.`,
    whyNow: `Task 26 exists to test false positives. Date plus seed ${seed} fixes upper=${current.upper}, lower=${current.lower}, moving_line=${current.moving}, body=${current.ti}/${current.tiElement}, and use=${current.yong}/${current.yongElement}.`,
    setupEntry: `Do not create a Proposal because this control agrees. Use it only as a warning that random timing rules can look persuasive after a backtest.`,
    riskProtection: `If this null-control backtest looks good, treat that as selection-bias risk. Keep real stop protection near ${fmtUsd(last * 0.92)} and require an economic analyst to support the trade.`,
    invalidation: `The control is not falsified by price. It is invalid as trade support by design; real analysts must supply the evidence.`,
    evidence: [
      `Task 26 null-control: seed=${seed}, entry_signal=ti_yong_auspicious, current_signal=${signal}.`,
      `Meihua backtest: strategy ${fmtPct(backtest.totalReturnPct)} vs buy-and-hold ${fmtPct(backtest.benchmarkReturnPct)}.`,
      `Source caveat preserved: a high Sharpe here means framework leakage or selection bias, not that the hexagram works.`,
      `Original Grill Idea considered: "${input.idea.trim()}".`,
    ],
    backtest,
    sourceFiles: [
      'Fundamental_analysis_agent/task26_meihua/pipeline/iching.py',
      'Fundamental_analysis_agent/task26_meihua/pipeline/signals.py',
      'Fundamental_analysis_agent/task26_meihua/eval/null_distribution.py',
      'Fundamental_analysis_agent/prompts/task26_meihua/meihua_author.md',
      'Fundamental_analysis_agent/task26_meihua/tests/test_meihua.py',
    ],
    indicators,
  };
}

function julianDayNumber(date: Date): number {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const a = Math.floor((14 - month) / 12);
  const yy = year + 4800 - a;
  const mm = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * mm + 2) / 5) +
    365 * yy +
    Math.floor(yy / 4) -
    Math.floor(yy / 100) +
    Math.floor(yy / 400) -
    32045
  );
}

const QIMEN_GATES = ['rest', 'life', 'harm', 'delusion', 'scenery', 'death', 'fear', 'open'];
const QIMEN_AUSPICIOUS = new Set([0, 1, 7]);
const QIMEN_ILL = new Set([2, 5, 6]);

function qimenIsYangDun(date: Date): boolean {
  const doy = dayOfYearUtc(date);
  return doy >= 356 || doy < 172;
}

function qimenJuNumber(date: Date): number {
  return (dayOfYearUtc(date) % 9) + 1;
}

function qimenActiveGate(date: Date): number {
  const ju = qimenJuNumber(date);
  const raw = julianDayNumber(date) + (qimenIsYangDun(date) ? ju : -ju);
  return ((raw % 8) + 8) % 8;
}

function qimenReadings(date: Date): {
  regime: 'auspicious_gate' | 'ill_gate' | 'neutral_gate';
  dun: 'yang' | 'yin';
  ju: number;
  activeGate: string;
  gateClass: 'auspicious' | 'ill' | 'neutral';
} {
  const gate = qimenActiveGate(date);
  const gateClass = QIMEN_AUSPICIOUS.has(gate)
    ? 'auspicious'
    : QIMEN_ILL.has(gate)
      ? 'ill'
      : 'neutral';
  return {
    regime:
      gateClass === 'auspicious'
        ? 'auspicious_gate'
        : gateClass === 'ill'
          ? 'ill_gate'
          : 'neutral_gate',
    dun: qimenIsYangDun(date) ? 'yang' : 'yin',
    ju: qimenJuNumber(date),
    activeGate: `${QIMEN_GATES[gate] ?? 'unknown'} gate`,
    gateClass,
  };
}

function qimenNullControlOpinion(input: {
  analyst: AiAnalystCatalogItem;
  assetId: string;
  idea: string;
  bars: readonly PreparedBar[];
}): AnalystOpinion {
  const current = qimenReadings(barDate(input.bars.at(-1)!));
  const backtest = runLongFlatBacktest(input.bars, (index) =>
    QIMEN_AUSPICIOUS.has(qimenActiveGate(barDate(input.bars[index]!))),
  );
  const indicators = baseIndicatorsFromBars(input.bars);
  const last = input.bars.at(-1)!.close;
  const signal = current.gateClass === 'auspicious' ? 'hold' : 'flat';

  return {
    analystId: input.analyst.id,
    analystName: input.analyst.name,
    originTask: input.analyst.originTask,
    verdict: 'challenge',
    confidence: 0.4,
    thesis: `Qimen is a control / placebo read, not economic evidence. The simplified deterministic gate is ${current.activeGate} (${current.gateClass}), so the null signal says ${signal}.`,
    whyNow: `Task 32 keys the gate to season and day only: dun=${current.dun}, ju=${current.ju}, gate=${current.activeGate}, class=${current.gateClass}.`,
    setupEntry: `Do not create a Proposal because this null gate is favorable. Use it to test whether a non-economic timing rule can appear persuasive.`,
    riskProtection: `If the Qimen control backtest looks good, suspect false-positive risk. Keep stop protection near ${fmtUsd(last * 0.92)} and require an economic analyst to support the trade.`,
    invalidation: `The control is not valid trade evidence. It only helps invalidate overconfidence in timing coincidences.`,
    evidence: [
      `Task 32 null-control: entry_signal=auspicious_gate, active_gate=${current.activeGate}, current_signal=${signal}.`,
      `Qimen backtest: strategy ${fmtPct(backtest.totalReturnPct)} vs buy-and-hold ${fmtPct(backtest.benchmarkReturnPct)}.`,
      `Source caveat preserved: simplified Qimen has no economic mechanism and the authored reading is ignored by execution.`,
      `Original Grill Idea considered: "${input.idea.trim()}".`,
    ],
    backtest,
    sourceFiles: [
      'Fundamental_analysis_agent/task32_qimen/pipeline/qimen.py',
      'Fundamental_analysis_agent/task32_qimen/pipeline/orchestrator.py',
      'Fundamental_analysis_agent/prompts/task32_qimen/qimen_author.md',
      'Fundamental_analysis_agent/task32_qimen/tests/test_qimen.py',
    ],
    indicators,
  };
}

const TAIYI_PALACES = ['qian', 'li', 'gen', 'zhen', 'xun', 'kun', 'dui', 'kan'];

function taiyiSolarYear(date: Date): number {
  return date.getUTCMonth() + 1 > 2 || (date.getUTCMonth() + 1 === 2 && date.getUTCDate() >= 4)
    ? date.getUTCFullYear()
    : date.getUTCFullYear() - 1;
}

function taiyiAccumulatedYears(date: Date): number {
  return 1_936_557 + taiyiSolarYear(date);
}

function taiyiPalace(date: Date): string {
  return `${TAIYI_PALACES[Math.floor(taiyiAccumulatedYears(date) / 24) % 8]} palace`;
}

function taiyiHostGuest(date: Date): { host: number; guest: number; hostWins: boolean } {
  const accumulated = taiyiAccumulatedYears(date);
  const solarYear = taiyiSolarYear(date);
  const host = (accumulated + solarYear) % 360;
  const guest = (accumulated * 3 + solarYear * 2 + 30) % 360;
  return { host, guest, hostWins: host >= guest };
}

function taiyiNullControlOpinion(input: {
  analyst: AiAnalystCatalogItem;
  assetId: string;
  idea: string;
  bars: readonly PreparedBar[];
}): AnalystOpinion {
  const currentDate = barDate(input.bars.at(-1)!);
  const counts = taiyiHostGuest(currentDate);
  const backtest = runLongFlatBacktest(input.bars, (index) =>
    taiyiHostGuest(barDate(input.bars[index]!)).hostWins,
  );
  const indicators = baseIndicatorsFromBars(input.bars);
  const last = input.bars.at(-1)!.close;
  const signal = counts.hostWins ? 'hold' : 'flat';

  return {
    analystId: input.analyst.id,
    analystName: input.analyst.name,
    originTask: input.analyst.originTask,
    verdict: 'challenge',
    confidence: 0.4,
    thesis: `Taiyi is a control / placebo read, not economic evidence. The deterministic host count is ${counts.host} versus guest count ${counts.guest}, so the null signal says ${signal}.`,
    whyNow: `Task 34 uses accumulated_years=${taiyiAccumulatedYears(currentDate)}, palace=${taiyiPalace(currentDate)}, and the host-versus-guest comparison to drive the rule.`,
    setupEntry: `Do not create a Proposal because this host/guest count agrees. It is useful only as a null timing benchmark.`,
    riskProtection: `If the Taiyi control backtest looks good, treat that as false-positive risk. Keep normal stop protection near ${fmtUsd(last * 0.92)} and require an economic analyst to support the trade.`,
    invalidation: `The control is invalid as trade support by design. It cannot make the outside idea disciplined without a real market lens.`,
    evidence: [
      `Task 34 null-control: entry_signal=host_prevails, host=${counts.host}, guest=${counts.guest}, current_signal=${signal}.`,
      `Taiyi backtest: strategy ${fmtPct(backtest.totalReturnPct)} vs buy-and-hold ${fmtPct(backtest.benchmarkReturnPct)}.`,
      `Source caveat preserved: simplified Taiyi has no economic mechanism and the authored reading is ignored by execution.`,
      `Original Grill Idea considered: "${input.idea.trim()}".`,
    ],
    backtest,
    sourceFiles: [
      'Fundamental_analysis_agent/task34_taiyi/pipeline/taiyi.py',
      'Fundamental_analysis_agent/task34_taiyi/pipeline/orchestrator.py',
      'Fundamental_analysis_agent/prompts/task34_taiyi/taiyi_author.md',
      'Fundamental_analysis_agent/task34_taiyi/tests/test_taiyi.py',
    ],
    indicators,
  };
}

function selectedAnalysts(ids: readonly string[] | undefined): AiAnalystCatalogItem[] {
  const source = ids && ids.length > 0 ? ids : DEFAULT_AI_TRADING_TEAM_IDS;
  const out: AiAnalystCatalogItem[] = [];
  for (const id of source) {
    const analyst = catalogById.get(id);
    if (!analyst || out.some((item) => item.id === id)) continue;
    out.push(analyst);
    if (out.length >= MAX_AI_TRADING_TEAM_SIZE) break;
  }
  return out.length > 0 ? out : AI_ANALYST_CATALOG.slice(0, 1);
}

export async function analyzeGrillIdea(input: AnalyzeGrillIdeaInput): Promise<GrillAnalysisResult> {
  const asset = getAssetById(input.assetId);
  if (!asset || !signalAssetIds.has(asset.assetId)) {
    throw new Error(`Unsupported Grill asset: ${input.assetId}`);
  }

  const idea = input.idea.trim();
  if (idea.length < 8) throw new Error('Grill Idea is too short.');

  const bars = prepareBars(input.barsByAssetId.get(asset.assetId) ?? []);
  if (bars.length < 60) {
    throw new Error(`Not enough Pyth bar history for ${asset.assetId}.`);
  }

  const opinions = selectedAnalysts(input.analystIds).map((analyst) => {
    if (analyst.id === 'technical') {
      return technicalOpinion({ analyst, assetId: asset.assetId, idea, bars });
    }
    if (analyst.id === 'relative_strength') {
      const benchmarkAssetId = chooseBenchmarkAssetId(asset.assetId);
      const benchmarkBars = prepareBars(input.barsByAssetId.get(benchmarkAssetId) ?? []);
      if (benchmarkBars.length < 60) {
        throw new Error(`Not enough benchmark bar history for ${benchmarkAssetId}.`);
      }
      return relativeStrengthOpinion({
        analyst,
        assetId: asset.assetId,
        idea,
        bars,
        benchmarkAssetId,
        benchmarkBars,
      });
    }
    if (analyst.id === 'volatility_regime') {
      return volatilityRegimeOpinion({ analyst, assetId: asset.assetId, idea, bars });
    }
    if (analyst.id === 'seasonality') {
      return seasonalityOpinion({ analyst, assetId: asset.assetId, idea, bars });
    }
    if (analyst.id === 'overnight_gap') {
      return overnightGapOpinion({ analyst, assetId: asset.assetId, idea, bars });
    }
    if (analyst.id === 'price_anomaly') {
      return priceAnomalyOpinion({ analyst, assetId: asset.assetId, idea, bars });
    }
    if (analyst.id === 'portfolio_risk_sizer') {
      return portfolioRiskSizerOpinion({
        analyst,
        assetId: asset.assetId,
        idea,
        barsByAssetId: input.barsByAssetId,
      });
    }
    if (analyst.id === 'cross_sectional_ranker') {
      return crossSectionalRankerOpinion({
        analyst,
        assetId: asset.assetId,
        idea,
        barsByAssetId: input.barsByAssetId,
      });
    }
    if (analyst.id === 'pairs_trading') {
      const pairAssetId = choosePairAssetId(asset.assetId);
      const pairBars = prepareBars(input.barsByAssetId.get(pairAssetId) ?? []);
      if (pairBars.length < 250) {
        throw new Error(`Not enough pair bar history for ${pairAssetId}.`);
      }
      return pairsTradingOpinion({
        analyst,
        assetId: asset.assetId,
        idea,
        bars,
        pairAssetId,
        pairBars,
      });
    }
    if (analyst.id === 'meihua_null_control') {
      return meihuaNullControlOpinion({ analyst, assetId: asset.assetId, idea, bars });
    }
    if (analyst.id === 'qimen_null_control') {
      return qimenNullControlOpinion({ analyst, assetId: asset.assetId, idea, bars });
    }
    if (analyst.id === 'taiyi_null_control') {
      return taiyiNullControlOpinion({ analyst, assetId: asset.assetId, idea, bars });
    }
    throw new Error(`Analyst ${analyst.id} is not adapted.`);
  });

  return {
    assetId: asset.assetId,
    idea,
    asOf: (input.now ?? new Date()).toISOString(),
    opinions,
  };
}

export function buildGrillProposalAnalysis(input: {
  result: GrillAnalysisResult;
  latestPrice?: number;
}): BaseMarketAnalysis | null {
  const lead = input.result.opinions.find((opinion) => opinion.verdict === 'support');
  if (!lead) return null;
  const priceAtAnalysis = input.latestPrice ?? lead.indicators.ma20;
  return {
    assetId: input.result.assetId,
    action: 'BUY',
    confidence: Math.max(0.7, Math.min(0.9, lead.confidence)),
    rationale: `[Grill] ${lead.thesis}`,
    what_changed: `Grill Idea: ${input.result.idea}`,
    why_this_trade: lead.setupEntry,
    priceAtAnalysis,
    suggestedTriggerPrice: priceAtAnalysis * 0.997,
    suggestedTakeProfitPrice: priceAtAnalysis * 1.04,
    suggestedStopLossPrice: priceAtAnalysis * 0.94,
    indicators: lead.indicators,
  };
}
