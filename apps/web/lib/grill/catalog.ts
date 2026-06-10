export const MAX_AI_TRADING_TEAM_SIZE = 6;

export interface AiAnalystCatalogItem {
  id: string;
  name: string;
  originTask: string;
  technique: string;
  dataNeeds: string;
  defaultSelected: boolean;
}

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
    technique:
      'Task 4 per-name signals, inverse-vol / risk-parity / signal-proportional sizing, caps, and vol targeting',
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
    technique:
      'Trailing OLS hedge ratio, spread z-score, mean-reversion thresholds, and market-neutral caveats',
    dataNeeds: 'Pyth OHLC bars for the selected asset and an auto-selected supported pair asset',
    defaultSelected: false,
  },
  {
    id: 'meihua_null_control',
    name: 'Meihua Null Control',
    originTask: 'T26 Meihua I Ching Control',
    technique: 'Deterministic date seed, body/use five-element relation, and null-control backtest',
    dataNeeds:
      'Pyth OHLC bars for the selected asset plus the bar date; no economic data by design',
    defaultSelected: false,
  },
  {
    id: 'bazi_null_control',
    name: 'Bazi Null Control',
    originTask: 'T27 Bazi Four Pillars Control',
    technique:
      'Four pillars, day-master strength, favourable elements, and favourable-year null backtest',
    dataNeeds:
      'Pyth OHLC bars for the selected asset; first visible bar is used as the Hunch natal anchor',
    defaultSelected: false,
  },
  {
    id: 'suimei_null_control',
    name: 'Suimei Null Control',
    originTask: 'T29 Shichu-Suimei Control',
    technique:
      'Japanese four pillars, twelve-fortune stage, tenchusatsu void pair, and null backtest',
    dataNeeds:
      'Pyth OHLC bars for the selected asset; first visible bar is used as the Hunch natal anchor',
    defaultSelected: false,
  },
  {
    id: 'tieban_null_control',
    name: 'Tieban Null Control',
    originTask: 'T31 Tieban Shenshu Control',
    technique: 'Taixuan counts over natal four pillars, verse-number verdict, and null backtest',
    dataNeeds:
      'Pyth OHLC bars for the selected asset; first visible bar is used as the Hunch natal anchor',
    defaultSelected: false,
  },
  {
    id: 'qimen_null_control',
    name: 'Qimen Null Control',
    originTask: 'T32 Qimen Dunjia Control',
    technique:
      'Simplified deterministic season/day gate, auspicious-gate rule, and null-control backtest',
    dataNeeds:
      'Pyth OHLC bars for the selected asset plus the bar date; no economic data by design',
    defaultSelected: false,
  },
  {
    id: 'liuren_null_control',
    name: 'Liuren Null Control',
    originTask: 'T33 Da Liu Ren Control',
    technique: 'Simplified yue jiang, useful-god branch relation, and null-control backtest',
    dataNeeds:
      'Pyth OHLC bars for the selected asset; first visible bar is used as the Hunch natal anchor',
    defaultSelected: false,
  },
  {
    id: 'taiyi_null_control',
    name: 'Taiyi Null Control',
    originTask: 'T34 Taiyi Shenshu Control',
    technique:
      'Deterministic accumulated-year host/guest count, host-prevails rule, and null-control backtest',
    dataNeeds:
      'Pyth OHLC bars for the selected asset plus the bar date; no economic data by design',
    defaultSelected: false,
  },
];

export const DEFAULT_AI_TRADING_TEAM_IDS = AI_ANALYST_CATALOG.filter(
  (analyst) => analyst.defaultSelected,
).map((analyst) => analyst.id);

const catalogById = new Map(AI_ANALYST_CATALOG.map((analyst) => [analyst.id, analyst]));

export function getAiAnalystById(id: string): AiAnalystCatalogItem | undefined {
  return catalogById.get(id);
}

function collectAiAnalysts(ids: readonly string[]): AiAnalystCatalogItem[] {
  const out: AiAnalystCatalogItem[] = [];
  for (const id of ids) {
    const analyst = getAiAnalystById(id);
    if (!analyst || out.some((item) => item.id === id)) continue;
    out.push(analyst);
    if (out.length >= MAX_AI_TRADING_TEAM_SIZE) break;
  }
  return out;
}

export function sanitizeAiTradingTeamIds(ids: readonly string[] | null | undefined): string[] {
  const source = ids && ids.length > 0 ? ids : DEFAULT_AI_TRADING_TEAM_IDS;
  const out = collectAiAnalysts(source).map((analyst) => analyst.id);
  return out.length > 0 ? out : [...DEFAULT_AI_TRADING_TEAM_IDS];
}

export function selectAiAnalysts(
  ids: readonly string[] | null | undefined,
): AiAnalystCatalogItem[] {
  const source = ids && ids.length > 0 ? ids : DEFAULT_AI_TRADING_TEAM_IDS;
  const out = collectAiAnalysts(source);
  return out.length > 0 ? out : AI_ANALYST_CATALOG.slice(0, 1);
}
