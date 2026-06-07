"""Null-distribution harness — a poor-man's White's Reality Check for the whole suite.

The single biggest methodological risk in a 24-agent suite (each with several
strategy templates) is MULTIPLE TESTING: run enough lookahead-free backtests and a
few will post a great Sharpe by pure chance. The cleanest defence is a placebo: draw
many backtests from a signal KNOWN to have no predictive power and see what Sharpe
the *framework itself* manufactures from noise. That band is the null distribution.

Here we use the 梅花易數 placebo (Task 26) as a deterministic noise generator: for a
panel of tickers × N integer seeds, each (ticker, seed) casts a different hexagram
sequence and runs the IDENTICAL lookahead-free factor backtest the real agents use.
`author=False` skips the LLM, so every draw is free and reproducible.

Output: the null Sharpe / excess-vs-market percentiles, plus `reality_check_pvalue`
— the empirical p-value of an observed Sharpe = P(placebo Sharpe ≥ observed). A real
agent whose Sharpe sits inside this band is INDISTINGUISHABLE FROM LUCK.

Usage:
    python -m task26_meihua.eval.null_distribution
    python -m task26_meihua.eval.null_distribution --seeds 60 --tickers AAPL,MSFT,NVDA,XOM,JPM,KO,PG,WMT
    python -m task26_meihua.eval.null_distribution --observe 1.21   # p-value for a Sharpe of 1.21
"""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from shared.cost_ledger import init_db
from shared.logging import configure_logging, get_logger
from task3_strategy.pipeline.prices import fetch_prices
from task17_quality.pipeline.backtest import run_factor_backtest
from task26_meihua.pipeline.signals import build_divinations, make_want_long
from task26_meihua.schemas import MeihuaSpec

logger = get_logger(__name__)
_PANEL = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "JPM", "XOM", "KO", "PG", "WMT", "JNJ"]
_BACKTEST_LOOKBACK_DAYS = 365 * 3
_MIN_BARS = 250
_REPORT = Path(__file__).parent / "null_report.json"


def _percentile(vals: list[float], p: float) -> float:
    if not vals:
        return 0.0
    vs = sorted(vals)
    k = (len(vs) - 1) * p / 100
    f = int(k)
    c = min(f + 1, len(vs) - 1)
    return float(vs[f] if f == c else vs[f] + (vs[c] - vs[f]) * (k - f))


def reality_check_pvalue(observed: float, null: list[float]) -> float:
    """P(placebo ≥ observed) — fraction of null draws at least as good as `observed`."""
    if not null:
        return 1.0
    return sum(1 for x in null if x >= observed) / len(null)


async def compute_null_distribution(tickers: list[str], n_seeds: int) -> dict:
    await init_db()
    sharpes: list[float] = []
    excess: list[float] = []
    per_ticker: dict[str, int] = {}
    spy = None
    try:
        spy = await asyncio.to_thread(fetch_prices, "SPY")
    except Exception:  # noqa: BLE001
        pass

    for t in tickers:
        try:
            prices = await asyncio.to_thread(fetch_prices, t)
        except Exception as e:  # noqa: BLE001
            logger.warning("null_fetch_failed", ticker=t, error=str(e)[:120])
            continue
        if len(prices) < _MIN_BARS:
            continue
        as_of = prices[-1].date
        start = max(prices[0].date, as_of - timedelta(days=_BACKTEST_LOOKBACK_DAYS))
        bar_dates = [p.date for p in prices if p.date >= start]
        n_ok = 0
        for seed in range(n_seeds):
            divs = build_divinations(bar_dates, seed)
            spec = MeihuaSpec(entry_signal="ti_yong_auspicious", seed=seed)
            try:
                bt = run_factor_backtest(prices, make_want_long(spec, divs), start=start,
                                         exit_mode="deteriorating", transaction_cost_bps=10.0, market_prices=spy)
            except Exception:  # noqa: BLE001
                continue
            sharpes.append(bt.metrics.sharpe)
            if bt.metrics.excess_vs_market_pct is not None:
                excess.append(bt.metrics.excess_vs_market_pct)
            n_ok += 1
        per_ticker[t] = n_ok
        logger.info("null_ticker_done", ticker=t, draws=n_ok)

    pctls = [5, 25, 50, 75, 90, 95, 99]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "n_draws": len(sharpes),
        "panel": tickers,
        "draws_per_ticker": per_ticker,
        "sharpe_null": {f"p{p}": round(_percentile(sharpes, p), 3) for p in pctls},
        "sharpe_mean": round(sum(sharpes) / len(sharpes), 3) if sharpes else 0.0,
        "sharpe_max": round(max(sharpes), 3) if sharpes else 0.0,
        "excess_vs_market_null": {f"p{p}": round(_percentile(excess, p), 2) for p in pctls},
        # the threshold a real agent must clear to be "not luck" at 95% confidence
        "sharpe_significance_threshold_p95": round(_percentile(sharpes, 95), 3),
        "_raw_sharpes": [round(s, 4) for s in sharpes],
    }


async def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", type=int, default=40)
    parser.add_argument("--tickers", default=",".join(_PANEL))
    parser.add_argument("--observe", type=float, default=None,
                        help="report the p-value of an observed Sharpe against the null")
    parser.add_argument("--output", default=str(_REPORT))
    args = parser.parse_args(argv)
    configure_logging()

    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    report = await compute_null_distribution(tickers, args.seeds)

    if args.observe is not None:
        p = reality_check_pvalue(args.observe, report["_raw_sharpes"])
        report["observed_sharpe"] = args.observe
        report["observed_pvalue"] = round(p, 4)
        report["observed_verdict"] = "significant (beats placebo)" if p < 0.05 else "indistinguishable from luck"

    Path(args.output).write_text(json.dumps({k: v for k, v in report.items() if k != "_raw_sharpes"}, indent=2))
    printable = {k: v for k, v in report.items() if not k.startswith("_")}
    print(json.dumps(printable, indent=2, ensure_ascii=False))
    print(f"\n→ a real agent needs Sharpe ≥ {report['sharpe_significance_threshold_p95']} "
          f"to beat this worthless placebo at 95% (from {report['n_draws']} draws).", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
