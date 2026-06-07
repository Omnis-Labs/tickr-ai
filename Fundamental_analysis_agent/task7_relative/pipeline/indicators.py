"""Relative-strength indicators. Pure, deterministic, lookahead-free.

The core series is RS[i] = ticker_close[i] / benchmark_close[i], aligned to the
ticker's trading days (benchmark carried forward over the rare missing date).
All readings/signals are functions of RS up to and including bar i — never later.
"""

from __future__ import annotations

from datetime import date

from task4_technical.schemas import PricePoint

# trading-day windows
_M3, _M6, _M12 = 63, 126, 252


def align_rs(ticker: list[PricePoint], benchmark: list[PricePoint]) -> list[float | None]:
    """RS ratio aligned to the ticker's bars. None until a benchmark close exists."""
    bench = {p.date: p.close for p in benchmark}
    out: list[float | None] = []
    last_b: float | None = None
    for p in ticker:
        if p.date in bench:
            last_b = bench[p.date]
        out.append(p.close / last_b if last_b and last_b > 0 else None)
    return out


def sma_none(series: list[float | None], window: int) -> list[float | None]:
    """Trailing SMA that requires a full window of non-None values."""
    out: list[float | None] = []
    for i in range(len(series)):
        if i + 1 < window:
            out.append(None)
            continue
        chunk = series[i + 1 - window : i + 1]
        if any(v is None for v in chunk):
            out.append(None)
        else:
            out.append(sum(v for v in chunk) / window)  # type: ignore[misc]
    return out


def prior_high(series: list[float | None], lookback: int) -> list[float | None]:
    """Max over the PRIOR `lookback` bars (excludes the current bar) — a real breakout."""
    out: list[float | None] = []
    for i in range(len(series)):
        if i < lookback:
            out.append(None)
            continue
        chunk = [v for v in series[i - lookback : i] if v is not None]
        out.append(max(chunk) if chunk else None)
    return out


def _rel_return_pct(t: list[PricePoint], b: dict[date, float], i: int, n: int) -> float | None:
    """(ticker N-day return) − (benchmark N-day return), in percentage points."""
    if i < n:
        return None
    tr = t[i].close / t[i - n].close - 1.0
    bd0, bd1 = t[i - n].date, t[i].date
    if bd0 not in b or bd1 not in b or b[bd0] <= 0:
        return None
    br = b[bd1] / b[bd0] - 1.0
    return (tr - br) * 100.0


def relative_readings_asof(
    ticker: list[PricePoint], benchmark: list[PricePoint], market: list[PricePoint] | None,
    *, sector_label: str, rs_sma: int = 50,
) -> dict[str, float | str]:
    """Compact as-of RS snapshot for the LLM (values are str|float)."""
    n = len(ticker)
    i = n - 1
    rs = align_rs(ticker, benchmark)
    rs_sma_series = sma_none(rs, rs_sma)
    bench_map = {p.date: p.close for p in benchmark}
    mkt_map = {p.date: p.close for p in (market or [])}

    rel3 = _rel_return_pct(ticker, bench_map, i, _M3)
    rel6 = _rel_return_pct(ticker, bench_map, i, _M6)
    rel12 = _rel_return_pct(ticker, bench_map, i, _M12)
    relmkt3 = _rel_return_pct(ticker, mkt_map, i, _M3) if market else None

    cur_rs, cur_sma = rs[i], rs_sma_series[i]
    above = (cur_rs is not None and cur_sma is not None and cur_rs > cur_sma)

    # 52-week position of the RS line (0 = 52w low, 100 = 52w high)
    win = [v for v in rs[max(0, i - _M12 + 1): i + 1] if v is not None]
    rs_pos = None
    if win and cur_rs is not None and max(win) > min(win):
        rs_pos = (cur_rs - min(win)) / (max(win) - min(win)) * 100.0

    if rel6 is None:
        regime = "insufficient_history"
    elif above and rel6 > 0:
        regime = "outperforming"
    elif not above and rel6 < 0:
        regime = "underperforming"
    else:
        regime = "inline"

    r: dict[str, float | str] = {
        "benchmark": sector_label,
        "rs_regime": regime,
        "rs_above_sma": "yes" if above else "no",
        "rs_sma_window": float(rs_sma),
    }
    if rel3 is not None:
        r["rel_return_3m_pct"] = round(rel3, 2)
    if rel6 is not None:
        r["rel_return_6m_pct"] = round(rel6, 2)
    if rel12 is not None:
        r["rel_return_12m_pct"] = round(rel12, 2)
    if relmkt3 is not None:
        r["rel_return_3m_vs_market_pct"] = round(relmkt3, 2)
    if rs_pos is not None:
        r["rs_52w_range_pos_pct"] = round(rs_pos, 1)
    return r


def readings_block(readings: dict[str, float | str]) -> str:
    order = [
        "benchmark", "rs_regime", "rs_above_sma", "rs_sma_window",
        "rel_return_3m_pct", "rel_return_6m_pct", "rel_return_12m_pct",
        "rel_return_3m_vs_market_pct", "rs_52w_range_pos_pct",
    ]
    lines = []
    for k in order:
        if k not in readings:
            continue
        v = readings[k]
        if isinstance(v, float) and k.endswith("_pct"):
            lines.append(f"- {k}: {v:+.2f}")
        else:
            lines.append(f"- {k}: {v}")
    return "\n".join(lines)
