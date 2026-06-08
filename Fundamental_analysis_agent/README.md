# US-stock LLM — Browser Agent · SEC 10-K Extractor · Strategy Lab

> 🌐 Languages: **English (this page)** · [繁體中文](README.zh-TW.md)

Implemented, deployed, and live.

| Live URL | Purpose |
|---|---|
| **https://your-deployment.example.com/task1** | Task 1 — Browser Agent (submit any NL task, watch the state machine run) |
| **https://your-deployment.example.com/task2** | Task 2 — SEC 10-K Item Extractor (paste an EDGAR URL, **or** a ticker, **or** a free-text query like `"微軟 年報"`) |
| **https://your-deployment.example.com/dashboard** | Eval pass rates, cost ledger, capability matrices for both tasks |
| **https://your-deployment.example.com/jobs/{job_id}** | Failure inspector — screenshots, DOM snapshots, step trace, eval metadata |
| **https://your-backend.example.com/task1/health** | Backend health probe |

> The deployed frontends accept arbitrary input — submit anything you like
> to any of the forms.

---

## 📖 Documents worth reading first

| Order | Doc | Why |
|---|---|---|
| 1 | [PLAN.md](PLAN.md) | Full system design + the six "fail loud, never silent" design principles every later decision derives from |
| 2 | [docs/analysis/task1_report.md](docs/analysis/task1_report.md) | Task 1 perf / cost / scalability / correctness analysis — every number queried live from the cost ledger, never estimated |
| 3 | [docs/analysis/task2_report.md](docs/analysis/task2_report.md) | Same shape for Task 2 |
| 4 | [docs/VERIFICATION.md](docs/VERIFICATION.md) | 16-section living checklist with every bug found and fixed during development (root cause + fix, not "and we fixed it") |
| 5 | [docs/spec/PRODUCTION_HARDENING_ROADMAP.md](docs/spec/PRODUCTION_HARDENING_ROADMAP.md) | 8-week, 30-PR plan for taking this from its current state to quant-firm-production-grade. Week-4 CI gate already landed. |

Then dive into:

- [docs/adr/](docs/adr/) — six Architectural Decision Records: state-machine-vs-ReAct, layered extraction, deterministic fault injection, self-consistency validation, three-pronged locator, mandatory verifier.
- [prompts/](prompts/) — every prompt used by either task, with `## System` / `## User template` sections. Includes the LLM-powered free-text input parser for Task 2.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — full deploy walkthrough (Vercel + Railway/Zeabur + Supabase).

---

## What's in the repo

```
shared/                  LLM gateway, cost ledger, schemas, structured logging,
                         OpenTelemetry helper, pluggable artifact store
                         (filesystem / Supabase Storage)
task1_browser_agent/     Browser agent — agent/, api/, eval/ (with deterministic
                         fault-injection module for recovery proof)
task2_10k_extractor/     SEC 10-K extractor — pipeline/ (ingest → normalize →
                         L1 → L2 → L3 → confidence → calibration),
                         api/ (with LLM-powered free-text input parser),
                         eval/ (20 cases over 7 industries + pre-iXBRL)
task3_strategy/ … task28_ziwei/
                         The Strategy Lab — 22 US-stock research agents + 4 placebo
                         controls (T3–T28). Each = pipeline/ (data → signal →
                         lookahead-free backtest), api/ router, eval/. See the full
                         map below and in docs/AGENTS.md.
web/                     Next.js 15 frontend — a page per agent under web/app/…,
                         plus /, /dashboard, /jobs/[id]
prompts/                 Versioned prompt templates (4 for Task 1 + 3 for Task 2)
docs/spec/               Original project spec (EN + ZH)
                         + PRODUCTION_HARDENING_ROADMAP.md (production roadmap)
docs/adr/                ADR-001 through ADR-006
docs/analysis/           Per-task perf / cost / scalability analysis
docs/VERIFICATION.md     Living verification checklist + full bug history
docs/DEPLOYMENT.md       Step-by-step prod deploy walkthrough
.github/workflows/ci.yml CI eval-regression gate + lint + typecheck + build
infra/                   Dockerfile, railway.json, zeabur.json, Procfile,
                         docker-compose.dev.yml, .env.production.example
```

---

## 🧭 The full agent suite (T1–T28) — principles & how they interact

What began as the two review tasks (T1 browser agent, T2 10-K extractor) grew into a
**28-agent US-stock research suite**: 24 signal/portfolio agents + **4 placebo controls**.
The deep-dive map is [docs/AGENTS.md](docs/AGENTS.md); this is the self-contained summary.

### The shared design pattern (every strategy agent)

```
ticker → gather data (as-of a decision date)
       → LLM picks ONE strategy from a small, fixed DSL (it never writes free code)
       → deterministic, LOOKAHEAD-FREE backtest of that rule
       → result vs buy-and-hold + the S&P 500 (SPY), with honest caveats
```

Two invariants make it trustworthy:

1. **Lookahead-free execution** — a signal computed on the close of bar *i* executes at the
   **open of bar *i+1***; filing-based data is keyed to the **filing/publish date**, never the
   event date. The LLM only ever sees as-of information.
2. **Selection ≠ execution** — the LLM *selects* from a constrained menu (it can't leak future
   prices through code); the *execution* is pure deterministic Python. The placebo controls
   (T25/T26/T27/T28) are the proof: their florid LLM narrative is computed but **ignored** by the engine.

