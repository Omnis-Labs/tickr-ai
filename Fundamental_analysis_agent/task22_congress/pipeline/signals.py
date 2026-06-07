"""Congressional-trade signals: as-of readings + the lookahead-free want_long predicate.

All windows are measured from the DISCLOSURE date (when the trade became public),
never the transaction date — so the agent only acts on public information.
"""

from __future__ import annotations

from datetime import date, timedelta

from task22_congress.schemas import CongressSpec, CongressTrade


def split_dates(trades: list[CongressTrade]) -> dict[str, list[date]]:
    """Disclosure dates of buys and sells (the only thing the signal needs)."""
    return {
        "buys": sorted(t.disclosure_date for t in trades if t.txn_type == "buy"),
        "sells": sorted(t.disclosure_date for t in trades if t.txn_type == "sell"),
    }


def congress_readings(trades: list[CongressTrade], as_of: date, provider: str) -> dict[str, float | str]:
    if not trades:
        return {"congress_regime": "no_data", "n_trades": 0.0, "provider": provider}
    buys = [t for t in trades if t.txn_type == "buy"]
    sells = [t for t in trades if t.txn_type == "sell"]
    last = max(t.disclosure_date for t in trades)
    days_since = (as_of - last).days
    net = len(buys) - len(sells)
    regime = "net_buying" if net > 0 and days_since < 180 else "net_selling" if net < 0 and days_since < 180 else "quiet"
    return {
        "congress_regime": regime,
        "n_trades": float(len(trades)),
        "n_buys": float(len(buys)),
        "n_sells": float(len(sells)),
        "net_buy_minus_sell": float(net),
        "days_since_last_disclosure": float(days_since),
        "provider": provider,
    }


def readings_block(r: dict[str, float | str]) -> str:
    order = ["congress_regime", "n_trades", "n_buys", "n_sells", "net_buy_minus_sell",
             "days_since_last_disclosure", "provider"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)


def make_want_long(spec: CongressSpec, dates: dict[str, list[date]]):
    buys, sells = dates["buys"], dates["sells"]
    hold = timedelta(days=spec.holding_days)
    win = timedelta(days=spec.sell_window_days)

    def want_long(d: date) -> bool:
        if spec.entry_signal == "buy_and_hold":
            return True
        if spec.entry_signal == "follow_buys":
            return any(f < d <= f + hold for f in buys)
        if spec.entry_signal == "avoid_after_sells":
            return not any(f < d <= f + win for f in sells)
        return False

    return want_long
