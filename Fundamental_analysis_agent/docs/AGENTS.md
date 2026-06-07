# Agent Suite — what each agent does & how they interact

**21 agents**, one repo. Two are utilities (browser automation, document extraction); the rest are
US-stock trading-research agents. This document is the map: per-agent function, then the dependency
/ interaction graph and the shared backbone they all stand on.

> Live backend: every agent is a FastAPI router at `/{taskN}/...` on one app
> (`task1_browser_agent/api/main.py`). Each strategy agent has a web page under `web/app/…`.

---

## 0. The shared design pattern (every strategy agent)

All trading agents (T3–T21) follow the **same contract**, which is the heart of the suite:

```
ticker → gather data (as-of a decision date)
       → LLM picks ONE strategy from a small, fixed DSL (it never writes free code)
       → deterministic, LOOKAHEAD-FREE backtest of that rule
       → result vs buy-and-hold + the S&P 500 (SPY), with honest caveats
```

Two invariants make the suite trustworthy:

1. **Lookahead-free execution.** A signal computed on the close of bar *i* is executed at the **open
   of bar *i+1***; data tied to filings is keyed off the **filing/publish date**, never the event
   date. The LLM only ever sees as-of information.
2. **Selection ≠ execution.** The LLM *selects* a strategy from a constrained menu (so it can't leak
   future prices through code); the *execution* is pure, deterministic Python. Where selection could
   still reflect the model's prior knowledge, the UI says so.

Everything "fails loud, never silent": quarantines, graceful degradation with a visible caveat,
losses shown not hidden, costs always charged.

---

## 1. The 21 agents

### Utilities
| # | Agent | Input → Output | What it does |
|---|---|---|---|
| **T1** | Browser agent | NL task → executed web actions | NL instruction → explicit state machine (PLAN·LOCATE·ACT·VERIFY·DIAGNOSE), self-correcting via typed root-cause + three-pronged locator (CSS→ARIA→text); recovery proven by deterministic fault injection. |
| **T2** | SEC 10-K extractor | EDGAR URL / ticker → structured 10-K items | Layered pipeline L1 anchor → L2 structural → L3 LLM self-consistency; Platt-calibrated confidence; **quarantines** low-confidence filings instead of emitting wrong data. |

### Single-name signal agents (data → LLM DSL → lookahead-free backtest)
| # | Agent | Data source | Core signal |
|---|---|---|---|
| **T3** | Fundamental (10-K text) | SEC 10-K via T2 | LLM thesis + strategy grounded in the filing (with citations); filing-date-aligned backtest. |
| **T4** | Technical | prices (yfinance/Tiingo) | RSI/MACD/SMA/Bollinger/Donchian/volume readings → technical strategy. **Owns the shared backtest engine + metrics.** |
| **T6** | Insider (Form 4) | SEC Form 4 | Open-market insider buys/sells (filing-date keyed) → cluster-buy / net-value signals; selling = weak exit, never a short. |
| **T7** | Relative strength | prices + sector ETF | Stock ÷ sector-ETF RS series (SIC-mapped, SPY fallback) → RS trend/breakout/momentum. |
| **T8** | Earnings (8-K) | SEC 8-K Item 2.02 / Ex-99.1 | LLM classifies each earnings press release as-of (sentiment/guidance/beat-miss) → post-earnings-drift (PEAD) backtest. |
| **T9** | Institutional (13F) | SEC 13F-HR (curated funds) | Tracks 13 famous managers' holdings (name-matched) → accumulation/distribution; ~45-day-lag confirmation signal. |
| **T11** | Fundamentals trend | SEC XBRL `companyfacts` | YoY revenue/earnings growth + margin trend (point-in-time, as-originally-filed) → fundamental momentum. Numbers, where T3 reads text. |
| **T12** | Seasonality | prices | Month-of-year / sell-in-May / turn-of-month calendar rule; in-sample-caveated → defaults to buy-and-hold when weak. |
| **T13** | Overnight / gap | prices (OHLC) | Decomposes overnight (close→open) vs intraday (open→close); honest about the daily round-trip cost. |
| **T14** | Volatility regime | prices | Vol-managed long/flat — participate when realized vol is calm, step aside when it spikes. |
| **T15** | Buyback | SEC XBRL (via T11) | Falling diluted share count = net repurchases (filing-date keyed) → follow sustained buybacks. |
| **T16** | Short pressure / squeeze | FINRA daily short-volume **+ NASDAQ bi-monthly short-interest** | Short-volume-ratio percentile (squeeze / low-short) **and** real days-to-cover / outstanding shorts (si_squeeze / low_si). Both publish-lagged. Honest: short *volume* ≠ short *interest*; NASDAQ SI covers Nasdaq-listed names only. |
| **T17** | Fundamental quality | SEC XBRL `companyfacts` | Piotroski **F-Score** (9-point), Sloan **accruals**, and the **asset-growth** anomaly — point-in-time, filing-date keyed. A multi-factor accounting-quality screen (numbers, like T11/T15). |
| **T18** | Corporate events | SEC 8-K / 13D filings | **Schedule 13D** activist-stake drift (positive) + **red flags** (dilution 424B5/S-3, late NT filings, auditor change, delisting) + LLM-read **adverse 8-K 5.02** exec departures. Ride activist drift, stand aside on red flags. |
| **T19** | Price anomalies | prices | Three documented anomalies, prices only: **52-week-high momentum**, **MAX/lottery** avoidance, **tax-loss reversal** (Jan effect). Trailing-window + calendar → lookahead-free. |
| **T20** | VIX regime gate | prices + ^VIX / ^VIX3M | CBOE **term structure** (VIX vs VIX3M) as a regime switch: long in contango (calm), to cash on inversion or a VIX-level spike. Same-day VIX → next-open fill. |