### Utilities (data gathering)

| # | Agent | Principle |
|---|---|---|
| **T1** | Browser agent | NL task → explicit `PLAN·LOCATE·ACT·VERIFY·DIAGNOSE` state machine; self-corrects via typed root-cause + a three-pronged locator (CSS→ARIA→text). |
| **T2** | SEC 10-K extractor | Layered L1 anchor → L2 structural → L3 LLM self-consistency; Platt-calibrated confidence; **quarantines** low-confidence filings instead of emitting wrong data. |

### Single-name signal agents (data → LLM DSL → lookahead-free backtest)

| # | Agent | Principle |
|---|---|---|
| **T3** | Fundamental (10-K text) | LLM thesis + strategy grounded in the filing text (with citations); filing-date-aligned backtest. |
| **T4** | Technical | RSI/MACD/SMA/Bollinger/Donchian/volume readings → a technical rule. **Owns the shared backtest engine + metrics.** |
| **T6** | Insider (Form 4) | Open-market insider cluster-buys / net-value (filing-date keyed); selling is a weak exit, never a short. |
| **T7** | Relative strength | Stock ÷ sector-ETF (SIC-mapped, SPY fallback) → RS trend / breakout / momentum. |
| **T8** | Earnings (8-K) | LLM classifies each earnings release (sentiment/guidance/beat-miss) → post-earnings-drift (PEAD). |
| **T9** | Institutional (13F) | Tracks famous managers' holdings → accumulation/distribution; ~45-day-lag confirmation. |
| **T11** | Fundamentals trend | XBRL YoY revenue/earnings growth + margin trend (point-in-time) → fundamental momentum. |
| **T12** | Seasonality | Month-of-year / sell-in-May / turn-of-month; in-sample-caveated, defaults to buy-and-hold when weak. |
| **T13** | Overnight / gap | Decomposes overnight (close→open) vs intraday (open→close); honest about the round-trip cost. |
| **T14** | Volatility regime | Vol-managed long/flat — participate when realized vol is calm, step aside when it spikes. |
| **T15** | Buyback | Falling diluted share count = net repurchases (filing-date keyed) → follow sustained buybacks. |
| **T16** | Short pressure | FINRA short-**volume** percentile **+** NASDAQ bi-monthly short-**interest** (days-to-cover); both publish-lagged. |
| **T17** | Fundamental quality | Piotroski **F-Score** + Sloan **accruals** + **asset-growth** anomaly — point-in-time accounting quality. |
| **T18** | Corporate events | 13D activist drift (+) + red flags (dilution / late filings / auditor change / delisting) + LLM-read 8-K 5.02 exec departures. |
| **T19** | Price anomalies | **52-week-high momentum**, **MAX/lottery** avoidance, **tax-loss reversal** — prices only, calendar/trailing-window. |
| **T20** | VIX regime gate | CBOE term structure (^VIX vs ^VIX3M): long in contango, to cash on inversion or a VIX spike. |
| **T22** | Congressional trading | Follow disclosed lawmaker buys / avoid after sells, keyed to the **disclosure** date. Pluggable data (Quiver/FMP key, else free House-PTR parse). |
| **T24** | Earnings contagion | A bellwether's earnings move its **peer** before the peer reports; classifies the bellwether's 8-Ks (reusing T8), trades the peer. |

### Long-short / market-neutral

| # | Agent | Principle |
|---|---|---|
| **T23** | Pairs trading (stat-arb) | The suite's one **long-short, dollar-neutral** strategy: spread = logA − β·logB (trailing OLS), rolling **z-score** mean-reversion (enter on stretch, exit on reversion, stop on blow-out). |

### Portfolio capstones & fusion (consume other agents)

| # | Agent | Principle |
|---|---|---|
| **T5** | Ensemble / arbiter | Runs **T3 + T4** over a common window; an LLM arbiter picks a combine policy (AND/OR/weighted/gated/defer) from each leg's *reasoning, not returns*. |
| **T10** | Portfolio / risk sizing | Runs **T4** across a watchlist → LLM picks a **sizing policy** (equal/inverse-vol/risk-parity/signal-proportional + caps + vol target) → multi-name portfolio backtest. |
| **T21** | Cross-sectional ranker | LLM picks ONE factor (momentum / low-vol / 52w-high / reversal); each rebalance ranks the universe on trailing data and holds the **top-N**. Reuses T10's backtest. Where T10 *sizes*, T21 *selects*. |

### Control / placebo arm ⚠️ (calibrate the false-positive rate)

| # | Agent | Principle |
|---|---|---|
| **T25** | Financial astrology | Mercury-retrograde / moon-phase / aspect timing via `ephem` (offline, deterministic). **No economic mechanism** — runs the identical backtest to measure what Sharpe the framework manufactures from noise. Prints the 星盤 + reasoning chain. |
| **T26** | 梅花易數 I Ching | Deterministic 時間起卦 → 體用五行生剋 hold/flat. Its `seed` makes it the **null-distribution engine** (poor-man's White's Reality Check: **480 draws → p95 Sharpe ≈ 0.94**, the bar a real agent must clear to beat luck). Prints the full 命盤 + 起卦→體用→生剋→變卦 chain. |
| **T27** | 八字 Four Pillars | Casts the company's natal chart from its **listing date**, reads 日主 + 旺衰 + 喜用神, and holds when the current 流年/流月 五行 is favourable to the Day Master. Deterministic, lookahead-free (anchors: 2000-01-07=甲子日, 1984=甲子年). Prints the 四柱 命盤 + reasoning chain. |
| **T28** | 紫微斗數 四化飛星 | Casts the full 紫微 命盤 (12 palaces, 14 stars, 五行局) from the **listing date** (pure-Python engine, verified vs py-iztro), then trades the 四化飛星: holds when the year's 化祿/化權 fly into the natal 命宮/財帛/官祿, flat when 化忌 does. Deterministic; prints the 4×4 命盤 board + reasoning chain. |

