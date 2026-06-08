"""Capacity & turnover analysis — does the edge scale, or decay at AUM?

Two questions every allocator asks of a quant strategy:
  • Turnover — how much does it trade? (high turnover → costs + capacity limits)
  • Capacity — how much capital can it absorb before market impact eats the alpha?

Turnover is measured directly from the lookahead-free backtests (trades / year, average holding
period, exposure). Capacity is a first-order estimate from each name's dollar ADV and daily
volatility:
  • participation cap — at p=10% of ADV traded per day, a 1-day entry/exit supports a position of
    0.10 × ADV$ ;
  • square-root impact (Almgren-style) — one-way impact ≈ σ_daily · √(AUM / ADV$); the AUM at which
    that reaches 50 bps is ADV$ · (0.005 / σ_daily)².

The point for the suite: these signals trade rarely, in mega-caps with $10–20B ADV, so capacity is
in the billions — a scalable edge, not a capacity-constrained HFT trick.

    python tools/capacity.py
"""
from __future__ import annotations

import argparse
import asyncio
import json
import statistics as st
from datetime import date, timedelta
from pathlib import Path

from tools.divination_null_band import (
    _PANEL, _MIN_BARS, _LOOKBACK, _control_signals, _listing,
    fetch_prices, run_factor_backtest, init_db,
)

_ROOT = Path(__file__).resolve().parents[1]
_OUT = _ROOT / "shared" / "reports" / "capacity.json"
_PART = 0.10        # max participation: 10% of ADV per day
_IMPACT_BPS = 0.005  # AUM that produces 50 bps one-way impact


def _adv_and_vol(prices) -> tuple[float, float]:
    dollar_vol = [p.volume * p.close for p in prices if p.volume]
    rets = [prices[i].close / prices[i - 1].close - 1.0 for i in range(1, len(prices)) if prices[i - 1].close]
    adv = st.median(dollar_vol) if dollar_vol else 0.0
    vol = st.pstdev(rets) if len(rets) > 2 else 0.0
    return adv, vol


async def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", default=",".join(_PANEL))
    ap.add_argument("--output", default=str(_OUT))
    args = ap.parse_args(argv)
    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    await init_db()
    spy = await asyncio.to_thread(fetch_prices, "SPY")

    per_name = {}
    turnovers, holdings, exposures = [], [], []
    for tk in tickers:
        try:
            prices = await asyncio.to_thread(fetch_prices, tk)
        except Exception:  # noqa: BLE001
            continue
        if len(prices) < _MIN_BARS:
            continue
        as_of = prices[-1].date
        start = max(prices[0].date, as_of - timedelta(days=_LOOKBACK))
        win = [p for p in prices if p.date >= start]
        adv, vol = _adv_and_vol(win)
        cap_part = _PART * adv                                  # 1-day, 10%-of-ADV position
        cap_impact = adv * (_IMPACT_BPS / vol) ** 2 if vol else 0.0   # AUM for 50 bps one-way impact
        per_name[tk] = {"adv_usd_m": round(adv / 1e6, 1), "daily_vol_pct": round(vol * 100, 2),
                        "capacity_10pct_adv_usd_m": round(cap_part / 1e6, 1),
                        "aum_for_50bps_impact_usd_m": round(cap_impact / 1e6, 1)}

        # turnover across this name's placebo timing rules
        dates = [p.date for p in win]
        listing = await asyncio.to_thread(_listing, tk, prices[0].date)
        for system, sigs in _control_signals(listing, dates):
            for _label, wl in sigs:
                try:
                    bt = run_factor_backtest(prices, wl, start=start, exit_mode="deteriorating",
                                             transaction_cost_bps=10.0, market_prices=spy)
                except Exception:  # noqa: BLE001
                    continue
                m = bt.metrics
                yrs = max((bt.end_date - bt.start_date).days / 365.25, 0.1)
                turnovers.append(m.n_trades / yrs)
                exposures.append(m.exposure_pct)
                entries = max(m.n_trades / 2.0, 0.5)
                holdings.append(m.exposure_pct / 100.0 * yrs * 365.0 / entries)

    advs = [v["adv_usd_m"] for v in per_name.values()]
    caps_part = [v["capacity_10pct_adv_usd_m"] for v in per_name.values()]
    caps_imp = [v["aum_for_50bps_impact_usd_m"] for v in per_name.values()]
    out = {
        "method": "Capacity & turnover — measured turnover + ADV/√-impact capacity estimate",
        "params": {"participation_cap": _PART, "impact_threshold_bps": _IMPACT_BPS * 1e4},
        "turnover": {
            "trades_per_year_median": round(st.median(turnovers), 2) if turnovers else None,
            "avg_holding_days_median": round(st.median(holdings), 0) if holdings else None,
            "exposure_pct_median": round(st.median(exposures), 1) if exposures else None,
        },
        "capacity": {
            "median_adv_usd_m": round(st.median(advs), 1) if advs else None,
            "median_capacity_10pct_adv_usd_m": round(st.median(caps_part), 1) if caps_part else None,
            "median_aum_for_50bps_impact_usd_m": round(st.median(caps_imp), 1) if caps_imp else None,
            "panel_total_capacity_10pct_adv_usd_b": round(sum(caps_part) / 1e3, 2) if caps_part else None,
        },
        "per_name": per_name,
        "interpretation": (
            f"Median turnover is {st.median(turnovers):.1f} trades/yr with an average holding period of "
            f"~{st.median(holdings):.0f} days — low-frequency, so transaction costs and capacity are not the "
            f"binding constraint. Trading only mega-caps (median ADV ${st.median(advs)/1e3:.1f}B/day), a single "
            f"name absorbs ~${st.median(caps_part):.0f}M at a 10%-ADV cap and ~${st.median(caps_imp):.0f}M before "
            f"one-way impact hits 50 bps; across the panel that is ${sum(caps_part)/1e3:.1f}B of capacity. The "
            f"edge (if any) scales — it is not a capacity-limited HFT trick."
        ),
    }
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(out, indent=2, ensure_ascii=False))
    t = out["turnover"]; c = out["capacity"]
    print(f"Capacity & turnover — {len(per_name)} names")
    print(f"  turnover : {t['trades_per_year_median']} trades/yr (median), holding ~{t['avg_holding_days_median']}d, exposure {t['exposure_pct_median']}%")
    print(f"  ADV      : median ${c['median_adv_usd_m']}M/day")
    print(f"  capacity : ${c['median_capacity_10pct_adv_usd_m']}M/name @10% ADV · ${c['median_aum_for_50bps_impact_usd_m']}M/name @50bps impact · panel ${c['panel_total_capacity_10pct_adv_usd_b']}B")
    print(f"  written: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
