"""The 'trade on signal, else hold the market' timing backtest.

Product thesis (user): an unlocked agent should NOT sit in cash when it has no signal — in a bull
that just forfeits the equity premium (which is why every agent underperformed SPY). Instead:
hold SPY by default, and switch into the agent's trade only when its signal fires.

For each agent's primary signal we compute three paths on the tech panel (5y, lookahead-free, 10bps):
  • CASH idle  — long the stock when want_long(d), else CASH (the original behaviour).
  • SPY  idle  — long the stock when want_long(d), else hold SPY  (the product fix).
  • references — buy&hold the stock, buy&hold SPY.

The SPY-idle path's alpha vs SPY is the signal's PURE timing edge (the cash drag removed): ≈0 for a
worthless signal (you just match the market), >0 only if the signal times entries well.

Output: docs/analysis/signal_or_market.private.csv (gitignored). Prints a per-agent summary.

    python -m tools.signal_or_market
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import math
import statistics as st
from datetime import date, timedelta
from pathlib import Path

from shared.cost_ledger import init_db
from task3_strategy.pipeline.prices import fetch_prices
from tools.divination_null_band import _control_signals, _listing, _MIN_BARS

_ROOT = Path(__file__).resolve().parents[1]
_CSV = _ROOT / "docs" / "analysis" / "signal_or_market.private.csv"
PANEL = ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN"]
YEARS = 5
TXN = 0.001   # 10 bps per switch


def _path(dates, want_long, stock_rets, spy_rets, idle_spy: bool):
    """Cumulative return of: stock when signal (known at prior close), else SPY-or-cash. 10bps on switch."""
    equity = 1.0
    daily = []
    prev_pos = None
    for i in range(1, len(dates)):
        in_stock = want_long(dates[i - 1])                  # signal as of prior close → applied to day i
        pos = "stock" if in_stock else ("spy" if idle_spy else "cash")
        r = stock_rets[i] if in_stock else (spy_rets[i] if idle_spy else 0.0)
        if prev_pos is not None and pos != prev_pos:
            r -= TXN
        equity *= (1.0 + r)
        daily.append(r)
        prev_pos = pos
    total = (equity - 1.0) * 100.0
    sharpe = (st.mean(daily) / st.pstdev(daily) * math.sqrt(252)) if len(daily) > 2 and st.pstdev(daily) > 0 else 0.0
    frac = sum(1 for i in range(1, len(dates)) if want_long(dates[i - 1])) / max(1, len(dates) - 1)
    return total, sharpe, frac * 100.0


async def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--idle", default="SPY", help="asset held when no signal (the 'market floor'); e.g. SPY, QQQ")
    ap.add_argument("--tickers", default=",".join(PANEL))
    args = ap.parse_args(argv)
    panel = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    await init_db()
    spy = await asyncio.to_thread(fetch_prices, "SPY")           # benchmark for alpha (the market)
    spy_by_date = {p.date: p.close for p in spy}
    idle_by_date = spy_by_date if args.idle.upper() == "SPY" else {
        p.date: p.close for p in await asyncio.to_thread(fetch_prices, args.idle.upper())}
    from task19_anomaly.pipeline.signals import make_want_long as t19_wl
    from task19_anomaly.schemas import AnomalySpec
    from task20_vix.pipeline.signals import build_vix_map, make_want_long as t20_wl
    from task20_vix.schemas import VixSpec
    try:
        vmap = build_vix_map(await asyncio.to_thread(fetch_prices, "^VIX"), await asyncio.to_thread(fetch_prices, "^VIX3M"))
    except Exception:  # noqa: BLE001
        vmap = {}

    rows = []
    for tk in panel:
        prices = await asyncio.to_thread(fetch_prices, tk)
        if len(prices) < _MIN_BARS:
            continue
        as_of = prices[-1].date
        start = max(prices[0].date, as_of - timedelta(days=365 * YEARS))
        win = [p for p in prices if p.date >= start and p.date in spy_by_date and p.date in idle_by_date]
        dates = [p.date for p in win]
        sc = [p.close for p in win]
        spc = [spy_by_date[d] for d in dates]
        ic = [idle_by_date[d] for d in dates]
        srets = [0.0] + [sc[i] / sc[i - 1] - 1 for i in range(1, len(sc))]
        prets = [0.0] + [spc[i] / spc[i - 1] - 1 for i in range(1, len(spc))]   # SPY (benchmark)
        irets = [0.0] + [ic[i] / ic[i - 1] - 1 for i in range(1, len(ic))]      # idle asset (floor)
        spy_total = (math.prod(1 + r for r in prets) - 1) * 100.0
        listing = await asyncio.to_thread(_listing, tk, prices[0].date)

        agents = [(s, sigs[0][0], sigs[0][1]) for s, sigs in _control_signals(listing, dates)]
        agents.append(("T19 anomaly", "near_52w_high", t19_wl(AnomalySpec(entry_signal="near_52w_high"), prices)))
        if vmap:
            agents.append(("T20 vix", "vix_term_gate", t20_wl(VixSpec(entry_signal="vix_term_gate"), vmap)))

        for name, sig, wl in agents:
            try:
                ct, cs, frac = _path(dates, wl, srets, irets, idle_spy=False)   # idle=cash
                mt, ms, _ = _path(dates, wl, srets, irets, idle_spy=True)        # idle=floor asset
                rows.append({"agent": name, "signal": sig.split("#")[0], "ticker": tk,
                             "cash_total_pct": round(ct, 1), "cash_alpha_pp": round(ct - spy_total, 1),
                             "spy_total_pct": round(mt, 1), "spy_alpha_pp": round(mt - spy_total, 1),
                             "spy_sharpe": round(ms, 2), "frac_in_stock_pct": round(frac, 0)})
            except Exception:  # noqa: BLE001
                pass

    _CSV.parent.mkdir(parents=True, exist_ok=True)
    with _CSV.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["agent", "signal", "ticker", "cash_total_pct", "cash_alpha_pp",
                                          "spy_total_pct", "spy_alpha_pp", "spy_sharpe", "frac_in_stock_pct"])
        w.writeheader(); w.writerows(rows)

    by = {}
    for r in rows:
        by.setdefault(r["agent"], []).append(r)
    summary = []
    for a, rs in by.items():
        summary.append({"agent": a, "signal": rs[0]["signal"],
                        "cash_alpha": round(st.mean(r["cash_alpha_pp"] for r in rs), 1),
                        "spy_alpha": round(st.mean(r["spy_alpha_pp"] for r in rs), 1),
                        "spy_sharpe": round(st.mean(r["spy_sharpe"] for r in rs), 2),
                        "frac": round(st.mean(r["frac_in_stock_pct"] for r in rs), 0)})
    summary.sort(key=lambda s: -s["spy_alpha"])
    floor = args.idle.upper()
    print(f"\nIdle=CASH vs idle={floor} · {len(panel)} names 5y · alpha vs SPY (pp). {floor}-idle alpha = signal edge over just holding the floor.\n")
    print(f"{'agent':22}{'signal':16}{'CASHalpha':>11}{floor+'alpha':>10}{floor+'sharpe':>11}{'in-stock%':>11}")
    for s in summary:
        print(f"{s['agent']:22}{s['signal']:16}{s['cash_alpha']:>11}{s['spy_alpha']:>10}{s['spy_sharpe']:>11}{str(s['frac']):>11}")
    pos = [s for s in summary if s["spy_alpha"] > 0]
    print(f"\nidle={floor} beats market (alpha>0): {len(pos)}/{len(summary)} agents")
    print(f"avg CASH-idle alpha {st.mean(s['cash_alpha'] for s in summary):+.1f}pp  →  avg {floor}-idle alpha {st.mean(s['spy_alpha'] for s in summary):+.1f}pp")
    print(f"written {_CSV}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
