"""Divination-control null band — what Sharpe do 11 worthless timing systems manufacture?

The suite ships 11 placebo control agents (T25 Western astrology, T26–T28/T30–T34 Chinese
易/命理/星命/三式/數術, T29 Japanese 四柱推命, T35 Vedic Jyotiṣa). Each has a FIXED,
deterministic timing rule (no LLM needed), so we can run every control's signals across a
ticker panel for FREE and pool the resulting Sharpes into a **null band**: the distribution
of risk-adjusted performance you get purely from worthless date-keyed timing + the equity
premium. A real agent whose backtested Sharpe sits inside this band is indistinguishable
from divination.

Output: the pooled null percentiles + a per-system breakdown, and an overlay of the real
agents' committed eval Sharpes classified against the band's p95.

    python -m tools.divination_null_band
    python -m tools.divination_null_band --tickers AAPL,MSFT,NVDA,XOM,KO --observe 1.21
"""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from shared.cost_ledger import init_db
from shared.logging import configure_logging, get_logger
from task3_strategy.pipeline.prices import fetch_prices
from task17_quality.pipeline.backtest import run_factor_backtest

logger = get_logger(__name__)
_PANEL = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "JPM", "XOM", "KO", "PG", "WMT", "JNJ"]
_LOOKBACK = 365 * 3
_MIN_BARS = 250
_REPORT = Path(__file__).resolve().parents[1] / "shared" / "reports" / "divination_null_band.json"


def _percentile(vals: list[float], p: float) -> float:
    if not vals:
        return 0.0
    vs = sorted(vals)
    k = (len(vs) - 1) * p / 100
    f = int(k); c = min(f + 1, len(vs) - 1)
    return float(vs[f] if f == c else vs[f] + (vs[c] - vs[f]) * (k - f))


def _listing(ticker: str, fallback: date) -> date:
    try:
        import yfinance as yf
        md = yf.Ticker(ticker).history_metadata
        ftd = md.get("firstTradeDate") if isinstance(md, dict) else None
        if ftd is not None:
            return datetime.fromtimestamp(int(ftd), tz=timezone.utc).date() if not isinstance(ftd, datetime) else ftd.date()
    except Exception:  # noqa: BLE001
        pass
    return fallback


