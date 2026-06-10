"""Backtest the 7 structurally-different agents via their OWN pipelines (LLM-picked).

These don't fit the fixed-primary-signal per-name table because they're either portfolio-level
(T21 ranker, T10 sizing), pair-level (T24 contagion), or LLM-strategy-driven (T3 fundamental,
T4 technical, T5 ensemble, T9 institutional). So we run each agent's real pipeline — the LLM picks
the strategy exactly as in production — and read its backtest metrics vs SPY.

  • per-ticker (avg over the tech panel): T3, T4, T5, T9
  • per-pair (avg):                       T24  (bellwether → peer)
  • whole-panel (one result):             T10, T21

Output: docs/analysis/strategy_techpanel_remaining.private.csv (gitignored). Uses LLM (cheap tier).

    python -m tools.agents_remaining
"""
from __future__ import annotations

import asyncio
import csv
import statistics as st
from pathlib import Path

from shared.cost_ledger import init_db

_ROOT = Path(__file__).resolve().parents[1]
_CSV = _ROOT / "docs" / "analysis" / "strategy_techpanel_remaining.private.csv"
PANEL = ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN"]
PAIRS = [("MSFT", "GOOGL"), ("GOOGL", "META"), ("AMZN", "MSFT")]   # bellwether → peer


def _m(bm):
    return {"total_return_pct": getattr(bm, "total_return_pct", None),
            "sharpe": getattr(bm, "sharpe", None),
            "alpha_vs_spy_pp": getattr(bm, "excess_vs_market_pct", None),
            "exposure_pct": getattr(bm, "exposure_pct", None) or getattr(bm, "avg_gross_exposure_pct", None)}


def _flush(rows):
    _CSV.parent.mkdir(parents=True, exist_ok=True)
    cols = ["group", "scope", "ticker", "total_return_pct", "sharpe", "alpha_vs_spy_pp", "exposure_pct", "error"]
    with _CSV.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader(); w.writerows(rows)


async def _one(label, runfn, tk, rows):
    try:
        res = await asyncio.wait_for(runfn(ticker=tk), timeout=150)
        d = _m(res.backtest.metrics); d["ticker"] = tk
        rows.append({"group": label, "scope": tk, **d})
        return d
    except Exception as e:  # noqa: BLE001
        rows.append({"group": label, "scope": tk, "error": type(e).__name__})
        return None


async def _per_ticker(label, runfn, rows):
    vals = await asyncio.gather(*[_one(label, runfn, tk, rows) for tk in PANEL])  # concurrent — IO-bound
    vals = [v for v in vals if v]
    _flush(rows)                       # incremental: never lose a completed group to a later timeout
    print(f"  [done] {label}: {len(vals)}/{len(PANEL)} names")
    return vals


def _avg(label, signal, vals, summary):
    a = [v["alpha_vs_spy_pp"] for v in vals if v.get("alpha_vs_spy_pp") is not None]
    if not vals:
        return
    summary.append({
        "strategy": label, "note": signal, "n": len(vals),
        "avg_return_pct": round(st.mean(v["total_return_pct"] for v in vals if v.get("total_return_pct") is not None), 1),
        "avg_sharpe": round(st.mean(v["sharpe"] for v in vals if v.get("sharpe") is not None), 2),
        "avg_alpha_vs_spy_pp": round(st.mean(a), 1) if a else None,
        "avg_exposure_pct": round(st.mean(v["exposure_pct"] for v in vals if v.get("exposure_pct") is not None), 0),
    })


async def main():
    await init_db()
    rows, summary = [], []

    # ---- whole-panel first (cheap: one LLM call each) ----
    from task10_portfolio.pipeline.orchestrator import run_portfolio_pipeline
    from task21_ranker.pipeline.orchestrator import run_rank_pipeline
    for label, runfn in [("T21 ranker", run_rank_pipeline), ("T10 portfolio", run_portfolio_pipeline)]:
        try:
            res = await asyncio.wait_for(runfn(tickers=PANEL), timeout=150)
            d = _m(res.metrics); d["ticker"] = "panel"
            rows.append({"group": label, "scope": "panel", **d})
            summary.append({"strategy": label, "note": "panel portfolio", "n": 1,
                            "avg_return_pct": round(d["total_return_pct"], 1) if d["total_return_pct"] is not None else None,
                            "avg_sharpe": round(d["sharpe"], 2) if d["sharpe"] is not None else None,
                            "avg_alpha_vs_spy_pp": round(d["alpha_vs_spy_pp"], 1) if d["alpha_vs_spy_pp"] is not None else None,
                            "avg_exposure_pct": round(d["exposure_pct"], 0) if d["exposure_pct"] is not None else None})
        except Exception as e:  # noqa: BLE001
            rows.append({"group": label, "scope": "panel", "error": type(e).__name__})
        _flush(rows); print(f"  [done] {label}")

    # ---- T24 contagion — per pair (concurrent) ----
    from task24_contagion.pipeline.orchestrator import run_contagion_pipeline
    async def _pair(bell, peer):
        try:
            res = await asyncio.wait_for(run_contagion_pipeline(bellwether=bell, peer=peer), timeout=150)
            d = _m(res.backtest.metrics); d["ticker"] = f"{bell}->{peer}"
            rows.append({"group": "T24 contagion", "scope": f"{bell}->{peer}", **d}); return d
        except Exception as e:  # noqa: BLE001
            rows.append({"group": "T24 contagion", "scope": f"{bell}->{peer}", "error": type(e).__name__}); return None
    cvals = [v for v in await asyncio.gather(*[_pair(b, p) for b, p in PAIRS]) if v]
    _avg("T24 contagion", "bellwether->peer", cvals, summary); _flush(rows); print("  [done] T24 contagion")

    # ---- per-ticker LLM agents (cheap → expensive; T3 10-K last) ----
    from task4_technical.pipeline.orchestrator import run_technical_pipeline
    from task5_ensemble.pipeline.orchestrator import run_ensemble_pipeline
    from task9_institutional.pipeline.orchestrator import run_institutional_pipeline
    from task3_strategy.pipeline.orchestrator import run_strategy_pipeline
    _avg("T4 technical", "LLM-picked", await _per_ticker("T4 technical", run_technical_pipeline, rows), summary)
    _avg("T5 ensemble", "LLM-picked", await _per_ticker("T5 ensemble", run_ensemble_pipeline, rows), summary)
    _avg("T9 institutional", "LLM-picked", await _per_ticker("T9 institutional", run_institutional_pipeline, rows), summary)
    _avg("T3 fundamental (10-K)", "LLM-picked", await _per_ticker("T3 fundamental", run_strategy_pipeline, rows), summary)

    summary.sort(key=lambda s: -(s["avg_alpha_vs_spy_pp"] if s["avg_alpha_vs_spy_pp"] is not None else -999))
    print(f"\nRemaining 7 agents — own pipelines (LLM-picked), tech panel · alpha vs SPY (pp)\n")
    print(f"{'strategy':26}{'note':18}{'ret%':>8}{'Sharpe':>8}{'αvsSPY':>8}{'expo%':>7}{'n':>4}")
    for s in summary:
        print(f"{s['strategy']:26}{s['note']:18}{str(s['avg_return_pct']):>8}{str(s['avg_sharpe']):>8}"
              f"{str(s['avg_alpha_vs_spy_pp']):>8}{str(s['avg_exposure_pct']):>7}{s['n']:>4}")
    print(f"\nwritten {_CSV}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
