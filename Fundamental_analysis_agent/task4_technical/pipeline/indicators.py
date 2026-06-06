"""Technical indicators — pure, deterministic, no LLM and no I/O.

Every series-returning function returns a list aligned 1:1 to its input, with
`None` where the indicator is undefined (warm-up). The SMA and RSI helpers match
Task 3's engine exactly (Wilder RSI); the rest — EMA, MACD, Bollinger, Donchian,
volume ratio — are new.

`indicator_readings_asof()` collapses these into a compact, rounded dict computed
strictly from bars on/before a decision date — the only thing the LLM ever sees,
which is what keeps its grounding lookahead-free.
"""

from __future__ import annotations

import math
from datetime import date

from task3_strategy.schemas import PricePoint


# --- core series ------------------------------------------------------------

def sma(closes: list[float], window: int) -> list[float | None]:
    out: list[float | None] = [None] * len(closes)
    if window <= 0:
        return out
    run = 0.0
    for i, c in enumerate(closes):
        run += c
        if i >= window:
            run -= closes[i - window]
        if i >= window - 1:
            out[i] = run / window
    return out


def ema(values: list[float | None], span: int) -> list[float | None]:
    """Exponential moving average, seeded at the first defined value.

    `α = 2/(span+1)`. Accepts a series that may have leading `None`s (e.g. the
    MACD line fed into the signal EMA); output is `None` until the seed.
    """
    out: list[float | None] = [None] * len(values)
    if span <= 0:
        return out
    alpha = 2.0 / (span + 1.0)
    prev: float | None = None
    for i, v in enumerate(values):
        if v is None:
            continue
        prev = v if prev is None else (v * alpha + prev * (1.0 - alpha))
        out[i] = prev
    return out


def rsi(closes: list[float], period: int) -> list[float | None]:
    out: list[float | None] = [None] * len(closes)
    if period <= 0 or len(closes) <= period:
        return out
    gains = losses = 0.0
    for i in range(1, period + 1):
        ch = closes[i] - closes[i - 1]
        gains += max(ch, 0.0)
        losses += max(-ch, 0.0)
    avg_gain, avg_loss = gains / period, losses / period
    out[period] = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1 + avg_gain / avg_loss)
    for i in range(period + 1, len(closes)):
        ch = closes[i] - closes[i - 1]
        avg_gain = (avg_gain * (period - 1) + max(ch, 0.0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-ch, 0.0)) / period
        out[i] = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1 + avg_gain / avg_loss)
    return out


def macd(
    closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9
) -> tuple[list[float | None], list[float | None], list[float | None]]:
    """Return (macd_line, signal_line, histogram), each aligned to `closes`.

    line = EMA(fast) − EMA(slow); signal = EMA(line, signal); hist = line − signal.
    Both close-EMAs seed at bar 0, so the line is defined for the whole series.
    """
    ef = ema([float(c) for c in closes], fast)
    es = ema([float(c) for c in closes], slow)
    line: list[float | None] = [
        (a - b) if (a is not None and b is not None) else None for a, b in zip(ef, es)
    ]
    sig = ema(line, signal)
    hist: list[float | None] = [
        (li - si) if (li is not None and si is not None) else None for li, si in zip(line, sig)
    ]
    return line, sig, hist


def bollinger(
    closes: list[float], period: int = 20, k: float = 2.0
) -> tuple[list[float | None], list[float | None], list[float | None], list[float | None], list[float | None]]:
    """Return (mid, upper, lower, pctb, bandwidth_pct), aligned to `closes`.

    mid = SMA(period); band = k·population-σ over the trailing window.
    %b = (close − lower)/(upper − lower); bandwidth = (upper − lower)/mid · 100.
    """
    n = len(closes)
    mid = sma(closes, period)
    upper: list[float | None] = [None] * n
    lower: list[float | None] = [None] * n
    pctb: list[float | None] = [None] * n
    bandwidth: list[float | None] = [None] * n
    if period <= 0:
        return mid, upper, lower, pctb, bandwidth
    for i in range(n):
        m = mid[i]
        if m is None:
            continue
        window = closes[i - period + 1 : i + 1]
        var = sum((c - m) ** 2 for c in window) / period
        sd = math.sqrt(var)
        up, lo = m + k * sd, m - k * sd
        upper[i], lower[i] = up, lo
        pctb[i] = (closes[i] - lo) / (up - lo) if up > lo else 0.5
        bandwidth[i] = (up - lo) / m * 100.0 if m else 0.0
    return mid, upper, lower, pctb, bandwidth


def donchian(
    highs: list[float], lows: list[float], period: int = 20
) -> tuple[list[float | None], list[float | None]]:
    """Return (upper, lower) Donchian channel over the PRIOR `period` bars.

    The window ends at i−1 (it excludes the current bar) so that
    "close > donchian_upper[i]" is a genuine breakout of a level set by history,
    not the current bar touching a band it helped define.
    """
    n = len(highs)
    upper: list[float | None] = [None] * n
    lower: list[float | None] = [None] * n
    if period <= 0:
        return upper, lower
    for i in range(n):
        if i < period:
            continue
        upper[i] = max(highs[i - period : i])
        lower[i] = min(lows[i - period : i])
    return upper, lower


