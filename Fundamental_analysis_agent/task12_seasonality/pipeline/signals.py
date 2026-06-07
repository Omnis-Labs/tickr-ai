"""Seasonality statistics + the calendar long/flat rule. Pure, deterministic.

The calendar membership (which days are "long") is known ahead of time, so the
backtest is lookahead-free. `seasonal_readings` summarises the historical calendar
pattern for the LLM (estimated in-sample — the honest weak spot, caveated).
"""

from __future__ import annotations

from datetime import date

from task12_seasonality.schemas import PricePoint, SeasonalSpec

_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _is_turn_of_month(prices: list[PricePoint], i: int, before: int, after: int) -> bool:
    """True if bar i is within `before` trading days of month-end or `after` of month-start."""
    d = prices[i].date
    # position from month start: count consecutive prior bars in the same month
    after_count = 0
    j = i
    while j - 1 >= 0 and prices[j - 1].date.month == d.month and prices[j - 1].date.year == d.year:
        after_count += 1
        j -= 1
        if after_count >= after:
            break
    if after_count < after:
        return True
    before_count = 0
    j = i
    while j + 1 < len(prices) and prices[j + 1].date.month == d.month and prices[j + 1].date.year == d.year:
        before_count += 1
        j += 1
        if before_count >= before:
            break
    return before_count < before


def wants_long(prices: list[PricePoint], i: int, spec: SeasonalSpec) -> bool:
    m = prices[i].date.month
    sig = spec.entry_signal
    if sig == "buy_and_hold":
        return True
    if sig == "best_months":
        return m in (spec.months or [])
    if sig == "sell_in_may":
        return m in (11, 12, 1, 2, 3, 4)
    if sig == "turn_of_month":
        return _is_turn_of_month(prices, i, spec.tom_before, spec.tom_after)
    return False


def seasonal_readings(prices: list[PricePoint]) -> dict[str, float | str]:
    """Average daily return by calendar month + turn-of-month effect, over history."""
    by_month: dict[int, list[float]] = {m: [] for m in range(1, 13)}
    tom, rest = [], []
    for i in range(1, len(prices)):
        r = prices[i].close / prices[i - 1].close - 1.0 if prices[i - 1].close > 0 else 0.0
        by_month[prices[i].date.month].append(r)
        (tom if _is_turn_of_month(prices, i, 3, 3) else rest).append(r)

    def _ann(rs: list[float]) -> float:
        return (sum(rs) / len(rs) * 252 * 100.0) if rs else 0.0

    month_ann = {m: _ann(rs) for m, rs in by_month.items()}
    ranked = sorted(month_ann.items(), key=lambda kv: kv[1], reverse=True)
    out: dict[str, float | str] = {
        "best_months": ", ".join(f"{_MONTHS[m-1]}({v:+.0f}%)" for m, v in ranked[:3]),
        "worst_months": ", ".join(f"{_MONTHS[m-1]}({v:+.0f}%)" for m, v in ranked[-3:]),
        "nov_apr_ann_pct": round(sum(_ann(by_month[m]) for m in (11, 12, 1, 2, 3, 4)) / 6, 1),
        "may_oct_ann_pct": round(sum(_ann(by_month[m]) for m in (5, 6, 7, 8, 9, 10)) / 6, 1),
        "turn_of_month_ann_pct": round(_ann(tom), 1),
        "rest_of_month_ann_pct": round(_ann(rest), 1),
        "years_of_history": round((prices[-1].date - prices[0].date).days / 365.0, 1),
    }
    return out


def readings_block(r: dict[str, float | str]) -> str:
    order = ["years_of_history", "best_months", "worst_months", "nov_apr_ann_pct",
             "may_oct_ann_pct", "turn_of_month_ann_pct", "rest_of_month_ann_pct"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)
