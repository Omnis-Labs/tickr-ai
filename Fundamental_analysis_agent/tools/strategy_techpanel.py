"""5-year backtest of every price/market-runnable strategy over a big-tech panel.

For each strategy we run its PRIMARY (intended) entry signal — "entering under the right
assumptions" — over AAPL/MSFT/NVDA/GOOGL/META/AMZN for the trailing 5 years, lookahead-free,
10 bps costs, vs S&P 500 (SPY). We then average across the six names and report how much each
strategy beat the market (alpha = strategy total return − SPY total return, in percentage points).

Runnable on price/market data only (the rest need external per-name pipelines — 10-K/13F/Form4/
8-K/congress/short-interest — and are listed as such in the doc):
  • 11 placebo controls (T25–T35)  • T14 volatility  • T19 anomaly  • T20 vix
Plus a buy-and-hold reference per name.

Output: docs/analysis/strategy_techpanel.private.csv (gitignored). Prints a per-strategy summary.

    python -m tools.strategy_techpanel
"""
from __future__ import annotations

import asyncio
import csv
import statistics as st
from datetime import date, timedelta
from pathlib import Path

from shared.cost_ledger import init_db
from task3_strategy.pipeline.prices import fetch_prices
from task17_quality.pipeline.backtest import run_factor_backtest
from tools.divination_null_band import _control_signals, _listing, _MIN_BARS

_ROOT = Path(__file__).resolve().parents[1]
_CSV = _ROOT / "docs" / "analysis" / "strategy_techpanel.private.csv"
PANEL = ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN"]
YEARS = 5


def _rec(strategy, signal, tk, m):
    return {"strategy": strategy, "signal": signal, "ticker": tk,
            "total_return_pct": round(m.total_return_pct, 1),
            "sharpe": round(m.sharpe, 2),
            "alpha_vs_spy_pp": round(m.excess_vs_market_pct, 1) if m.excess_vs_market_pct is not None else None,
            "exposure_pct": round(m.exposure_pct, 1), "n_trades": m.n_trades}