def _control_signals(listing: date, dates: list[date]):
    """Yield (system, [(label, want_long_callable), ...]) for all 11 controls — deterministic."""
    # T25 astrology
    from task25_astro.pipeline import astro as A
    from task25_astro.schemas import AstroSpec
    st = A.build_astro_state(dates, 6.0)
    yield "T25 astrology", [(s, A.make_want_long(AstroSpec(entry_signal=s), st))
                            for s in ("avoid_mercury_retrograde", "moon_phase_long", "benefic_aspect")]
    # T26 梅花易 (a few seeds)
    from task26_meihua.pipeline.signals import build_divinations, make_want_long as mh_wl
    from task26_meihua.schemas import MeihuaSpec
    mh = []
    for seed in range(4):
        divs = build_divinations(dates, seed)
        for s in ("ti_yong_auspicious", "yang_ti"):
            mh.append((f"{s}#{seed}", mh_wl(MeihuaSpec(entry_signal=s, seed=seed), divs)))
    yield "T26 梅花易", mh
    # T27 八字
    from task27_bazi.pipeline import bazi as B
    from task27_bazi.schemas import BaziSpec
    fav = set(B.strength_and_favourable(B.four_pillars(listing))["favourable"])
    yield "T27 八字", [(s, B.make_want_long(BaziSpec(entry_signal=s), fav))
                       for s in ("favorable_year", "favorable_month")]
    # T28 紫微
    from task28_ziwei.pipeline import ziwei_core
    from task28_ziwei.pipeline.ziwei import make_want_long as zw_wl
    from task28_ziwei.schemas import ZiweiSpec
    sp = ziwei_core.build_chart(listing)["star_palace"]
    yield "T28 紫微", [(s, zw_wl(ZiweiSpec(entry_signal=s), sp)) for s in ("sihua_year", "sihua_month")]
    # T29 四柱推命
    from task29_suimei.pipeline import suimei as S
    from task29_suimei.schemas import SuimeiSpec
    sc = S.build_chart(listing)
    yield "T29 四柱推命", [(s, S.make_want_long(SuimeiSpec(entry_signal=s), sc["day_stem_idx"], sc["void"]))
                          for s in ("twelve_fortune", "avoid_tenchusatsu")]
    # T30 七政四餘
    import ephem
    from task30_qizheng.pipeline import qizheng as Q
    from task30_qizheng.schemas import QizhengSpec
    nss = int(Q._lon(ephem.Sun, listing) // 30) % 12
    qst = Q.build_state(dates, nss)
    yield "T30 七政四餘", [(s, Q.make_want_long(QizhengSpec(entry_signal=s), qst))
                          for s in ("benefic_transit", "avoid_malefic")]
    # T31 鐵板神數
    from task31_tieban.pipeline import tieban as TB
    from task31_tieban.schemas import TiebanSpec
    ming = TB.ming_number(listing)
    yield "T31 鐵板神數", [(s, TB.make_want_long(TiebanSpec(entry_signal=s), ming))
                          for s in ("verse_fortune", "avoid_inauspicious")]
    # T32 奇門遁甲
    from task32_qimen.pipeline import qimen as QM
    from task32_qimen.schemas import QimenSpec
    yield "T32 奇門遁甲", [(s, QM.make_want_long(QimenSpec(entry_signal=s)))
                          for s in ("auspicious_gate", "avoid_ill_gate")]
    # T33 大六壬
    from task33_liuren.pipeline import liuren as LR
    from task33_liuren.schemas import LiurenSpec
    dse = B.four_pillars(listing)["day"]["stem_elem"]
    yield "T33 大六壬", [(s, LR.make_want_long(LiurenSpec(entry_signal=s), dse))
                        for s in ("yong_supports", "avoid_ke")]
    # T34 太乙神數
    from task34_taiyi.pipeline import taiyi as TY
    from task34_taiyi.schemas import TaiyiSpec
    yield "T34 太乙神數", [(s, TY.make_want_long(TaiyiSpec(entry_signal=s)))
                          for s in ("host_prevails", "avoid_guest_win")]
    # T35 Jyotiṣa
    from task35_jyotish.pipeline import jyotish as JY
    from task35_jyotish.schemas import JyotishSpec
    yield "T35 Jyotiṣa", [(s, JY.make_want_long(JyotishSpec(entry_signal=s), listing))
                          for s in ("benefic_dasha", "avoid_malefic_dasha")]


async def compute(tickers: list[str]) -> dict:
    await init_db()
    spy = await asyncio.to_thread(fetch_prices, "SPY")
    pooled: list[float] = []
    excess: list[float] = []      # alpha vs SPY — NOT inflated by the equity premium
    by_system: dict[str, list[float]] = {}
    for tk in tickers:
        try:
            prices = await asyncio.to_thread(fetch_prices, tk)
        except Exception:  # noqa: BLE001
            continue
        if len(prices) < _MIN_BARS:
            continue
        as_of = prices[-1].date
        start = max(prices[0].date, as_of - timedelta(days=_LOOKBACK))
        dates = [p.date for p in prices if p.date >= start]
        listing = await asyncio.to_thread(_listing, tk, prices[0].date)
        for system, sigs in _control_signals(listing, dates):
            for _label, wl in sigs:
                try:
                    bt = run_factor_backtest(prices, wl, start=start, exit_mode="deteriorating",
                                             transaction_cost_bps=10.0, market_prices=spy)
                except Exception:  # noqa: BLE001
                    continue
                pooled.append(bt.metrics.sharpe)
                by_system.setdefault(system, []).append(bt.metrics.sharpe)
                if bt.metrics.excess_vs_market_pct is not None:
                    excess.append(bt.metrics.excess_vs_market_pct)
        logger.info("null_ticker_done", ticker=tk, n=len(pooled))

    pctls = [50, 75, 90, 95, 99]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "panel": tickers, "n_draws": len(pooled),
        "pooled_sharpe": {f"p{p}": round(_percentile(pooled, p), 3) for p in pctls} | {"max": round(max(pooled), 3) if pooled else 0.0},
        "sharpe_p95_threshold": round(_percentile(pooled, 95), 3),
        "pooled_alpha_vs_market_pct": {f"p{p}": round(_percentile(excess, p), 2) for p in pctls} | {"max": round(max(excess), 2) if excess else 0.0},
        "alpha_p95_threshold_pct": round(_percentile(excess, 95), 2),
        "by_system_mean_sharpe": {s: round(sum(v) / len(v), 3) for s, v in sorted(by_system.items())},
        "by_system_max_sharpe": {s: round(max(v), 3) for s, v in sorted(by_system.items())},
        "_pooled": [round(x, 4) for x in pooled],
        "_pooled_alpha": [round(x, 4) for x in excess],
    }


