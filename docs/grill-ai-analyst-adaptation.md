# Grill AI Analyst adaptation

Source map: `Fundamental_analysis_agent/docs/AGENTS.md` plus each task folder. Hunch does not mount the Python app. It ports only agents whose real data path can produce a meaningful Analyst Opinion for one supported Hunch asset using Hunch-native TypeScript and Pyth bars now.

## Included analysts

| Hunch analyst          | Source agent          | Ported technique                                                                               | Source logic reused                                                                                                                                    |
| ---------------------- | --------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Technical Tape         | T4 Technical          | RSI, MACD, SMA trend, Donchian breakout, next-open long/flat backtest                          | `task4_technical/pipeline/indicators.py`, `task4_technical/pipeline/backtest.py`, `prompts/task4_technical/technical_author.md`, tests                 |
| Relative Strength      | T7 Relative Strength  | Asset versus benchmark RS line, RS SMA, RS prior high, relative returns, next-open backtest    | `task7_relative/pipeline/indicators.py`, `task7_relative/pipeline/backtest.py`, `prompts/task7_relative/relative_author.md`, tests                     |
| Volatility Regime      | T14 Volatility Regime | Trailing realized-vol percentile, calm/stressed regime, trend-and-calm long/flat gate          | `task14_volatility/pipeline/backtest.py`, `prompts/task14_volatility/vol_author.md`, tests                                                             |
| Seasonality            | T12 Seasonality       | Month-of-year, sell-in-May, turn-of-month calendar rules with in-sample caveat                 | `task12_seasonality/pipeline/signals.py`, `task12_seasonality/pipeline/backtest.py`, `prompts/task12_seasonality/seasonal_author.md`, tests            |
| Overnight Gap          | T13 Overnight / Gap   | Close-to-open versus open-to-close decomposition, cost-aware overnight/intraday rules          | `task13_overnight/pipeline/backtest.py`, `prompts/task13_overnight/gap_author.md`, tests                                                               |
| Price Anomaly          | T19 Price Anomalies   | 52-week-high momentum, MAX/lottery avoidance, Dec-Jan tax-loss reversal                        | `task19_anomaly/pipeline/signals.py`, `task19_anomaly/pipeline/orchestrator.py`, `prompts/task19_anomaly/anomaly_author.md`, tests                     |
| Portfolio Risk Sizer   | T10 Portfolio sizing  | Task 4 per-name long/flat signals across a Hunch watchlist, deterministic sizing, caps, vol targeting, and portfolio backtest | `task10_portfolio/pipeline/signals.py`, `task10_portfolio/pipeline/sizing.py`, `task10_portfolio/pipeline/backtest.py`, `prompts/task10_portfolio/portfolio_author.md`, tests |
| Cross-Sectional Ranker | T21 Ranker            | Tradable-universe rank by 12-1 momentum, low volatility, near-52w-high, or short-term reversal | `task21_ranker/pipeline/rank.py`, `task21_ranker/pipeline/orchestrator.py`, `prompts/task21_ranker/rank_author.md`, `task21_ranker/tests/test_rank.py` |
| Pairs Trading          | T23 Pairs trading     | Auto-selected supported pair, trailing OLS hedge ratio, spread z-score, mean-reversion thresholds, and market-neutral caveats | `task23_pairs/pipeline/pairs.py`, `task23_pairs/pipeline/orchestrator.py`, `prompts/task23_pairs/pairs_author.md`, tests |
| Meihua Null Control    | T26 Meihua I Ching    | Date+seed time cast, body/use five-element relation, deterministic hold/flat null backtest     | `task26_meihua/pipeline/iching.py`, `task26_meihua/pipeline/signals.py`, `task26_meihua/eval/null_distribution.py`, `prompts/task26_meihua/meihua_author.md`, tests |
| Qimen Null Control     | T32 Qimen Dunjia      | Simplified deterministic season/day gate, auspicious-gate hold/flat null backtest              | `task32_qimen/pipeline/qimen.py`, `task32_qimen/pipeline/orchestrator.py`, `prompts/task32_qimen/qimen_author.md`, tests |
| Taiyi Null Control     | T34 Taiyi Shenshu     | Deterministic accumulated-year host/guest count, host-prevails hold/flat null backtest         | `task34_taiyi/pipeline/taiyi.py`, `task34_taiyi/pipeline/orchestrator.py`, `prompts/task34_taiyi/taiyi_author.md`, tests |

Default selected team remains Technical Tape, Relative Strength, and Volatility Regime so Grill works immediately without forcing the user to configure Team first.

The null-control analysts are exposed only as controls. They always return a `challenge` verdict, preserve the source caveat that they have no economic mechanism, and cannot by themselves support Proposal creation.

## Deferred candidates

| Source agent              | Decision | Reason                                                                                                  |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| T1 Browser agent          | Defer    | Utility agent, not a trading analyst.                                                                   |
| T2 SEC 10-K extractor     | Defer    | Utility extraction pipeline, not a direct Analyst Opinion.                                              |
| T3 Fundamental text       | Defer    | Depends on EDGAR 10-K extraction and filing-date aligned citations, not available in Hunch runtime yet. |
| T5 Ensemble               | Defer    | Consumes T3 plus T4; T3 is not adapted yet.                                                             |
| T6 Insider                | Defer    | Depends on SEC Form 4 ingestion and filing-date keyed insider transactions.                             |
| T8 Earnings               | Defer    | Depends on SEC 8-K Item 2.02 / Ex-99.1 retrieval and LLM event classification.                          |
| T9 Institutional          | Defer    | Depends on 13F-HR curated manager holdings and publish-lag handling.                                    |
| T11 Fundamentals trend    | Defer    | Depends on SEC XBRL `companyfacts` and point-in-time filing data.                                       |
| T15 Buyback               | Defer    | Depends on XBRL share-count series from T11.                                                            |
| T16 Short pressure        | Defer    | Depends on FINRA short-volume and NASDAQ short-interest feeds.                                          |
| T17 Fundamental quality   | Defer    | Depends on point-in-time XBRL accounting factors.                                                       |
| T18 Corporate events      | Defer    | Depends on 13D, dilution, late filing, auditor, delisting, and adverse 8-K ingestion.                   |
| T20 VIX regime gate       | Defer    | Requires VIX and VIX3M series, which are not Hunch tradable assets or Pyth-backed inputs here.          |
| T22 Congressional trading | Defer    | Depends on STOCK Act disclosure feeds or PDF parsing.                                                   |
| T24 Earnings contagion    | Defer    | Requires bellwether-peer pair selection plus T8 earnings classification.                                |
| T25 Financial astrology   | Defer    | Requires astronomy support not present in the Hunch TypeScript runtime.                                 |
| T27 Bazi                  | Defer    | Requires reliable listing/first-trade date as the natal chart anchor, not just current Pyth bars.       |
| T28 Ziwei                 | Defer    | Requires reliable listing-date natal chart casting and the larger pure-Python palace/star engine.       |
| T29 Suimei                | Defer    | Requires reliable listing-date four-pillar casting and Japanese-style twelve-stage readings.            |
| T30 Qizheng               | Defer    | Requires ephem-style planetary and lunar-node calculations not present in Hunch runtime.                |
| T31 Tieban                | Defer    | Requires listing-date four-pillar casting; source itself marks this as a double placebo stand-in.       |
| T33 Liuren                | Defer    | Requires solar-sign/month-general calculation via astronomy support not present in Hunch runtime.       |
| T35 Jyotish               | Defer    | Requires sidereal graha and Vimshottari calculations not present in Hunch runtime.                      |