### Aggregators (consume other agents)
| # | Agent | Consumes | What it does |
|---|---|---|---|
| **T5** | Ensemble / arbiter | **T3 + T4** | Runs both legs over a common window; an LLM **arbiter** picks a combine policy (AND/OR/weighted/gated/defer) from each leg's *reasoning, not returns*; one combined backtest. |
| **T10** | Portfolio / risk sizing | **T4 across a watchlist** | Per-name signals → LLM picks a **sizing policy** (equal/inverse-vol/risk-parity/signal-proportional + caps + vol target) → multi-name **portfolio** backtest vs an equal-weight basket + SPY. |
| **T21** | Cross-sectional ranker | **a watchlist of prices** | LLM picks ONE long-only **factor** (12-1 momentum / low-vol / near-52w-high / short-term reversal); each rebalance the universe is ranked on trailing data and the **top-N held** (equal/inverse-vol). Where T10 *sizes* a basket, T21 *selects* it. Reuses T10's portfolio backtest. |

---

## 2. How the agents interact

There are three kinds of relationship: **shared infrastructure** (everyone stands on it),
**building-block reuse** (one agent imports another's components), and **aggregation** (an agent
runs other agents end-to-end).

### 2a. Aggregation (agent-runs-agent)
```
                 ┌────────────┐         ┌────────────┐
   10-K (T2) ───▶│ T3 fundam. │──┐   ┌──│ T4 technical│
                 └────────────┘  │   │  └────────────┘
                                 ▼   ▼         │ (per name, across a watchlist)
                            ┌──────────────┐   ▼
                            │ T5 ensemble  │  ┌──────────────────┐
                            │  (arbiter)   │  │ T10 portfolio     │
                            └──────────────┘  │  sizing + risk    │
                                              └──────────────────┘
```
- **T5** authors the **T3** fundamental leg (which itself runs **T2** for extraction) and the **T4**
  technical leg, then fuses them.
- **T10** runs the **T4** agent for each ticker in a watchlist (reusing T5's `inmarket_by_date` to turn
  each leg's trades into a daily position), then sizes across names.

### 2b. Building-block reuse (shared code, not full runs)
- **Backtest engine + `_metrics` (lives in T4)** is the common scoring ruler, reused by
  **T5, T6, T7, T8, T9, T11, T12, T13, T14, T15, T16**. (T10/T21 use the portfolio-level
  `PortfolioMetrics`; T3/T4 are native.) → every agent's Sharpe/drawdown/alpha is defined identically.
- **T4's `run_backtest` + `author_technical` + `indicator_readings_asof`** are reused wholesale by
  **T5** (technical leg) and **T10** (per-name signal).
- **The generic `run_factor_backtest` (lives in T17)** — a long-only, stop/exit-aware,
  SPY-benchmarked engine driven by a `want_long(date)` callable — is reused by **T18, T19, T20**, so
  every event/anomaly/regime gate shares one execution path.
- **T10's `run_portfolio_backtest`** (multi-name, rebalancing, turnover-costed) is reused by **T21**;
  only the membership differs — T10's comes from per-name signals, T21's from a cross-sectional rank.
- **T5's `inmarket_by_date`** (trades → daily in-market series) is reused by **T10**.
- **T11's XBRL `companyfacts` fetch + `_quarterly_series` / `annual_series` / `instant_series`** is
  reused by **T15** (buyback) and **T17** (quality) — share counts via the `shares` unit vs T11's `USD`.
- **T18 reuses T8's 8-K fetch/HTML-to-text** to read the body of 8-K 5.02 exec-change items.
- **T2's grounded-citation discipline** is echoed by **T3** (10-K citations) and **T8** (press-release
  citations).

