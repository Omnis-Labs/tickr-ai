# Capacity & turnover — does the edge scale?

> **Why it matters.** A backtest Sharpe is worthless if the strategy can only run $5M before its own
> trading moves the price, or if it churns so fast that costs eat the edge. Allocators size a fund by
> *capacity*, not by Sharpe. So we measure both.

- **Turnover** — measured directly from the lookahead-free backtests (trades/yr, holding period, exposure).
- **Capacity** — first-order estimate from each name's dollar ADV and daily volatility:
  participation cap (10% of ADV/day) and a square-root impact model (one-way impact ≈ σ·√(AUM/ADV$);
  the AUM at which that hits 50 bps).

## Result: low-frequency, mega-cap, billions of capacity

| Turnover (median across placebo timing rules) | |
|---|--:|
| Trades / year | **3.3** |
| Avg holding period | **~1 month** |
| Time in market (exposure) | 55% |

| Capacity (median per name; panel = 12 mega-caps) | |
|---|--:|
| Dollar ADV | **$3.5B / day** |
| Position at 10%-of-ADV cap (1-day) | **$347M / name** |
| AUM before one-way impact hits 50 bps | **$302M / name** |
| **Panel total capacity (10% ADV)** | **~$7.8B** |

## Read

The signals **trade rarely** (≈3 round-trip decisions a year, holding for weeks) and only in the most
liquid names on the market ($3.5B median daily volume). So transaction cost and market impact are
**not** the binding constraint: a single name absorbs a few hundred $M before impact is even 50 bps,
and the 12-name panel carries **~$7.8B** of capacity at a conservative 10%-of-ADV participation cap.

This is the scalability story: *whatever edge survives the DSR / PBO / factor gates is a low-turnover,
high-capacity edge — it can take institutional capital, not a thin HFT anomaly that evaporates past a
few million.* (Turnover here is the placebo timing rules' — the real agents inherit the same monthly,
mega-cap-only cadence, so the capacity envelope carries over.)

## The pitch takeaway

> *"It trades ~3 times a year in names with billions in daily volume — capacity is in the billions, not
> the millions. If we find an edge, it scales to a real fund. We're not selling a capacity-1 anomaly."*

---
*Reproduce:* `python tools/capacity.py` → `shared/reports/capacity.json` (per-name ADV, vol, capacity).
*Caveat: a first-order liquidity model (participation cap + square-root impact), not a calibrated
execution sim — directional capacity, deliberately conservative.*