### Interaction relationship diagram

**(a) Aggregation — an agent runs other agents end-to-end:**

```
                 ┌────────────┐         ┌─────────────┐
   10-K (T2) ───▶│ T3 fundam. │──┐   ┌──│ T4 technical│──────┐ (per name, across a watchlist)
                 └────────────┘  │   │  └─────────────┘      │
                                 ▼   ▼                       ▼
                            ┌──────────────┐     ┌───────────────────┐   ┌──────────────────────┐
                            │ T5 ensemble  │     │ T10 portfolio     │   │ T21 cross-sectional  │
                            │  (arbiter)   │     │  sizing + risk    │   │  ranker (reuses T10) │
                            └──────────────┘     └───────────────────┘   └──────────────────────┘

   8-K (T8) ───▶ classify the BELLWETHER's earnings ──▶ ┌──────────────────────┐
                                                        │ T24 earnings contagion│ trades the PEER
                                                        └──────────────────────┘
```

**(b) Building-block reuse — shared code, not full runs:**

- **T4's backtest engine + `_metrics`** is the common scoring ruler → reused by T5, T6, T7, T8, T9, T11–T16.
- **The generic `run_factor_backtest` (in T17)** — long-only, driven by a `want_long(date)` callable → reused by **T18, T19, T20, T22, T24, T25, T26, T27, T28**.
- **T10's `run_portfolio_backtest`** (multi-name, rebalancing, turnover-costed) → reused by **T21**.
- **T23** keeps its own market-neutral backtest but fills T4's `BacktestMetrics` so the shared UI panel renders it.
- **T11's XBRL `companyfacts` fetch** → reused by T15 (buyback) and T17 (quality).
- **T8's 8-K fetch + classifier** → reused by T18 (5.02 body) and T24 (bellwether).
- **`shared/eval_harness.py`** (lookahead-invariant checks for factor / portfolio / pairs shapes) → reused by every agent's eval runner.

**(c) External data dependency map:**

```
prices (yfinance→Tiingo) ── T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15 T16 T19 T20 T21 T22 T23 T24 T25 T26 T27 T28
   └─ ^VIX / ^VIX3M ....... T20
SEC EDGAR (filings / submissions / XBRL)
   ├─ 10-K text ........... T2 → T3 → T5
   ├─ Form 4 .............. T6
   ├─ 8-K Ex-99.1 ......... T8 → T18, T24
   ├─ 13D / red-flag forms  T18
   ├─ 13F-HR (curated) .... T9
   └─ XBRL companyfacts ... T11 → T15, T17
SEC SIC code ............... T7 (sector ETF), industry mapping
FINRA short-volume ......... T16        NASDAQ short-interest ... T16
Congress disclosures ....... T22 (Quiver/FMP key, else free House-PTR PDFs)
ephem (offline astronomy) .. T25   date-only casting ... T26   firstTradeDate natal ... T27   pure-Python 紫微 ... T28
(LLM gateway) .............. every strategy agent T3–T28
```

The progression the suite demonstrates: **gather → many independent signals → fuse → select & size
into a portfolio**, every step lookahead-safe and free-data-first — with two placebo controls bolted on
to keep the whole thing statistically honest.

---

## 💰 Where each agent's edge actually comes from (and when it bleeds)

A signal only makes money if it harvests something real: a **risk premium** (you get paid to bear
risk), a **behavioral anomaly** (a mispricing from human bias — which *decays as it gets arbitraged*),
an **information edge** (someone knows more), or **relative-value arbitrage**. Naming the source per
agent is the honest test — and it exposes that several of these "edges" are decayed, crowded, or (for
the two controls) **absent on purpose**. T1/T2 are tools, not traders: they make no market money, they
cut the cost of gathering data.