### 2c. Shared infrastructure (the backbone under everyone)
| Component | Where | Used by |
|---|---|---|
| **Pluggable price feed** `fetch_prices` (yfinance default, Tiingo swap, per-provider cache, auto-fallback) | `task3_strategy/pipeline/prices.py` | T3–T16 (every price-based agent) |
| **SEC EDGAR client** (UA + 429/503 retry, ticker→CIK disk cache, submissions) | `task2_10k_extractor/eval/edgar_lookup.py` | T2, T3, T6, T8, T9, T11, T15 |
| **LLM gateway** (multi-backend, prompt caching, cost-attributed) | `shared/llm_gateway.py` | every LLM-using agent |
| **Cost ledger** (every call attributed; `cost_for_trace`) | `shared/cost_ledger.py` | all |
| **Structured logging / OTel / artifact store / typed schemas** | `shared/` | all |
| **Backtest contracts** (`PricePoint`/`Trade`/`EquityPoint`/`BacktestMetrics`/`BacktestResult`) | `task4_technical/schemas.py` | T5–T16 import them (kept decoupled until T5) |

### 2d. External data dependency map
```
prices (yfinance→Tiingo) ── T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15 T16 T19 T20 T21
   └─ ^VIX / ^VIX3M ....... T20 (term structure)
SEC EDGAR (filings/submissions/XBRL)
   ├─ 10-K text ........... T2 → T3 → T5
   ├─ Form 4 .............. T6
   ├─ 8-K Ex-99.1 ......... T8 → T18 (8-K 5.02 body)
   ├─ 13D / red-flag forms  T18
   ├─ 13F-HR (curated) .... T9
   └─ XBRL companyfacts ... T11 → T15, T17
SEC SIC code ............... T7 (sector ETF), and industry mapping
FINRA regsho short-volume .. T16
NASDAQ short-interest ...... T16 (bi-monthly days-to-cover)
(LLM gateway) .............. every strategy agent T3–T21
```

---

## 3. The shape of the whole thing

- **Data gathering:** T1 (browser automation) + T2 (10-K extraction) feed/anchor the rest.
- **Many independent single-name signal sources** by *category*:
  fundamentals-text (T3), fundamentals-numbers (T11), accounting-quality (T17), technical (T4),
  relative-strength (T7), volatility/risk (T14), market-regime gate (T20); "event/positioning"
  signals — insider (T6), earnings (T8), institutional (T9), buyback (T15), short (T16), corporate
  events/13D (T18); and price-anomaly signals — seasonality (T12), overnight (T13), price anomalies
  (T19).
- **One fusion layer (T5)** combines a fundamental + a technical view per name.
- **Two portfolio-level capstones:** **T10** *sizes* signals across many names into a risk-controlled
  portfolio; **T21** *selects* the names by cross-sectional factor rank (and reuses T10's backtest).

That is the progression the suite is built to demonstrate: **gather → many independent signals →
fuse → select & size into a portfolio**, every step lookahead-safe, free-data-first, and honest about
its limits.

---

## 4. Per-agent quick reference (endpoint · page · package)

| # | Endpoint | Web page | Package |
|---|---|---|---|
| T1 | `/task1/jobs` | `/task1` | `task1_browser_agent/` |
| T2 | `/task2/extractions` | `/task2` | `task2_10k_extractor/` |
| T3 | `/task3/strategies` | `/strategy` | `task3_strategy/` |
| T4 | `/task4/analyses` | `/technical` | `task4_technical/` |
| T5 | `/task5/ensembles` | `/ensemble` | `task5_ensemble/` |
| T6 | `/task6/insiders` | `/insider` | `task6_insider/` |
| T7 | `/task7/relatives` | `/relative` | `task7_relative/` |
| T8 | `/task8/earnings` | `/earnings` | `task8_earnings/` |
| T9 | `/task9/institutional` | `/institutional` | `task9_institutional/` |
| T10 | `/task10/portfolios` | `/portfolio` | `task10_portfolio/` |
| T11 | `/task11/fundamentals-trend` | `/fundamentals` | `task11_fundamentals_trend/` |
| T12 | `/task12/seasonality` | `/seasonality` | `task12_seasonality/` |
| T13 | `/task13/overnight` | `/overnight` | `task13_overnight/` |
| T14 | `/task14/volatility` | `/volatility` | `task14_volatility/` |
| T15 | `/task15/buyback` | `/buyback` | `task15_buyback/` |
| T16 | `/task16/short` | `/short` | `task16_short/` |
| T17 | `/task17/quality` | `/quality` | `task17_quality/` |
| T18 | `/task18/events` | `/events` | `task18_events/` |
| T19 | `/task19/anomaly` | `/anomaly` | `task19_anomaly/` |
| T20 | `/task20/vix` | `/vix` | `task20_vix/` |
| T21 | `/task21/rankings` | `/ranker` | `task21_ranker/` |

*A new `taskN_*` package must be registered in four places or the deploy silently rolls back:
`task1_browser_agent/api/main.py` (router), `infra/Dockerfile` (COPY), and `pyproject.toml`
(`[tool.hatch…].packages` + `[tool.pytest…].testpaths`).*
