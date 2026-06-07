"""Insider-flow aggregation. Pure, deterministic, lookahead-free.

`flow_asof` is the one primitive: given all parsed transactions and a decision
date, it summarises the discretionary open-market insider flow over the trailing
`lookback_days`, counting only filings **filed on/before** that date. Both the
LLM-facing readings and the backtest's daily triggers are built on it, so the
signal the model reasons about and the signal the backtest executes are by
construction the same quantity.
"""

from __future__ import annotations

from datetime import date, timedelta

from task6_insider.schemas import InsiderTxn


def flow_asof(txns: list[InsiderTxn], as_of: date, lookback_days: int) -> dict[str, float]:
    """Discretionary insider flow over (as_of - lookback_days, as_of], using only
    filings filed on/before as_of (lookahead-free)."""
    lo = as_of - timedelta(days=lookback_days)
    buys = [t for t in txns if t.filing_date <= as_of and lo < t.filing_date and t.is_open_market_buy]
    sells = [t for t in txns if t.filing_date <= as_of and lo < t.filing_date and t.is_open_market_sale]
    buy_value = sum(t.value_usd for t in buys)
    sell_value = sum(t.value_usd for t in sells)
    return {
        "buy_count": float(len(buys)),
        "sell_count": float(len(sells)),
        "distinct_buyers": float(len({t.owner_name for t in buys})),
        "distinct_sellers": float(len({t.owner_name for t in sells})),
        "buy_value_usd": buy_value,
        "sell_value_usd": sell_value,
        "net_value_usd": buy_value - sell_value,
        "net_shares": sum(t.shares for t in buys) - sum(t.shares for t in sells),
        "officer_buy_count": float(sum(1 for t in buys if t.is_officer)),
        "largest_buy_usd": max((t.value_usd for t in buys), default=0.0),
    }


def insider_readings_asof(
    txns: list[InsiderTxn], as_of: date, lookback_days: int,
) -> dict[str, float | str]:
    """The compact as-of snapshot handed to the LLM. Values are str|float."""
    f = flow_asof(txns, as_of, lookback_days)
    # days since the most recent open-market buy (any time before as_of)
    prior_buys = [t.filing_date for t in txns if t.filing_date <= as_of and t.is_open_market_buy]
    days_since_buy = (as_of - max(prior_buys)).days if prior_buys else -1

    net = f["net_value_usd"]
    if f["buy_count"] == 0 and f["sell_count"] == 0:
        regime = "no_activity"
    elif net > 0 and f["distinct_buyers"] >= 2:
        regime = "cluster_buying"
    elif net > 0:
        regime = "net_buying"
    elif net < 0:
        regime = "net_selling"
    else:
        regime = "mixed"

    readings: dict[str, float | str] = {
        "lookback_days": float(lookback_days),
        "insider_regime": regime,
        "buy_count": f["buy_count"],
        "sell_count": f["sell_count"],
        "distinct_buyers": f["distinct_buyers"],
        "officer_buy_count": f["officer_buy_count"],
        "buy_value_usd": round(f["buy_value_usd"], 0),
        "sell_value_usd": round(f["sell_value_usd"], 0),
        "net_value_usd": round(net, 0),
        "largest_buy_usd": round(f["largest_buy_usd"], 0),
        "days_since_last_insider_buy": float(days_since_buy),
    }
    return readings


def readings_block(readings: dict[str, float | str]) -> str:
    """Human-readable readings block for the prompt (mirrors Task 4)."""
    order = [
        "insider_regime", "lookback_days", "buy_count", "sell_count",
        "distinct_buyers", "officer_buy_count", "buy_value_usd", "sell_value_usd",
        "net_value_usd", "largest_buy_usd", "days_since_last_insider_buy",
    ]
    lines = []
    for k in order:
        if k not in readings:
            continue
        v = readings[k]
        if isinstance(v, float) and k.endswith("_usd"):
            lines.append(f"- {k}: ${v:,.0f}")
        else:
            lines.append(f"- {k}: {v}")
    return "\n".join(lines)