# human-readable labels for agents that expose a backtest Sharpe in their eval report
_AGENT_LABELS = {
    "task17_quality": "T17 quality", "task18_events": "T18 events", "task19_anomaly": "T19 anomaly",
    "task20_vix": "T20 vix", "task21_ranker": "T21 ranker", "task22_congress": "T22 congress",
    "task23_pairs": "T23 pairs", "task24_contagion": "T24 contagion",
}


def _real_overlay(sharpe_thr: float) -> dict:
    """Auto-scan every agent's committed eval report. Records the MEDIAN Sharpe across its
    succeeded eval cases (robust — `max` would just cherry-pick the luckiest ticker) and the
    best, and whether the median clears the control p95. NB: single-name Sharpe — and alpha
    vs SPY — are both inflated by the equity premium on whichever names rose, so this is an
    honest *illustration*, not a verdict; per-agent skill is judged inside each agent's own
    eval (lookahead invariants + alpha vs its own benchmark)."""
    import statistics
    out: dict = {}
    root = Path(__file__).resolve().parents[1]
    for pkg, name in _AGENT_LABELS.items():
        rp = root / pkg / "eval" / "report.json"
        if not rp.exists():
            continue
        try:
            cases = json.loads(rp.read_text()).get("cases", [])
            sharpes = [c.get("recorded", {}).get("sharpe") for c in cases]
            sharpes = [s for s in sharpes if isinstance(s, (int, float))]
            if not sharpes:
                continue
            med = statistics.median(sharpes)
            out[name] = {"sharpe_median": round(med, 3), "sharpe_best": round(max(sharpes), 3),
                         "n_cases": len(sharpes), "clears_control_p95": med > sharpe_thr}
        except Exception:  # noqa: BLE001
            continue
    return out


async def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", default=",".join(_PANEL))
    ap.add_argument("--observe", type=float, default=None)
    ap.add_argument("--output", default=str(_REPORT))
    args = ap.parse_args(argv)
    configure_logging()
    rep = await compute([t.strip().upper() for t in args.tickers.split(",") if t.strip()])
    thr = rep["sharpe_p95_threshold"]
    rep["real_agent_overlay"] = _real_overlay(thr)
    if args.observe is not None:
        p = sum(1 for x in rep["_pooled"] if x >= args.observe) / max(1, len(rep["_pooled"]))
        rep["observed_sharpe"] = args.observe
        rep["observed_pvalue_vs_controls"] = round(p, 4)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps({k: v for k, v in rep.items() if not k.startswith("_")}, indent=2, ensure_ascii=False))
    print(json.dumps({k: v for k, v in rep.items() if not k.startswith("_")}, indent=2, ensure_ascii=False))
    n_clear = sum(1 for v in rep["real_agent_overlay"].values() if v.get("clears_control_p95"))
    print(f"\n→ {rep['n_draws']} control draws; control Sharpe p95 = {thr}. Of {len(rep['real_agent_overlay'])} "
          f"real agents with eval reports, {n_clear} clear it on MEDIAN single-name Sharpe.")
    print("  (single-name Sharpe is inflated by the equity premium — illustration, not verdict.)")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
