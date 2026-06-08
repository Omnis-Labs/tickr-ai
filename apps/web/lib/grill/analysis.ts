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
    id: 'cross_sectional_ranker',
    name: 'Cross-Sectional Ranker',
    originTask: 'T21 Ranker',
    technique: '12-1 momentum, low volatility, near-52w-high, or short-term reversal factor rank',
    dataNeeds: 'Pyth OHLC bars for the selected asset and a tradable Hunch universe',
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
    if (analyst.id === 'cross_sectional_ranker') {
      return crossSectionalRankerOpinion({
        analyst,
        assetId: asset.assetId,
        idea,
        barsByAssetId: input.barsByAssetId,
      });
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
