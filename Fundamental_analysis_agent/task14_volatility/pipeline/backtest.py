"""Volatility-regime signal + backtest. Pure, deterministic, lookahead-free.

Realized vol at bar i uses only returns up to i; the long/flat decision at close i
executes at open i+1. Metrics reuse Task 4's `_metrics`.
"""

from __future__ import annotations

import math
from datetime import date

from task4_technical.pipeline.backtest import _metrics  # deliberate downstream reuse
from task14_volatility.schemas import (
    BacktestResult, EquityPoint, PricePoint, Trade, VolSpec,
)

_TD = 252


def _rets(closes: list[float]) -> list[float]:
    return [0.0] + [closes[i] / closes[i - 1] - 1.0 if closes[i - 1] > 0 else 0.0
                    for i in range(1, len(closes))]


def _realized_vol(rets: list[float], i: int, window: int) -> float | None:
    if i + 1 < window:
        return None
    chunk = rets[i + 1 - window: i + 1]
    mean = sum(chunk) / len(chunk)
    var = sum((r - mean) ** 2 for r in chunk) / (len(chunk) - 1)
    return math.sqrt(var) * math.sqrt(_TD) * 100.0


def _sma(closes: list[float], i: int, window: int) -> float | None:
    if i + 1 < window:
        return None
    return sum(closes[i + 1 - window: i + 1]) / window


def volatility_readings(prices: list[PricePoint]) -> dict[str, float | str]:
    closes = [p.close for p in prices]
    rets = _rets(closes)
    vols = [v for i in range(len(closes)) if (v := _realized_vol(rets, i, 20)) is not None]
    if not vols:
        return {"vol_regime": "insufficient_history"}
    cur = vols[-1]
    srt = sorted(vols)
    pctl = sum(1 for v in srt if v <= cur) / len(srt) * 100.0
    median = srt[len(srt) // 2]
    regime = "stressed" if pctl >= 80 else "calm" if pctl <= 40 else "normal"
    return {
        "vol_regime": regime,
        "current_vol_ann_pct": round(cur, 1),
        "median_vol_ann_pct": round(median, 1),
        "vol_percentile": round(pctl, 0),
        "min_vol_ann_pct": round(srt[0], 1),
        "max_vol_ann_pct": round(srt[-1], 1),
    }


def readings_block(r: dict[str, float | str]) -> str:
    order = ["vol_regime", "current_vol_ann_pct", "median_vol_ann_pct", "vol_percentile",
             "min_vol_ann_pct", "max_vol_ann_pct"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)


def run_vol_backtest(
    prices: list[PricePoint], spec: VolSpec, *, start: date,
    transaction_cost_bps: float = 10.0, market_prices: list[PricePoint] | None = None,
) -> BacktestResult:
    full = prices
    closes_full = [p.close for p in full]
    rets_full = _rets(closes_full)
    idxs = [j for j, p in enumerate(full) if p.date >= start]
    if len(idxs) < 2:
        raise RuntimeError("insufficient price history in the backtest window")
    base = idxs[0]
    window = [full[j] for j in idxs]
    opens = [p.open for p in window]
    closes = [p.close for p in window]
    lows = [p.low for p in window]
    n = len(window)
    cost = transaction_cost_bps / 10_000.0

    def want_long(fi: int) -> bool:
        sig = spec.entry_signal
        if sig == "buy_and_hold":
            return True
        v = _realized_vol(rets_full, fi, spec.vol_window)
        calm = v is not None and v <= spec.vol_threshold_pct
        if sig == "calm_regime":
            return calm
        if sig == "trend_and_calm":
            sma = _sma(closes_full, fi, spec.sma_window)
            return calm and sma is not None and closes_full[fi] > sma
        return False

    cash, equity = 1.0, 1.0
    position = 0.0
    entry_price: float | None = None
    trades: list[Trade] = []
    curve: list[EquityPoint] = []
    days_in = 0
    bench_entry = opens[1]
    mkt_close = {p.date: p.close for p in (market_prices or [])}
    mkt_open = {p.date: p.open for p in (market_prices or [])}
    mkt_entry = mkt_open.get(window[1].date) if market_prices else None
    last_mkt = 1.0

    for i in range(n):
        if position > 0:
            equity = position * closes[i]; days_in += 1
        else:
            equity = cash
        can = i + 1 < n
        ep = opens[i + 1] if can else None
        if position > 0 and spec.stop_loss_pct > 0:
            stop = entry_price * (1 - spec.stop_loss_pct / 100.0)  # type: ignore[operator]
            if lows[i] <= stop and can:
                fp = min(opens[i], stop); net = fp * (1 - cost)
                cash = position * net
                trades[-1].exit_date = window[i].date; trades[-1].exit_price = round(fp, 4)
                trades[-1].return_pct = round((net / (entry_price * (1 + cost)) - 1.0) * 100.0, 4)  # type: ignore[operator]
                trades[-1].exit_reason = "stop_loss"
                position, entry_price = 0.0, None; equity = cash
        if can:
            want = want_long(base + i)
            if position > 0 and not want:
                net = ep * (1 - cost); cash = position * net
                trades[-1].exit_date = window[i + 1].date; trades[-1].exit_price = round(ep, 4)
                trades[-1].return_pct = round((net / (entry_price * (1 + cost)) - 1.0) * 100.0, 4)  # type: ignore[operator]
                trades[-1].exit_reason = "signal"
                position, entry_price = 0.0, None; equity = cash
            elif position == 0 and want:
                fill = ep * (1 + cost); position = cash / fill; entry_price = ep
                trades.append(Trade(entry_date=window[i + 1].date, entry_price=round(ep, 4))); cash = 0.0
        if mkt_entry:
            if i == 0:
                mv: float | None = 1.0
            else:
                if window[i].date in mkt_close:
                    last_mkt = mkt_close[window[i].date] / mkt_entry
                mv = round(last_mkt, 6)
        else:
            mv = None
        curve.append(EquityPoint(date=window[i].date, strategy=round(equity, 6),
                                 benchmark=1.0 if i == 0 else round(closes[i] / bench_entry, 6), market=mv))

    if position > 0 and entry_price is not None:
        net = closes[-1] * (1 - cost)
        trades[-1].exit_date = window[-1].date; trades[-1].exit_price = round(closes[-1], 4)
        trades[-1].return_pct = round((net / (entry_price * (1 + cost)) - 1.0) * 100.0, 4)
        trades[-1].exit_reason = "end_of_data"
        curve[-1].strategy = round(position * net, 6)

    metrics = _metrics(curve, trades, closes, days_in, transaction_cost_bps)
    return BacktestResult(start_date=window[0].date, end_date=window[-1].date,
                          metrics=metrics, trades=trades, equity_curve=curve)
