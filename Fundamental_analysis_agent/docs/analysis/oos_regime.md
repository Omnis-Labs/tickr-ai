# Out-of-Sample regime test — the noise floor is not a constant

> **Claim under test.** A significance threshold calibrated on one regime (the 2023–26 bull) is
> meaningless in another. We re-ran the *identical* 11-placebo null band on the **2022 bear**
> (SPY −18%) as an out-of-sample regime and compared.

Same 12-name panel, same 348 placebo trials, same lookahead-free backtest — only the window changed.

| Placebo null band | **2022 BEAR** | **2023–26 BULL** | what it means |
|---|--:|--:|---|
| Sharpe p50 (median fluke) | **−0.59** | **+0.47** | the noise floor **flips sign** with the regime |
| Sharpe p90 | 0.59 | 1.33 | |
| Sharpe p95 (the "bar") | **1.23** | **1.42** | the significance threshold itself moves ~15% |
| Sharpe max (luckiest fluke) | **2.70** | 1.95 | a bear has *more* dispersion — bigger lucky outliers |
| **alpha vs SPY, p50** | **+5.1%** | **−58.2%** | **sign flip** (see below) |
| alpha vs SPY, p95 | 47.6% | 105.5% | |

## Two regime-dependent truths a fixed Sharpe threshold hides

**1. The Sharpe noise floor is not a constant — it tracks beta.** In the bull, a long-biased random
timer rides the equity premium → median fluke Sharpe **+0.47**. In the bear, the same random timer is
long into a falling market → median fluke Sharpe **−0.59**. *A strategy showing Sharpe 1.0 is
unremarkable in the bull but would look stellar in the bear* — so you cannot judge a Sharpe without
naming the regime it was measured in. This is why we deflate (DSR), and why the bar must be
**re-estimated per regime**, never hard-coded.

**2. Alpha-vs-SPY flips sign — and that's the whole "is it beta or skill?" point.** In the bull,
"divine timing" *forfeits* the equity premium by sitting out good days → median alpha **−58%**. In the
bear, sitting out *dodges* losses → median alpha **+5%**, i.e. the average placebo **beats** a falling
market simply by being flat part of the time. Neither is skill: it's the mechanical payoff of partial
market exposure, which is positive when the market falls and negative when it rises. A real edge has
to clear the bar **in both regimes**, on alpha, not just post a bull-market Sharpe.

## The pitch takeaway

> *"Most backtests are run on the 2023–26 bull and quote a Sharpe. We show the exact same worthless
> signals score Sharpe +0.47 in that bull and −0.59 in the 2022 bear — the 'impressive' number is
> mostly which regime you measured in. Our significance bar is re-estimated per regime; a candidate
> edge must clear it in both."*

This is the robustness story diligence asks for: it demonstrates we test out-of-sample, that we
understand *why* a Sharpe inflates, and that our gate adapts instead of overfitting to one tape.

---
*Reproduce:*
```
python -m tools.divination_null_band --start 2022-01-01 --end 2022-12-31 \
    --output shared/reports/null_band_2022bear.json   # bear test set
python -m tools.divination_null_band                  # trailing bull (default)
```
*Artifacts: `shared/reports/null_band_2022bear.json`, `shared/reports/divination_null_band.json`.*
