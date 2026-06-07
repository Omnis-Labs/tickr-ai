"""Short-pressure backtest + readings. Pure, deterministic, lookahead-free.

The short-volume-ratio (SVR) series is sampled weekly; `svr_asof(d)` uses the most
recent sample STRICTLY BEFORE d (a publish lag), so the backtest never acts on
same-day short data. SMA uses trailing closes. Signal at close i → open i+1.
Metrics reuse Task 4's `_metrics`.
"""

from __future__ import annotations

from datetime import date

from task4_technical.pipeline.backtest import _metrics  # deliberate downstream reuse
from task16_short.schemas import (
    BacktestResult, EquityPoint, PricePoint, ShortSpec, Trade,
)


def svr_asof(series: list[tuple[date, float]], d: date) -> float | None:
    val = None
    for sd, v in series:
        if sd < d:
            val = v
        else:
            break
    return val


def dtc_asof(series: list[tuple[date, float, float]], d: date) -> float | None:
    """Most recent days-to-cover STRICTLY BEFORE d (publish-lagged short interest)."""
    val = None
    for sd, dtc, _si in series:
        if sd < d:
            val = dtc
        else:
            break
    return val


def short_readings(
    series: list[tuple[date, float]],
    si_series: list[tuple[date, float, float]] | None = None,
) -> dict[str, float | str]:
    if not series and not si_series:
        return {"short_regime": "no_data", "n_samples": 0.0}
    out: dict[str, float | str] = {}
    if series:
        vals = [v for _, v in series]
        cur = vals[-1]
        srt = sorted(vals)
        median = srt[len(srt) // 2]
        pctl = sum(1 for v in srt if v <= cur) / len(srt) * 100.0
        regime = "elevated_short" if pctl >= 70 else "low_short" if pctl <= 30 else "normal"
        out.update({
            "short_regime": regime,
            "current_short_vol_ratio_pct": round(cur, 1),
            "median_short_vol_ratio_pct": round(median, 1),
            "short_vol_percentile": round(pctl, 0),
            "n_samples": float(len(series)),
        })
    else:
        out["short_regime"] = "no_data"
        out["n_samples"] = 0.0
    if si_series:
        dtcs = [dtc for _, dtc, _ in si_series]
        cur_dtc = dtcs[-1]
        srt = sorted(dtcs)
        pctl = sum(1 for v in srt if v <= cur_dtc) / len(srt) * 100.0
        # short-interest trend: latest vs ~3 settlements (≈6 weeks) ago
        prev = si_series[-4][2] if len(si_series) >= 4 else si_series[0][2]
        latest_si = si_series[-1][2]
        trend = "rising" if latest_si > prev * 1.05 else "falling" if latest_si < prev * 0.95 else "flat"
        out.update({
            "si_regime": "high_short_interest" if pctl >= 70 else "low_short_interest" if pctl <= 30 else "normal_si",
            "current_days_to_cover": round(cur_dtc, 2),
            "days_to_cover_percentile": round(pctl, 0),
            "short_interest_trend": trend,
            "n_si_samples": float(len(si_series)),
        })
    return out


def readings_block(r: dict[str, float | str]) -> str:
    order = ["short_regime", "current_short_vol_ratio_pct", "median_short_vol_ratio_pct",
             "short_vol_percentile", "n_samples",
             "si_regime", "current_days_to_cover", "days_to_cover_percentile",
             "short_interest_trend", "n_si_samples"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)


def run_short_backtest(
    prices: list[PricePoint], svr: list[tuple[date, float]], spec: ShortSpec, *, start: date,
    transaction_cost_bps: float = 10.0, market_prices: list[PricePoint] | None = None,
    si_series: list[tuple[date, float, float]] | None = None,
) -> BacktestResult:
    full = prices
    closes_full = [p.close for p in full]
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

    def _sma(fi: int) -> float | None:
        if fi + 1 < spec.sma_window:
            return None
        return sum(closes_full[fi + 1 - spec.sma_window: fi + 1]) / spec.sma_window

    si = si_series or []

    def want_long(fi: int) -> bool:
        sig = spec.entry_signal
        if sig == "buy_and_hold":
            return True
        if sig in ("si_squeeze", "low_si"):
            dtc = dtc_asof(si, full[fi].date)
            if dtc is None:
                return False
            if sig == "si_squeeze":
                sma = _sma(fi)
                return dtc >= spec.dtc_threshold and sma is not None and closes_full[fi] > sma
            return dtc <= spec.dtc_threshold       # low_si
        s = svr_asof(svr, full[fi].date)
        if s is None:
            return False
        if sig == "squeeze":
            sma = _sma(fi)
            return s >= spec.svr_threshold_pct and sma is not None and closes_full[fi] > sma
        if sig == "low_short":
            return s <= spec.svr_threshold_pct
        return False

    cash, equity = 1.0, 1.0
    position = 0.0
    entry_price: float | None = None
    entry_idx: int | None = None
    trades: list[Trade] = []
    curve: list[EquityPoint] = []
    days_in = 0
    bench_entry = opens[1]
    mkt_close = {p.date: p.close for p in (market_prices or [])}
    mkt_open = {p.date: p.open for p in (market_prices or [])}
    mkt_entry = mkt_open.get(window[1].date) if market_prices else None
    last_mkt = 1.0

    for i in range(n):
        fi = base + i
        if position > 0:
            equity = position * closes[i]; days_in += 1
        else:
            equity = cash
        can = i + 1 < n
        ep = opens[i + 1] if can else None
        if position > 0:
            assert entry_price is not None and entry_idx is not None
            reason = ""; fp: float | None = None; fd = window[i].date
            if spec.stop_loss_pct > 0:
                stop = entry_price * (1 - spec.stop_loss_pct / 100.0)
                if lows[i] <= stop:
                    reason, fp = "stop_loss", min(opens[i], stop)
            if not reason and can:
                if spec.exit_signal == "time_exit" and i - entry_idx >= spec.holding_days:
                    reason = "time_exit"
                elif spec.exit_signal == "short_normalizes" and not want_long(fi):
                    reason = "signal"
                if reason:
                    fp, fd = ep, window[i + 1].date
            if reason and fp is not None:
                net = fp * (1 - cost); cash = position * net
                trades[-1].exit_date = fd; trades[-1].exit_price = round(fp, 4)
                trades[-1].return_pct = round((net / (entry_price * (1 + cost)) - 1.0) * 100.0, 4)
                trades[-1].exit_reason = reason
                position, entry_price, entry_idx = 0.0, None, None; equity = cash
        elif can and want_long(fi):
            fill = ep * (1 + cost); position = cash / fill; entry_price, entry_idx = ep, i + 1
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
        trades[-1].exit_reason = "end_of_data"; curve[-1].strategy = round(position * net, 6)

    metrics = _metrics(curve, trades, closes, days_in, transaction_cost_bps)
    return BacktestResult(start_date=window[0].date, end_date=window[-1].date,
                          metrics=metrics, trades=trades, equity_curve=curve)