def volume_ratio(volumes: list[float], fast: int, slow: int) -> list[float | None]:
    """Ratio of trailing fast-window average volume to slow-window average."""
    n = len(volumes)
    out: list[float | None] = [None] * n
    if fast <= 0 or slow <= 0:
        return out
    for i in range(n):
        if i < slow - 1:
            continue
        f = sum(volumes[i - fast + 1 : i + 1]) / fast
        s = sum(volumes[i - slow + 1 : i + 1]) / slow
        out[i] = (f / s) if s > 0 else None
    return out


# --- as-of readings payload -------------------------------------------------

def _last_defined(series: list[float | None]) -> float | None:
    for v in reversed(series):
        if v is not None:
            return v
    return None


def indicator_readings_asof(prices: list[PricePoint], as_of: date) -> dict[str, float | str]:
    """Compact, rounded snapshot of all indicators as-of `as_of` (inclusive).

    Uses ONLY bars on/before `as_of`, so no future bar can leak into what the
    LLM sees. Returns a flat dict of float|str values for the prompt + UI.
    """
    hist = [p for p in prices if p.date <= as_of]
    closes = [p.close for p in hist]
    highs = [p.high for p in hist]
    lows = [p.low for p in hist]
    vols = [p.volume for p in hist]
    last = closes[-1]

    sma20 = _last_defined(sma(closes, 20))
    sma50 = _last_defined(sma(closes, 50))
    sma200 = _last_defined(sma(closes, 200))
    macd_l, macd_s, macd_h = macd(closes, 12, 26, 9)
    _, bb_up, bb_lo, bb_pctb, bb_bw = bollinger(closes, 20, 2.0)
    dc_up, dc_lo = donchian(highs, lows, 20)
    vol_r = _last_defined(volume_ratio(vols, 20, 50))

    def pct_vs(level: float | None) -> float | None:
        return round((last / level - 1.0) * 100.0, 2) if level else None

    # trend regime from the 50/200 structure
    if sma50 is not None and sma200 is not None:
        if sma50 > sma200 and last > sma200:
            regime = "uptrend"
        elif sma50 < sma200 and last < sma200:
            regime = "downtrend"
        else:
            regime = "range"
    else:
        regime = "unknown"

    # 52-week stats
    window = hist[-252:]
    hi52 = max(p.high for p in window)
    lo52 = min(p.low for p in window)
    range_pos = round((last - lo52) / (hi52 - lo52) * 100.0, 1) if hi52 > lo52 else 50.0
    wcloses = [p.close for p in window]
    rets = [wcloses[i] / wcloses[i - 1] - 1.0 for i in range(1, len(wcloses))]
    if len(rets) > 1:
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
        rvol = round(math.sqrt(252) * math.sqrt(var) * 100.0, 1)
    else:
        rvol = 0.0

    out: dict[str, float | str] = {
        "as_of_date": as_of.isoformat(),
        "last_close": round(last, 2),
        "rsi_14": round(_last_defined(rsi(closes, 14)) or 50.0, 1),
        "trend_regime": regime,
        "range_pos_52w_pct": range_pos,
        "realized_vol_annualized_pct": rvol,
    }
    if (ml := _last_defined(macd_l)) is not None:
        out["macd_line"] = round(ml, 3)
    if (ms := _last_defined(macd_s)) is not None:
        out["macd_signal"] = round(ms, 3)
    if (mh := _last_defined(macd_h)) is not None:
        out["macd_hist"] = round(mh, 3)
    if sma20 is not None:
        out["sma_20"] = round(sma20, 2)
        out["price_vs_sma20_pct"] = pct_vs(sma20)  # type: ignore[assignment]
    if sma50 is not None:
        out["sma_50"] = round(sma50, 2)
        out["price_vs_sma50_pct"] = pct_vs(sma50)  # type: ignore[assignment]
    if sma200 is not None:
        out["sma_200"] = round(sma200, 2)
        out["price_vs_sma200_pct"] = pct_vs(sma200)  # type: ignore[assignment]
    if (pb := _last_defined(bb_pctb)) is not None:
        out["bollinger_pctb"] = round(pb, 3)
    if (bw := _last_defined(bb_bw)) is not None:
        out["bollinger_bandwidth_pct"] = round(bw, 2)
    if (du := _last_defined(dc_up)) is not None:
        out["donchian_high_20"] = round(du, 2)
    if (dl := _last_defined(dc_lo)) is not None:
        out["donchian_low_20"] = round(dl, 2)
    if du is not None and dl is not None and du > dl:
        out["donchian_pos_pct"] = round((last - dl) / (du - dl) * 100.0, 1)
    if vol_r is not None:
        out["vol_ratio_20_50"] = round(vol_r, 3)
    # drop any None that slipped through pct_vs
    return {k: v for k, v in out.items() if v is not None}


def readings_block(readings: dict[str, float | str]) -> str:
    """Render the readings dict as a human-readable bullet block for the prompt."""
    order = [
        "as_of_date", "last_close", "trend_regime", "rsi_14",
        "macd_line", "macd_signal", "macd_hist",
        "sma_20", "price_vs_sma20_pct", "sma_50", "price_vs_sma50_pct",
        "sma_200", "price_vs_sma200_pct",
        "bollinger_pctb", "bollinger_bandwidth_pct",
        "donchian_high_20", "donchian_low_20", "donchian_pos_pct",
        "vol_ratio_20_50", "range_pos_52w_pct", "realized_vol_annualized_pct",
    ]
    lines = [f"- {k}: {readings[k]}" for k in order if k in readings]
    extra = [f"- {k}: {v}" for k, v in readings.items() if k not in order]
    return "\n".join(lines + extra)
