"""Detect corporate events from a company's EDGAR submissions + classify 8-K 5.02s.

All events come from the SUBJECT company's own submissions (13D/13G are cross-indexed
there). Rule-based polarity for most; the LLM reads 8-K Item 5.02 text to tell a
forced/sudden executive departure (red flag) from a planned retirement/promotion.
Everything keyed off the filing date → lookahead-free.
"""

from __future__ import annotations

import asyncio
import functools
from datetime import date, timedelta
from pathlib import Path

import httpx

from shared.llm_gateway import LLMGateway, LLMRequest, Tier
from shared.logging import get_logger
from task2_10k_extractor.eval.edgar_lookup import _SEC_HEADERS, fetch_submissions
from task8_earnings.pipeline.filings import _get, _html_to_text

from task18_events.schemas import EventRecord

logger = get_logger(__name__)
_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts" / "task18_events"
_MAX_502 = 8           # cap LLM-classified executive-change filings (most recent)
_EXCERPT = 1600


@functools.lru_cache(maxsize=2)
def _load_prompt(name: str) -> tuple[str, str]:
    t = (_PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")
    return t.split("## System", 1)[1].split("## User template", 1)[0].strip(), t.split("## User template", 1)[1].strip()


def _items(it: str | None) -> list[str]:
    return [x.strip() for x in (it or "").split(",") if x.strip()]


async def _classify_502(trace_id: str, ticker: str, docs: list[tuple[date, str]], budget_usd: float) -> dict[int, bool]:
    """Return {index: is_negative} for the 5.02 excerpts (batched LLM call)."""
    if not docs:
        return {}
    sys_t, user_t = _load_prompt("exec_classify")
    blocks = [f"[{i}] filed {d.isoformat()}:\n{txt[:_EXCERPT]}" for i, (d, txt) in enumerate(docs)]
    user = user_t.replace("{{ticker}}", ticker).replace("{{events_block}}", "\n\n".join(blocks))
    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(trace_id=trace_id, purpose="task18.exec_classify", tier=Tier.DEFAULT, system=sys_t,
                       messages=[{"role": "user", "content": user}], max_tokens=1200, temperature=0.1,
                       response_format="json", cache_system=True), trace_budget_usd=budget_usd)
        rows = resp.parsed_json.get("events") if isinstance(resp.parsed_json, dict) else None
        if not isinstance(rows, list):
            return {}
        return {r["i"]: bool(r.get("negative")) for r in rows if isinstance(r, dict) and isinstance(r.get("i"), int)}
    except Exception as e:  # noqa: BLE001
        logger.warning("task18_classify_failed", error=str(e)[:160])
        return {}


async def fetch_events(cik: int, *, since: date, trace_id: str, ticker: str, budget_usd: float) -> tuple[list[EventRecord], dict]:
    recent = (await fetch_submissions(cik)).get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    items = recent.get("items", [""] * len(forms))
    accs = recent.get("accessionNumber", [])
    docs = recent.get("primaryDocument", [])
    fdates = recent.get("filingDate", [])

    records: list[EventRecord] = []
    activist: list[date] = []
    redflags: list[date] = []
    exec502: list[tuple[date, str, str]] = []   # (date, accession, primaryDoc) → classify

    for i, f in enumerate(forms):
        try:
            fd = date.fromisoformat(fdates[i])
        except (ValueError, IndexError):
            continue
        if fd < since:
            continue
        F = f.upper()
        its = _items(items[i] if i < len(items) else "")
        if "13D" in F and "13G" not in F:
            activist.append(fd); records.append(EventRecord(date=fd, kind="activist", polarity="positive", note=f))
        elif F == "424B5" or F.startswith("S-3"):
            redflags.append(fd); records.append(EventRecord(date=fd, kind="dilution", polarity="negative", note=f))
        elif F.startswith("NT 10"):
            redflags.append(fd); records.append(EventRecord(date=fd, kind="late_filing", polarity="negative", note=f))
        elif f == "8-K" and "4.01" in its:
            redflags.append(fd); records.append(EventRecord(date=fd, kind="auditor_change", polarity="negative", note="8-K Item 4.01"))
        elif f == "8-K" and "3.01" in its:
            redflags.append(fd); records.append(EventRecord(date=fd, kind="delisting", polarity="negative", note="8-K Item 3.01"))
        elif f == "8-K" and "5.02" in its:
            exec502.append((fd, accs[i], docs[i]))

    # fetch + classify the most-recent 5.02 executive-change filings
    exec502.sort(key=lambda x: x[0], reverse=True)
    exec502 = exec502[:_MAX_502]
    fetched: list[tuple[date, str]] = []
    async with httpx.AsyncClient(timeout=30.0) as client:
        async def _one(fd, accession, doc):
            acc = accession.replace("-", "")
            html = await _get(client, f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{doc}", as_json=False)
            return (fd, _html_to_text(html)[:_EXCERPT]) if html else None
        fetched = [r for r in await asyncio.gather(*(_one(*e) for e in exec502)) if r]
    neg = await _classify_502(trace_id, ticker, fetched, budget_usd)
    for idx, (fd, _txt) in enumerate(fetched):
        if neg.get(idx):
            redflags.append(fd); records.append(EventRecord(date=fd, kind="exec_departure", polarity="negative", note="adverse 8-K 5.02"))
        else:
            records.append(EventRecord(date=fd, kind="exec_departure", polarity="neutral", note="routine 8-K 5.02"))

    records.sort(key=lambda r: r.date)
    bundle = {"activist": sorted(activist), "redflags": sorted(redflags)}
    logger.info("task18_events", cik=cik, activist=len(activist), redflags=len(redflags))
    return records, bundle


def event_readings(records: list[EventRecord], bundle: dict, as_of: date) -> dict[str, float | str]:
    by_kind: dict[str, int] = {}
    for r in records:
        by_kind[r.kind] = by_kind.get(r.kind, 0) + 1
    act, rf = bundle["activist"], bundle["redflags"]
    last_act = (as_of - act[-1]).days if act else -1
    last_rf = (as_of - rf[-1]).days if rf else -1
    if act and (last_act < 180):
        regime = "activist_active"
    elif rf and (last_rf < 120):
        regime = "red_flag_recent"
    else:
        regime = "quiet"
    return {
        "event_regime": regime,
        "n_activist_13d": float(len(act)),
        "n_red_flags": float(len(rf)),
        "n_dilution": float(by_kind.get("dilution", 0)),
        "n_late_filing": float(by_kind.get("late_filing", 0)),
        "n_adverse_exec": float(by_kind.get("exec_departure", 0)),
        "days_since_last_13d": float(last_act),
        "days_since_last_red_flag": float(last_rf),
    }


def readings_block(r: dict[str, float | str]) -> str:
    order = ["event_regime", "n_activist_13d", "n_red_flags", "n_dilution", "n_late_filing",
             "n_adverse_exec", "days_since_last_13d", "days_since_last_red_flag"]
    return "\n".join(f"- {k}: {r[k]}" for k in order if k in r)


def make_want_long(spec, bundle: dict):
    act, rf = bundle["activist"], bundle["redflags"]
    hold = timedelta(days=spec.holding_days)
    win = timedelta(days=spec.redflag_window_days)

    def want_long(d: date) -> bool:
        if spec.entry_signal == "buy_and_hold":
            return True
        if spec.entry_signal == "activist_drift":
            return any(f < d <= f + hold for f in act)
        if spec.entry_signal == "avoid_redflags":
            return not any(f < d <= f + win for f in rf)
        return False

    return want_long