async def main():
    await init_db()
    spy = await asyncio.to_thread(fetch_prices, "SPY")

    from task19_anomaly.pipeline.signals import make_want_long as t19_wl
    from task19_anomaly.schemas import AnomalySpec
    from task20_vix.pipeline.signals import build_vix_map, make_want_long as t20_wl
    from task20_vix.schemas import VixSpec
    from task14_volatility.pipeline.backtest import run_vol_backtest
    from task14_volatility.schemas import VolSpec
    # SEC-data agents (Tier B) — resolve CIK once
    from task2_10k_extractor.eval.edgar_lookup import fetch_sec_ticker_map
    tmap = await fetch_sec_ticker_map()
    try:
        vix = await asyncio.to_thread(fetch_prices, "^VIX")
        vix3m = await asyncio.to_thread(fetch_prices, "^VIX3M")
        vix_map = build_vix_map(vix, vix3m)
    except Exception:  # noqa: BLE001
        vix_map = {}

    rows: list[dict] = []
    spy_ret_by_window = []
    for tk in PANEL:
        try:
            prices = await asyncio.to_thread(fetch_prices, tk)
        except Exception:  # noqa: BLE001
            continue
        if len(prices) < _MIN_BARS:
            continue
        as_of = prices[-1].date
        start = max(prices[0].date, as_of - timedelta(days=365 * YEARS))
        dates = [p.date for p in prices if p.date >= start]
        listing = await asyncio.to_thread(_listing, tk, prices[0].date)

        # buy & hold reference for this name
        bh = run_factor_backtest(prices, lambda d: True, start=start, exit_mode="hold", market_prices=spy)
        rows.append(_rec("(buy & hold the stock)", "always-in", tk, bh.metrics))
        if bh.metrics.excess_vs_market_pct is not None:
            spy_ret_by_window.append(bh.metrics.total_return_pct - bh.metrics.excess_vs_market_pct)

        def factor(strategy, signal, wl):
            try:
                bt = run_factor_backtest(prices, wl, start=start, exit_mode="deteriorating",
                                         transaction_cost_bps=10.0, market_prices=spy)
                rows.append(_rec(strategy, signal, tk, bt.metrics))
            except Exception:  # noqa: BLE001
                pass

        factor("T19 anomaly", "near_52w_high", t19_wl(AnomalySpec(entry_signal="near_52w_high"), prices))
        if vix_map:
            factor("T20 vix", "vix_term_gate", t20_wl(VixSpec(entry_signal="vix_term_gate"), vix_map))

        # price-only agents with their own backtest engines (no external data)
        def custom(strategy, signal, fn):
            try:
                r = fn()
                rows.append(_rec(strategy, signal, tk, r.metrics))
            except Exception:  # noqa: BLE001
                pass
        from task14_volatility.schemas import VolSpec as _VS
        custom("T14 volatility", "trend_and_calm",
               lambda: run_vol_backtest(prices, _VS(entry_signal="trend_and_calm"), start=start, market_prices=spy))
        from task12_seasonality.pipeline.backtest import run_seasonal_backtest
        from task12_seasonality.schemas import SeasonalSpec
        custom("T12 seasonality", "turn_of_month",
               lambda: run_seasonal_backtest(prices, SeasonalSpec(entry_signal="turn_of_month"), start=start, market_prices=spy))
        from task13_overnight.pipeline.backtest import run_gap_backtest
        from task13_overnight.schemas import GapSpec
        custom("T13 overnight", "overnight",
               lambda: run_gap_backtest(prices, GapSpec(entry_signal="overnight"), start=start, market_prices=spy))
        from task7_relative.pipeline.backtest import run_relative_backtest
        from task7_relative.schemas import RelativeSpec
        custom("T7 relative", "rs_uptrend",
               lambda: run_relative_backtest(prices, spy, RelativeSpec(entry_signal="rs_uptrend"), start=start, market_prices=spy))

        # ---- Tier B: SEC-data agents (CIK-resolved, deterministic data → backtest) ----
        cik = tmap.get(tk)
        if cik:
            try:  # T15 buyback — share-count trend from XBRL companyfacts
                from task15_buyback.pipeline.signals import extract_shares, fetch_companyfacts as _cf15
                from task15_buyback.pipeline.backtest import run_buyback_backtest
                from task15_buyback.schemas import BuybackSpec
                shares = extract_shares(await _cf15(cik))
                r = run_buyback_backtest(prices, shares, BuybackSpec(entry_signal="buyback"), start=start, market_prices=spy)
                rows.append(_rec("T15 buyback", "buyback", tk, r.metrics))
            except Exception:  # noqa: BLE001
                pass
            try:  # T17 quality — composite quality factor from companyfacts
                from task17_quality.pipeline.factors import build_bundle, wants_long, fetch_companyfacts as _cf17
                from task17_quality.schemas import QualitySpec
                bundle = build_bundle(await _cf17(cik))
                qspec = QualitySpec(entry_signal="composite_quality")
                r = run_factor_backtest(prices, lambda d: wants_long(qspec, bundle, d), start=start,
                                        exit_mode="deteriorating", transaction_cost_bps=10.0, market_prices=spy)
                rows.append(_rec("T17 quality", "composite_quality", tk, r.metrics))
            except Exception:  # noqa: BLE001
                pass
            try:  # T11 fundamentals trend — quarterly XBRL growth/margin
                from task11_fundamentals_trend.pipeline.companyfacts import extract_quarters, fetch_companyfacts as _cf11
                from task11_fundamentals_trend.pipeline.backtest import run_fundtrend_backtest
                from task11_fundamentals_trend.schemas import FundTrendSpec
                quarters = extract_quarters(await _cf11(cik))
                r = run_fundtrend_backtest(prices, quarters, FundTrendSpec(entry_signal="growth_and_margin"), start=start, market_prices=spy)
                rows.append(_rec("T11 fundtrend", "growth_and_margin", tk, r.metrics))
            except Exception:  # noqa: BLE001
                pass
            try:  # T6 insider — Form 4 cluster buys
                from task6_insider.pipeline.forms import fetch_form4_txns
                from task6_insider.pipeline.backtest import run_insider_backtest
                from task6_insider.schemas import InsiderSpec
                txns, _, _ = await fetch_form4_txns(cik, since=start - timedelta(days=365), max_filings=60)
                r = run_insider_backtest(prices, txns, InsiderSpec(entry_signal="cluster_buy"), start=start, market_prices=spy)
                rows.append(_rec("T6 insider", "cluster_buy", tk, r.metrics))
            except Exception:  # noqa: BLE001
                pass
            try:  # T8 earnings — 8-K beats (LLM classifies releases → events)
                from task8_earnings.pipeline.filings import fetch_earnings_releases
                from task8_earnings.pipeline.classify import classify_events
                from task8_earnings.pipeline.backtest import run_earnings_backtest
                from task8_earnings.schemas import EarningsSpec
                releases, _ = await fetch_earnings_releases(cik, since=start - timedelta(days=120), max_filings=24)
                events = await classify_events(trace_id=f"tp-{tk}", ticker=tk, releases=releases, budget_usd=0.05) if releases else []
                r = run_earnings_backtest(prices, events, EarningsSpec(entry_signal="beat"), start=start, market_prices=spy)
                rows.append(_rec("T8 earnings", "beat", tk, r.metrics))
            except Exception:  # noqa: BLE001
                pass
            try:  # T18 events — activist/red-flag drift (LLM extracts events)
                from task18_events.pipeline.events import fetch_events, make_want_long as t18_wl
                from task18_events.schemas import EventSpec
                records, bundle = await fetch_events(cik, since=start - timedelta(days=180), trace_id=f"tp-{tk}", ticker=tk, budget_usd=0.05)
                r = run_factor_backtest(prices, t18_wl(EventSpec(entry_signal="activist_drift"), bundle), start=start,
                                        exit_mode="deteriorating", transaction_cost_bps=10.0, market_prices=spy)
                rows.append(_rec("T18 events", "activist_drift", tk, r.metrics))
            except Exception:  # noqa: BLE001
                pass

        # ---- best-effort: provider-data agents (skip if no coverage for the name) ----
        try:  # T16 short — FINRA short-volume / NASDAQ short-interest squeeze
            from task16_short.pipeline.finra import fetch_short_volume_series
            from task16_short.pipeline.short_interest import fetch_short_interest_series
            from task16_short.pipeline.backtest import run_short_backtest
            from task16_short.schemas import ShortSpec
            svr, si_series = await asyncio.gather(
                fetch_short_volume_series(tk, since=start - timedelta(days=30), as_of=as_of),
                fetch_short_interest_series(tk))
            if svr or si_series:
                r = run_short_backtest(prices, svr, ShortSpec(entry_signal="squeeze"), start=start,
                                       market_prices=spy, si_series=si_series)
                rows.append(_rec("T16 short", "squeeze", tk, r.metrics))
        except Exception:  # noqa: BLE001
            pass
        try:  # T22 congress — follow lawmaker buys (free House PTR)
            from task22_congress.pipeline.congress_data import fetch_congress_trades
            from task22_congress.pipeline.signals import make_want_long as t22_wl, split_dates
            from task22_congress.schemas import CongressSpec
            trades, _prov = await fetch_congress_trades(tk, since=start - timedelta(days=180), as_of=as_of)
            if trades:
                r = run_factor_backtest(prices, t22_wl(CongressSpec(entry_signal="follow_buys"), split_dates(trades)),
                                        start=start, exit_mode="deteriorating", transaction_cost_bps=10.0, market_prices=spy)
                rows.append(_rec("T22 congress", "follow_buys", tk, r.metrics))
        except Exception:  # noqa: BLE001
            pass
        # 11 controls — each system's primary (first) signal
        for system, sigs in _control_signals(listing, dates):
            label, wl = sigs[0]
            factor(system, label.split("#")[0], wl)

    # write full CSV
    _CSV.parent.mkdir(parents=True, exist_ok=True)
    with _CSV.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["strategy", "signal", "ticker", "total_return_pct",
                                          "sharpe", "alpha_vs_spy_pp", "exposure_pct", "n_trades"])
        w.writeheader()
        w.writerows(rows)

    # per-strategy summary
    by_strat: dict[str, list[dict]] = {}
    for r in rows:
        by_strat.setdefault(r["strategy"], []).append(r)
    spy_ret = round(st.mean(spy_ret_by_window), 1) if spy_ret_by_window else None
    summary = []
    for strat, rs in by_strat.items():
        a = [r["alpha_vs_spy_pp"] for r in rs if r["alpha_vs_spy_pp"] is not None]
        summary.append({
            "strategy": strat, "signal": rs[0]["signal"], "n": len(rs),
            "avg_return_pct": round(st.mean(r["total_return_pct"] for r in rs), 1),
            "avg_sharpe": round(st.mean(r["sharpe"] for r in rs), 2),
            "avg_alpha_vs_spy_pp": round(st.mean(a), 1) if a else None,
            "avg_exposure_pct": round(st.mean(r["exposure_pct"] for r in rs), 0),
            "win_rate_vs_spy": round(sum(1 for x in a if x > 0) / len(a), 2) if a else None,
        })
    summary.sort(key=lambda s: -(s["avg_alpha_vs_spy_pp"] or -999))

    print(f"\n5y tech-panel ({'/'.join(PANEL)}) · SPY same-window return ≈ {spy_ret}% · alpha = strategy − SPY (pp)\n")
    print(f"{'strategy':26}{'signal':16}{'ret%':>7}{'Sharpe':>8}{'αvsSPY':>8}{'expo%':>7}{'win':>6}")
    for s in summary:
        print(f"{s['strategy']:26}{s['signal']:16}{s['avg_return_pct']:>7}{s['avg_sharpe']:>8}"
              f"{str(s['avg_alpha_vs_spy_pp']):>8}{str(s['avg_exposure_pct']):>7}{str(s['win_rate_vs_spy']):>6}")
    print(f"\nrows: {len(rows)} · written {_CSV}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