| # | What it actually harvests | Makes money when… | Loses money when… |
|---|---|---|---|
| **T3** Fundamental | Value/quality premium + slow fundamental mispricing | cheap/quality names re-rate and the filing-grounded thesis is right | fundamentals already priced (efficient), value traps, or the thesis is overfit/wrong |
| **T4** Technical | Trend/momentum risk premium + short-horizon autocorrelation | the tape trends and persists | choppy/mean-reverting markets whipsaw it; momentum crashes at reversals; costs compound |
| **T5** Ensemble | Signal diversification (variance reduction) + conflict-gating | the two weakly-correlated legs agree **and** are right | correlated error (both wrong together) or an overfit combine policy |
| **T6** Insider | Information asymmetry — insiders know more | following *opportunistic* cluster buys that genuinely predict upside | the signal is public + lagged + crowded; many buys are uninformative (10b5-1, comp); selling is noisy so it's ignored |
| **T7** Relative strength | Cross-sectional momentum / sector leadership | leaders keep leading their sector | factor rotations and sharp reversals — it *is* momentum, so it owns momentum-crash risk |
| **T8** Earnings (PEAD) | Post-earnings under-reaction drift — the most robust anomaly | drift continues after a genuine beat-and-raise | the surprise is already priced (mega-caps), "priced-for-perfection" sell-the-beat, decayed drift, costs |
| **T9** Institutional (13F) | Smart-money skill spillover (copy good managers) | the manager's edge persists past the **45-day reporting lag** | positions are stale/already exited; long-equity-only view; fund-list survivorship — thin, mostly confirmation |
| **T10** Portfolio sizing | Diversification + risk-control premium (Sharpe, not raw return) | names are diversifiable and trailing vol forecasts forward vol | correlations spike in crises (diversification fails when you need it); vol-targeting de-risks at the bottom |
| **T11** Fundamentals trend | Earnings/revenue-momentum anomaly | accelerating fundamentals aren't yet priced | growth mean-reverts, value traps, quarterly-XBRL lag |
| **T12** Seasonality | Calendar anomalies (turn-of-month, sell-in-May) — thin & contested | the pattern is real *and* survives out-of-sample (rare) | in-sample data-mining; it defaults to buy-and-hold precisely because the edge is usually absent |
| **T13** Overnight / gap | The overnight-return premium (overnight ⬆, intraday flat) | the overnight drift persists | the daily round-trip transaction cost usually eats the **entire** edge — the agent says so upfront |
| **T14** Volatility regime | Low-vol anomaly / vol-managed Sharpe (Moreira–Muir) | vol is persistent, so sidestepping high-vol regimes lifts Sharpe | it misses the violent rebounds clustered near vol spikes; in calm bulls it just trails buy-and-hold by costs |
| **T15** Buyback | Buyback anomaly (share-count reduction → outperformance) | sustained *real* repurchases the market under-weights | debt-funded buybacks at the top, buybacks that only offset dilution, or already priced; slow signal |
| **T16** Short pressure | Short-interest sentiment / squeeze + crowded-short avoidance | riding a squeeze or dodging a crowded short | short-*volume* includes MM hedging (noise); interest is stale/bi-monthly; shorts are often *right* → catching a falling knife |
| **T17** Fundamental quality | Quality premium (Piotroski F-score, accruals, asset-growth anomalies) | tilting to profitable, low-accrual, low-asset-growth names | junk/low-quality rallies (early-cycle risk-on); the premia have decayed since publication |
| **T18** Corporate events | Event-driven: 13D activist value-creation + red-flag avoidance | activist drift plays out / red flags are correctly dodged | activism fails, dilution already priced, one-off events; filing-date lag |
| **T19** Price anomalies | Behavioral biases (52w-high anchoring, lottery-demand, tax-loss) | the bias persists out-of-sample | heavy arbitrage/decay since publication; momentum-crash and reversal risk |
| **T20** VIX regime gate | Vol term-structure regime premium (inversion → worse forward returns) | it sidesteps the worst vol regimes on an index | cash during the sharp up-days that cluster near vol spikes (whipsaw); a blunt index tool, weak on single names |
| **T22** Congressional trading | *Alleged* political information edge — honestly **near-zero** | only if a thin post-disclosure drift exists | public + crowded + disclosed up to 45 days late kills any edge; partial free data. Borderline-placebo, and labelled so |
| **T23** Pairs trading | Statistical-arbitrage / relative-value mean-reversion (market-neutral) | a cointegrated spread reverts faster than it diverges | the relationship **breaks** (structural change / M&A); borrow + double costs; heavily arbitraged; can lose in any market direction |
| **T24** Earnings contagion | Intra-industry information transfer (read-across) | the peer drifts with the bellwether's surprise before it reports | the peer's idiosyncratics dominate; *competitive* read-across flips the sign; already priced; tiny decaying window |
| **T25** Financial astrology ⚠️ | **Nothing.** No economic mechanism | only by luck/noise | it gives up the equity premium on astrologically-arbitrary flat days + pays costs — by design |
| **T26** 梅花易數 ⚠️ | **Nothing.** No economic mechanism | only by chance | the null shows worthless timing still posts p95 Sharpe ≈ 0.94 from equity-premium variance alone — that's the point: it's the ruler, not a strategy |
| **T27** 八字 ⚠️ | **Nothing.** No economic mechanism | only by luck/selection bias | a single natal reading on a hand-picked 10× winner can clear the null by chance — exactly why the *distribution*, not one run, is the honest measure |
| **T28** 紫微斗數 ⚠️ | **Nothing.** No economic mechanism | only by luck | the most elaborate divination chart in the suite (12 palaces, 四化飛星) is still a placebo — its job is to look authoritative and post a null-band Sharpe |

