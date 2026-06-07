"""Contagion signals: bellwether earnings polarity → peer-drift want_long predicate.

Each bellwether earnings event is reduced to a polarity (positive / negative / neutral)
from its classified sentiment, beat/miss, and guidance. Windows are measured from the
bellwether's FILING date — public when the peer could have acted on it (lookahead-free).
"""

from __future__ import annotations

from datetime import date, timedelta

from task8_earnings.schemas import EarningsEvent
from task24_contagion.schemas import ContagionSpec


def event_polarity(e: EarningsEvent) -> str:
    pos = (e.sentiment == "bullish") + (e.beat_miss == "beat") + (e.guidance == "raised")
    neg = (e.sentiment == "bearish") + (e.beat_miss == "miss") + (e.guidance == "lowered")
    if pos > neg:
        return "positive"
    if neg > pos:
        return "negative"
    return "neutral"


def split_dates(events: list[EarningsEvent]) -> dict[str, list[date]]:
    pos, neg = [], []
    for e in events:
        p = event_polarity(e)
        (pos if p == "positive" else neg if p == "negative" else []).append(e.filing_date)
    return {"positive": sorted(pos), "negative": sorted(neg)}


def contagion_readings(events: list[EarningsEvent], dates: dict[str, list[date]], as_of: date,
                       bellwether: str) -> dict[str, float | str]:
    if not events:
        return {"contagion_regime": "no_data", "n_events": 0.0, "bellwether": bellwether}
    pos, neg = dates["positive"], dates["negative"]
    last = max(e.filing_date for e in events)
    days_since = (as_of - last).days
    last_pol = event_polarity(max(events, key=lambda e: e.filing_date))
    regime = f"last_{last_pol}" if days_since < 120 else "stale"
    return {
        "contagion_regime": regime,
        "n_events": float(len(events)),
        "n_positive": float(len(pos)),
        "n_negative": float(len(neg)),
        "days_since_last_report": float(days_since),
        "bellwether": bellwether,
    }


def readings_block(r: dict[str, float | str]) -> str:
    order = ["contagion_regime", "n_events", "n_positive", "n_negative",
             "days_since_last_report", "bellwether"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)


def make_want_long(spec: ContagionSpec, dates: dict[str, list[date]]):
    pos, neg = dates["positive"], dates["negative"]
    win = timedelta(days=spec.drift_days)

    def want_long(d: date) -> bool:
        if spec.entry_signal == "buy_and_hold":
            return True
        if spec.entry_signal == "follow_positive":
            return any(f < d <= f + win for f in pos)
        if spec.entry_signal == "avoid_after_negative":
            return not any(f < d <= f + win for f in neg)
        return False

    return want_long
