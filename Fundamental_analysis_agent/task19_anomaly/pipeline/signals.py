"""Price-anomaly signals. Pure, deterministic, lookahead-free (trailing windows only)."""

from __future__ import annotations

from datetime import date

from task19_anomaly.schemas import AnomalySpec, PricePoint

_YEAR = 252
_ELEVEN_M = 231
_MONTH = 21


def _precompute(prices: list[PricePoint]) -> dict:
    closes = [p.close for p in prices]
    n = len(closes)
    rets = [0.0] + [closes[i] / closes[i - 1] - 1.0 if closes[i - 1] > 0 else 0.0 for i in range(1, n)]
    high52, max_daily, ret11 = [], [], []
    for i in range(n):
        lo = max(0, i - _YEAR + 1)
        high52.append(max(closes[lo:i + 1]))
        mlo = max(0, i - _MONTH + 1)
        max_daily.append(max(rets[mlo:i + 1]) if i >= 1 else 0.0)
        ret11.append((closes[i] / closes[i - _ELEVEN_M] - 1.0) if i >= _ELEVEN_M else None)
    idx = {p.date: i for i, p in enumerate(prices)}
    return {"closes": closes, "high52": high52, "max_daily": max_daily, "ret11": ret11, "idx": idx}


def make_want_long(spec: AnomalySpec, prices: list[PricePoint]):
    pc = _precompute(prices)
    closes, high52, max_daily, ret11, idx = pc["closes"], pc["high52"], pc["max_daily"], pc["ret11"], pc["idx"]
    thr = spec.max_daily_threshold_pct / 100.0

    def want_long(d: date) -> bool:
        i = idx.get(d)
        if i is None:
            return False
        sig = spec.entry_signal
        if sig == "buy_and_hold":
            return True
        if sig == "near_52w_high":
            return high52[i] > 0 and closes[i] >= high52[i] * (1 - spec.high_threshold_pct / 100.0)
        if sig == "avoid_max_lottery":
            lo = max(0, i - spec.max_window_days + 1)
            recent_spike = any(max_daily[j] >= thr for j in [i]) or any(
                (closes[k] / closes[k - 1] - 1.0) >= thr for k in range(max(1, lo), i + 1))
            return not recent_spike
        if sig == "tax_loss_reversal":
            return d.month in (12, 1) and ret11[i] is not None and ret11[i] < 0
        return False

    return want_long


def anomaly_readings(prices: list[PricePoint]) -> dict[str, float | str]:
    pc = _precompute(prices)
    i = len(prices) - 1
    closes, high52, ret11 = pc["closes"], pc["high52"], pc["ret11"]
    below = (1 - closes[i] / high52[i]) * 100.0 if high52[i] > 0 else 0.0
    recent_max = max((closes[j] / closes[j - 1] - 1.0) for j in range(max(1, i - _MONTH + 1), i + 1)) * 100.0
    r11 = ret11[i]
    regime = "near_high" if below <= 5 else "mid_range" if below <= 25 else "deep_below_high"
    out: dict[str, float | str] = {
        "anomaly_regime": regime,
        "pct_below_52w_high": round(below, 1),
        "recent_max_daily_pct": round(recent_max, 1),
        "current_month": prices[i].date.month,
    }
    if r11 is not None:
        out["trailing_11m_return_pct"] = round(r11 * 100.0, 1)
    return out


def readings_block(r: dict[str, float | str]) -> str:
    order = ["anomaly_regime", "pct_below_52w_high", "recent_max_daily_pct",
             "trailing_11m_return_pct", "current_month"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)
