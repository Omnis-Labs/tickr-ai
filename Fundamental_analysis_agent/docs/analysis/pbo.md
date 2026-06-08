# Probability of Backtest Overfitting (PBO)

> **Method.** Bailey, Borwein, López de Prado & Zhu (2014), *The Probability of Backtest
> Overfitting*, via Combinatorially-Symmetric Cross-Validation (CSCV). Split the track record into
> S=16 chunks; over all C(16,8)=12,870 symmetric in-sample/out-of-sample partitions, ask how often
> the strategy that looks **best in sample** falls **below the median out of sample**. PBO ≈ 0.5 means
> "the winning backtest is a coin-flip" — no persistent edge.

Universe = the 11 placebo controls' trials (system × signal × ticker), weekly returns, same
lookahead-free backtest as everywhere else.

## Headline: per-ticker timing PBO = **0.52**

Holding the **stock fixed** so that only the divination *timing rule* varies removes the
cross-name confound. The result is the clean coin-flip:

| | PBO | reading |
|---|--:|---|
| **Per-ticker timing PBO (median across 12 names)** | **0.52** | selecting the best in-sample timing rule overfits ~half the time → **no persistent timing skill** |

Per-name spread: JNJ 0.10, WMT 0.18, PG 0.37, JPM 0.38, XOM 0.44, GOOGL 0.47, KO 0.52, AAPL 0.54,
NVDA 0.55, MSFT 0.56, AMZN 0.62, META 0.71 — scattered around 0.5, exactly as a skill-less timing
rule should be.

## Why the *pooled* number looks deceptively good (and why that's a trap)

| Pooled across all names | PBO |
|---|--:|
| raw returns | 0.38 |
| market-excess (active) returns | 0.18 |

Both are well below 0.5 — but **not because of skill**. When you pool 12 names, the "best in-sample"
strategy is usually just *the one that held the name that won* (NVDA +432%). NVDA kept beating the
market across the **entire** 2023–26 window, so that pick persists out-of-sample for free. That is
**selection / momentum persistence, not timing skill** — and it is precisely the confound per-ticker
PBO removes. *A naïve PBO run on a multi-name universe will understate overfitting in a trending
market* — a subtlety worth flagging, because most published PBO numbers don't control for it.

## The pitch takeaway

> *"We don't just deflate the Sharpe — we measure the probability that the winning backtest is itself
> overfit. On a like-for-like basis (timing rule, name held fixed) that probability is 0.52: a coin
> flip. And we show why the naïve pooled number (0.18) flatters itself — it's NVDA persistence, not
> skill. This is the discipline a strategy must survive before it earns capital."*

Combined with the Deflated Sharpe gate and the regime test, PBO closes the overfitting story:
**DSR** asks "is this Sharpe beyond the best of N flukes?", **PBO** asks "does the *selection* itself
survive out of sample?", and the **regime split** asks "does any of it hold in a tape we didn't fit?"

---
*Reproduce:* `python tools/pbo.py --chunks 16` → `shared/reports/pbo.json`.
*Bear regime:* add `--start 2022-01-01 --end 2022-12-31`.