**The honest net-of-everything read:** after costs and post-publication decay, the most *defensible*
members are the risk-premium harvesters (**T10** diversification, **T14**/**T20** vol-timing) and the
few anomalies that have survived best (**T8** PEAD, **T17** quality, **T15** buyback). The
information-edge agents (**T9**, **T22**) are the weakest — public, lagged, crowded. And **any** agent
whose backtested Sharpe doesn't clear the **placebo null (≈0.94, see below)** should be treated as
indistinguishable from luck, however good its story sounds.

---

## 📊 Top-line numbers (current eval baselines)

**Task 1 — Browser Agent** ([eval set, 15 cases over 6 categories](task1_browser_agent/eval/eval_set.yaml))

| Metric | Value |
|---|---|
| Pass rate | **11–14 / 15 (73–93%)** across consecutive runs (Gemini stochasticity at temp=0, see [task1_report §5.4](docs/analysis/task1_report.md)) |
| Recovery rate | 8–18% — including one observed **real-world** recovery (not just fault-injected) |
| Cost p50 / p95 | **$0.005 / $0.009** per task |
| Wall-time (p50) | ~25 s per case |
| Total eval wall-time | **~2 min** (parallel @ 4 — was 10 min serial) |
| Deterministic fault-injection recovery proof | ✅ `recovery-stale-locator-then-succeed` case |

**Task 2 — 10-K Item Extractor** ([eval set, 20 cases across 7 industries + 3 pre-iXBRL filings](task2_10k_extractor/eval/eval_set.yaml))

| Metric | Value |
|---|---|
| Pass rate | **19 / 20 (95%)** — the 1 fail is MSFT-2015 Item 8 (legitimately incorporated by reference; system refuses to fabricate) |
| Mean overall confidence | 0.896 (**Platt-calibrated** — ECE 0.056) |
| Mean required-item coverage | 95% |
| Cost per filing (median) | **$0.00** — L1+L2 covers every case |
| Wall-time (p50) | ~5 s per filing |
| Total eval wall-time | **~35 s** for all 20 (parallel @ 4) |

> ⚠️ **These are curated-eval numbers and do not generalize.** The 20 cases were selected for industry diversity *and the heading thresholds / calibration were tuned against them*. On a 25-ticker real-world sweep of untuned large-cap filers, mean confidence drops to **0.526** and only **68 %** keep all four substance items intact. See the row below.

**Task 2 — Real-world sweep** (25 untuned large-cap tickers, fetched live from EDGAR — [full writeup](docs/analysis/real_world_sweep.md))

| Metric | Value |
|---|---|
| Pipeline ran end-to-end (no error) | **25 / 25 (100%)** — never crashes, never returns zero items |
| Core-4 substance items extracted (1 / 1A / 7 / 8) | **17 / 25 (68%)** under their own heading; +2 (NVDA/NFLX) are legitimate Item 8 → Item 15 incorporation, leaving **8 genuinely broken** — vs ~95% on the curated set |
| Mean overall confidence | **0.526** (median 0.509) — vs 0.896 curated; calibration does not transfer |
| Quarantine rate | **8 / 25 (32%)** after the reliability fix ([ADR-007](docs/adr/ADR-007-structural-quarantine-gate.md)) — a hard structural gate flags every filing missing/truncating a core item (1/1A/7/8). **8/8 real failures caught, 0/17 false positives**, incl. Citi with its MD&A missing (was a silent pass before the fix). |
| Most common real failure | **Item 7 (MD&A), 5/8** — anchor mis-bounded or no recognisable heading |
| Incorporation handled | NVDA/NFLX Item 8 → Item 15 correctly classified as incorporation-by-reference, not failures (only when the statements are verifiably captured) |
| Cost per filing (median / max) | **$0.024 / $0.063** — real filings trigger L3; the structural gate itself adds zero LLM cost |

Both tasks' curated numbers are queried directly from `task{1,2}_browser_agent/eval/report.json` and the `cost_ledger` table — no estimation. The real-world sweep numbers come from [`tools/sweep_random_tickers.py`](tools/sweep_random_tickers.py) over a live EDGAR pull.

---

## 🏗 Design highlights

### Task 1 — Browser Agent

| Property | Where | Why this and not the obvious alternative |
|---|---|---|
| Explicit `PLAN → LOCATE → ACT → VERIFY → DIAGNOSE` state machine | [agent/state_machine.py](task1_browser_agent/agent/state_machine.py) | ReAct loops have unbounded cost and no failure attribution. See [ADR-001](docs/adr/ADR-001-state-machine-over-react.md). |
| Three-pronged locator probe (CSS → ARIA role+name → visible text) | [agent/executor.py](task1_browser_agent/agent/executor.py) | Single CSS selector is the #1 cause of brittle web agents. See [ADR-005](docs/adr/ADR-005-three-pronged-locator.md). |
| Mandatory verifier after every action | [agent/verifier.py](task1_browser_agent/agent/verifier.py) | "ACT didn't throw" ≠ "ACT achieved the goal." See [ADR-006](docs/adr/ADR-006-mandatory-verifier.md). |
| Recovery via typed `RecoveryStrategy` enum (RELOCATE / WAIT / REPLAN / ESCALATE / ABORT) | [agent/diagnoser.py](task1_browser_agent/agent/diagnoser.py) | "Naked retry" is not self-correction. Every recovery must articulate what changes on retry. |
| Failed selectors tracked per step + prong escalates + `selector_history` cache across sessions | [agent/state_machine.py](task1_browser_agent/agent/state_machine.py) + [shared/cost_ledger.py](shared/cost_ledger.py) | First v3 eval had recovery_rate=0% because the locator LLM kept proposing the same broken selector. Fixed with avoid-list + prong escalation; persistent `selector_history` table compounds first-try hit rate over time. |
| Domain allow-list enforced on every navigation | [agent/executor.py](task1_browser_agent/agent/executor.py) | Compliance / safety. |
| Deterministic fault injection for recovery proof | [eval/fault_injection.py](task1_browser_agent/eval/fault_injection.py) | Recovery only triggers on real failures — so "it works" can only be proven by accident. Fault injection makes the proof deterministic. See [ADR-003](docs/adr/ADR-003-deterministic-fault-injection.md). |

### Task 2 — 10-K Extractor

| Property | Where | Why this and not the obvious alternative |
|---|---|---|
| **Free-text input parser** — accepts any English / Chinese natural-language input (`"Apple 2024"`, `"微軟 年報"`, ticker, URL) | [api/router.py edgar_parse](task2_10k_extractor/api/router.py), [prompts/task2_10k/input_parser.md](prompts/task2_10k/input_parser.md) | Reviewers don't want to hand-craft EDGAR archive URLs. CHEAP-tier LLM (~$0.0001) interprets intent + emits typed `url` / `ticker_query` / `unsupported` / `refuse`. Foreign-filer 20-F → typed refusal; nonsense input → typed refusal. |
| **Full SEC ticker registry** (10,365 tickers) as fallback | [eval/edgar_lookup.py](task2_10k_extractor/eval/edgar_lookup.py) | KNOWN_CIKS only had 14 hand-curated tickers. Now any US-listed filer resolves automatically via SEC's public `company_tickers.json`. |
| Layered fallback: **L1** anchor → **L2** structural → **L3** LLM self-consistency → quarantine | [pipeline/orchestrator.py](task2_10k_extractor/pipeline/orchestrator.py) | A single LLM-everything pipeline costs ~$0.10–$0.50 per filing. Layered fallback costs $0 on the curated set and a real-world median of **$0.024** (L3 fires on most real filings; see [sweep](docs/analysis/real_world_sweep.md)) — still ~5–20× cheaper than LLM-everything. See [ADR-002](docs/adr/ADR-002-layered-extraction-pipeline.md). |
| **L1** anchor extractor: regex + density-based TOC + first-with-gap section heuristic | [pipeline/l1_anchor.py](task2_10k_extractor/pipeline/l1_anchor.py) | Most filings have proper heading anchors; we capture them deterministically. |
| **L2** structural extractor: TOC `<a href="#item7a">` → `<a name="item7a">` reverse-lookup | [pipeline/l2_structural.py](task2_10k_extractor/pipeline/l2_structural.py) | When L1 misses a heading (visual styling not in our tag set), the TOC link almost always points at the right anchor. |
| **L3** LLM self-consistency: two independent prompts per suspect item + boundary IoU + arbitration | [pipeline/l3_llm.py](task2_10k_extractor/pipeline/l3_llm.py) | Without a public ground truth, the only honest self-validation is two independent extractions agreeing. See [ADR-004](docs/adr/ADR-004-self-consistency-validation.md). |
| **Trained Platt calibration** — ECE 0.056 on 192 synthetic labels auto-bootstrapped from the eval baseline | [pipeline/calibration.py](task2_10k_extractor/pipeline/calibration.py), [eval/bootstrap_calibration.py](task2_10k_extractor/eval/bootstrap_calibration.py) | Raw confidence is a useful ordering but not a probability. Labels are synthetic (rule-based), provenance transparently noted in `labels.provenance.json` — replace with human grading for true production calibration. |
| Confidence as 25th-percentile over REQUIRED items (not min, not mean) | [pipeline/confidence.py](task2_10k_extractor/pipeline/confidence.py) | `min` crashes overall to 0 on a legitimately-empty `Item 6 [Reserved]`. `mean` masks systemic problems. `p25` is robust to one outlier but still fails loud on systemic issues. |
| Per-item floor only applied to REQUIRED items | [pipeline/confidence.py](task2_10k_extractor/pipeline/confidence.py) | Items 1B, 6, 9B, 9C, 16 are commonly empty by design — penalising them generates false positives. |
| Quarantine threshold 0.45 + `quarantined=true` surfaced in API + UI | [pipeline/confidence.py](task2_10k_extractor/pipeline/confidence.py) | "Fail loud, never silent": a low-confidence output is flagged, not emitted as if certain. |
| **Concrete capability matrix exposed in UI** — 8 eval-proven filings + 1 known failure case + 4 typed-refusal categories | [dashboard `#task2-capabilities`](https://your-deployment.example.com/dashboard#task2-capabilities) | The spec asks for clear lists of supported / problematic filings with examples. Dashboard surfaces all of this, with deep-link from `/task2` page. |

### Shared backbone (both tasks)

| Component | Why |
|---|---|
| **LLM Gateway** ([shared/llm_gateway.py](shared/llm_gateway.py)) | Single entrypoint, pluggable backend (`anthropic` / `openai` / `gemini` / `mock`), tier-based model routing (CHEAP / DEFAULT / PREMIUM), mandatory cost attribution before return, tenacity retry with `LLMUnavailableError` (503/429) distinguished from other errors. Anthropic prompt caching when supported. **Mock backend** lets CI run the eval gate at zero cost. |
| **Cost Ledger** ([shared/cost_ledger.py](shared/cost_ledger.py)) | Every LLM call writes one row before the response returns. Analysis reports query this table directly, never estimate. Aggregations exposed via `/task1/dashboard/cost-summary` (by purpose, by model). Schema uses `TIMESTAMP WITH TIME ZONE` (UTC) — discovered during initial Supabase deploy. |
| **`selector_history`** ([shared/cost_ledger.py](shared/cost_ledger.py)) | Per-(site, target_signature, primary_selector) success/failure counter persisted across sessions; locator prompt receives previously-working selectors as a "KNOWN-GOOD" hint. Compounds first-try hit rate over time. |
| **Strongly-typed Pydantic schemas** ([shared/schemas.py](shared/schemas.py)) | Every cross-process / persisted record carries `schema_version: "1.0.0"`. Breaking changes go through a v2 type, never silent mutation. |
| **Structured logging** ([shared/logging.py](shared/logging.py)) | structlog JSON / dev-text. Trace id carried via contextvars. No bare `print()` in any production code path. |
| **OpenTelemetry** ([shared/otel.py](shared/otel.py)) | `OTEL_ENABLED=true` wires `TracerProvider` + `FastAPIInstrumentor` + console exporter fallback. Real OTLP endpoint ships to Honeycomb / Tempo / Jaeger when configured. |
| **Artifact store** ([shared/artifacts.py](shared/artifacts.py)) | `ARTIFACT_BACKEND=local` writes filesystem; `ARTIFACT_BACKEND=supabase` uploads via the REST API. Same `put_artifact` / `get_artifact` interface either way. |
| **Observability via `/dashboard`** | KPI tiles + eval table + cost-by-purpose + cost-by-model + recent jobs + Task 1 capability matrix + Task 2 capability matrix (proven filings, known failures, typed-refusal categories). Every row is clickable → drills into the failure inspector. |

---

## 🚀 Quick start (run locally)

### Prerequisites

- Python ≥ 3.11
- Node ≥ 20 (Next 15 needs it; conda's bundled Node 11 is too old)
- One of: an Anthropic / OpenAI / Gemini API key. **Gemini is the default** — free tier sufficient (this entire project's dev cost across hundreds of calls is < $1).

### Backend

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
playwright install chromium

cp .env.example .env
# Edit .env → set GEMINI_API_KEY (or LLM_BACKEND=anthropic + ANTHROPIC_API_KEY)

uvicorn task1_browser_agent.api.main:app --reload --port 8000
```

### Frontend

```bash
cd web
PATH=/usr/local/bin:$PATH npm install --legacy-peer-deps
PATH=/usr/local/bin:$PATH npm run dev   # → http://localhost:3000
```

The `PATH=` prefix is needed if a conda Python is your default. Find a `node` ≥ 20 (`brew install node` or `nvm install 20`).

### Run the evals

```bash
# Task 1 — 15 cases, parallel @ 4, ~2 min, ~$0.07
python -m task1_browser_agent.eval.runner --concurrency 4

# Task 2 — 20 cases, parallel @ 4, ~35 s, ~$0 (L1+L2 covers everything)
python -m task2_10k_extractor.eval.runner --concurrency 4
```

Reports land in `task{1,2}_browser_agent/eval/report.json`. The dashboard reads them.

### Expand the Task 2 eval set against current SEC EDGAR data

```bash
python -m task2_10k_extractor.eval.edgar_lookup --build-eval-set --output /tmp/expanded.yaml
```

This calls `data.sec.gov/submissions/CIK{cik}.json` for every ticker in `KNOWN_CIKS`, picks the most recent 10-K, and emits an `eval_set.yaml`-compatible block. Historical filings beyond the `recent` block are also resolvable (pre-2017 paginated submissions).

### Bootstrap & retrain confidence calibration

```bash
# Run the full eval, derive synthetic labels, fit Platt, persist params
python -m task2_10k_extractor.eval.bootstrap_calibration train

python -m task2_10k_extractor.pipeline.calibration status
# → shows a, b, n_train, ECE, Brier
```

---

## ☁️ Deployment

The full step-by-step is in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Short version:

| Tier | Where | Config |
|---|---|---|
| Frontend (Next.js) | Vercel | [`web/vercel.json`](web/vercel.json) — set `NEXT_PUBLIC_API_URL` to the backend URL |
| Backend (FastAPI + Playwright + Chromium) | Railway (or Zeabur / Fly) — **not Vercel** (no long-running Playwright there) | [`infra/Dockerfile`](infra/Dockerfile) + [`railway.json`](railway.json) + [`infra/zeabur.json`](infra/zeabur.json) + [`infra/Procfile`](infra/Procfile) |
| Database | Supabase (Postgres) | `DATABASE_URL=postgresql+asyncpg://postgres.<ref>:<pw>@<pooler>:5432/postgres` |
| Artifact storage | Supabase Storage | `ARTIFACT_BACKEND=supabase` + `SUPABASE_*` (full REST backend in [`shared/artifacts.py`](shared/artifacts.py)) |

Backend env-var template: [`infra/.env.production.example`](infra/.env.production.example).

**CI/CD** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): every push to `main` and every PR is gated by:

- Python lint + whole-codebase syntax check
- Backend startup smoke test (FastAPI app responds to `/task1/health` and `/task2/health` within 30 s)
- **Task 2 eval regression gate** (mock LLM backend, $0 cost, deterministic, fails if pass-rate drops > 2 pp vs the committed baseline)
- Next.js TypeScript typecheck + production build

No CI secrets required — the mock backend keeps everything free and reproducible.

---

## 🤖 AI collaboration record

Every prompt the system uses is in [prompts/](prompts/):

- **Task 1** — [planner](prompts/task1_browser/planner.md), [locator](prompts/task1_browser/locator.md), [verifier](prompts/task1_browser/verifier.md), [diagnoser](prompts/task1_browser/diagnoser.md)
- **Task 2** — [input_parser (free-text → intent)](prompts/task2_10k/input_parser.md), [extractor_a (per-item)](prompts/task2_10k/extractor_a.md), [extractor_b (whole-chunk)](prompts/task2_10k/extractor_b.md)

These were iterated on with Claude as the primary AI collaborator. The full bug-history-with-fixes is in [docs/VERIFICATION.md](docs/VERIFICATION.md), which is the most honest read of how the system evolved (16 sections, 16+ documented bugs each with root cause + fix).

---

## 🎲 Statistical honesty: the placebo control arm & null distribution

A 24-agent suite, each with several strategy templates, runs hundreds of
lookahead-free backtests. **Multiple testing** guarantees a few will post a great
Sharpe by pure chance — the single biggest methodological risk in the whole project.
Rather than hand-wave it away, the suite ships **two placebo control agents** that run
the *identical* lookahead-free backtest on signals known to have **no economic
mechanism**:

- **T25 — financial astrology** (Mercury retrograde / moon phase / planetary aspects,
  computed offline from `ephem`; a calendar date leaks nothing about prices, so it is
  *more* lookahead-free than any filing).
- **T26 — 梅花易數 Plum-Blossom I Ching** (a hexagram cast deterministically from the
  date drives a 體用五行生剋 hold/flat rule).

In both, the LLM writes a florid horoscope / 卦辭 thesis and the engine **ignores it** —
the ultimate test of the suite's *selection ≠ execution* invariant. If a placebo prints
a high Sharpe, the **framework is leaking** (or you are watching selection bias), not the
planets working.

**The reversal — the diviner becomes the suite's significance test.** Because the
梅花易 casting takes a `seed`, we draw a whole **null distribution**: a panel of 12
tickers × 40 seeds = **480 worthless backtests** through the real engine. The result is
a poor-man's White's Reality Check:

```
null Sharpe (480 placebo draws):  p50 = 0.10   p90 = 0.78   p95 = 0.94   p99 = 1.11   max = 1.29
→ a real agent needs Sharpe ≥ 0.94 to beat random hexagram-timing at 95% confidence.
```

So a headline like T20's VIX-gate Sharpe of **1.21** isn't taken at face value — measured
against this null it lands at **p ≈ 0.004** (significant); an agent posting Sharpe 0.6 would
be *indistinguishable from luck*, no matter how good its story. Run it yourself:

```bash
python -m task26_meihua.eval.null_distribution --seeds 40 --observe 1.21
# → null percentiles + the p-value of any observed Sharpe
```

The control arm is labelled `is_control` everywhere and rendered with a purple **PLACEBO**
banner in the UI so it can never be mistaken for a tradable signal.

---

## 🔭 Honest limitations (read before grading)

1. **Task 1 eval is small** (15 cases) and run-to-run pass rate varies **11–14/15** from Gemini stochasticity at `temperature=0`. The system reports the range honestly rather than the best run. Documented in [task1_report §5.4](docs/analysis/task1_report.md).
2. **Task 2 L3 is conservative** — boundary IoU threshold of 500 chars over a 12 KB chunk is tight. It currently provides arbitration, not aggressive replacement. This is by design ("no silent override") but means hard cases get quarantined rather than fixed by L3.
3. **Confidence calibration uses synthetic labels** (rule-based bootstrap from the eval baseline). ECE 0.056 is good but should be re-validated against ~20 human-graded examples for true production deployment. The `labels.provenance.json` sidecar makes this honest.
4. **One known failure case** (MSFT FY2015 Item 8) — pre-iXBRL filing incorporates Item 8 entirely by reference. System correctly quarantines rather than fabricates. Documented on the [Task 2 capability matrix](https://your-deployment.example.com/dashboard#task2-capabilities).
5. **No CAPTCHA / Cloudflare / authenticated-session handling** in Task 1. Compliance choice; agent always escalates.
6. **In-memory job stores** for live (non-eval) jobs. After a backend redeploy, in-flight job IDs return 404 from the inspector. PRODUCTION_HARDENING_ROADMAP Week 2 (Alembic + persistent stores) addresses this.
7. **Cross-year consistency check** (the fourth confidence signal in PLAN §3.5 w₄) is designed but not implemented. Requires multi-year ingest pipeline; planned in roadmap.
8. **No human-in-the-loop review queue** for quarantined Task 2 extractions yet — they are flagged but not assignable. Planned in roadmap Week 7.

---

## 🛣 Where to take this next

[`docs/spec/PRODUCTION_HARDENING_ROADMAP.md`](docs/spec/PRODUCTION_HARDENING_ROADMAP.md) is the 8-week, 30-PR working spec for taking this from its current build to a system a professional quantitative firm could adopt. Each PR has a goal, deliverables list, and acceptance criteria; the roadmap also commits to 12 binary criteria for "production-ready" and 8 SLOs to negotiate with customers once Week 6 lands.

**Week 4 (CI eval gate, PR-401) has already landed** as proof the roadmap is real, not aspirational. The next PR per the roadmap is Week 1 PR-101: API key authentication via FastAPI middleware.
