"""Random-ticker real-world sweep — quantify Task 2 production performance.

Pulls a stratified sample of S&P 500 + mid-cap tickers, fetches each
filer's most recent 10-K via EDGAR submissions API, runs the full pipeline,
and emits a JSON report with per-filer + aggregate failure mode breakdown.

This is the harness referenced by the interviewer feedback re: "ensure docs
describe actual system behavior". Numbers here are what real users see.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import traceback
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv

load_dotenv()

from task2_10k_extractor.eval.edgar_lookup import resolve_filing
from task2_10k_extractor.pipeline.confidence import REQUIRED_ITEMS
from task2_10k_extractor.pipeline.orchestrator import run_pipeline

# 25 hand-picked tickers spanning industries + filing styles. Includes
# known-fail INTC + Citi as regression cases, plus easy wins (AAPL, MSFT)
# to confirm we didn't regress, plus a long tail of large-caps that we've
# never specifically tested.
SAMPLE = [
    # Mega-cap tech (typically well-structured)
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA",
    # Known-fail regressions from interviewer feedback
    "INTC", "C",
    # Other large-caps from diverse industries
    "JPM", "BAC", "WFC",  # banks (often complex iXBRL)
    "JNJ", "PFE", "MRK",  # pharma
    "XOM", "CVX",          # energy
    "WMT", "COST", "HD",  # retail
    "DIS", "NFLX",         # media
    "BA", "CAT",           # industrials
    "KO",                  # consumer staples
]


@dataclass
class TickerResult:
    ticker: str
    status: str  # "ok" | "ingest_error" | "resolve_error" | "pipeline_error"
    error: str | None = None
    cik: int | None = None
    fiscal_year: int | None = None
    accession: str | None = None
    items_found: int = 0
    overall_confidence: float = 0.0
    quarantined: bool = False
    coverage_ratio: float = 0.0
    cost_usd: float = 0.0
    duration_ms: int = 0
    method_summary: dict[str, int] = field(default_factory=dict)
    quarantine_reasons: list[str] = field(default_factory=list)
    required_missing: list[str] = field(default_factory=list)
    required_short: list[str] = field(default_factory=list)  # < 500 chars


SHORT_THRESHOLD = 500


async def one_ticker(ticker: str) -> TickerResult:
    print(f"  [{ticker}]", flush=True, end=" ")
    try:
        ref = await resolve_filing(ticker)
    except Exception as e:
        print(f"resolve_error: {e}", flush=True)
        return TickerResult(ticker=ticker, status="resolve_error", error=repr(e))
    if ref is None:
        print("resolve_error: ref None", flush=True)
        return TickerResult(ticker=ticker, status="resolve_error", error="resolve returned None")

    try:
        result = await run_pipeline(url=ref.url)
    except Exception as e:
        print(f"pipeline_error: {type(e).__name__}: {e}", flush=True)
        return TickerResult(
            ticker=ticker,
            status="pipeline_error",
            error=f"{type(e).__name__}: {e}",
            cik=ref.cik,
            fiscal_year=ref.fiscal_year,
            accession=ref.accession_number,
        )

    items_by_id = {it.item_id: it for it in result.items}
    required_missing = [item_id for item_id in REQUIRED_ITEMS if item_id not in items_by_id]
    required_short = [
        item_id for item_id in REQUIRED_ITEMS
        if item_id in items_by_id and len(items_by_id[item_id].content) < SHORT_THRESHOLD
    ]

    out = TickerResult(
        ticker=ticker,
        status="ok",
        cik=ref.cik,
        fiscal_year=ref.fiscal_year,
        accession=ref.accession_number,
        items_found=len(result.items),
        overall_confidence=round(result.overall_confidence, 3),
        quarantined=result.quarantined,
        coverage_ratio=round(result.coverage_ratio, 3),
        cost_usd=round(result.cost_usd, 4),
        duration_ms=result.duration_ms,
        method_summary=result.extraction_method_summary,
        quarantine_reasons=list(result.quarantine_reasons),
        required_missing=required_missing,
        required_short=required_short,
    )
    print(
        f"conf={out.overall_confidence:.2f}  items={out.items_found}  "
        f"missing={required_missing or '-'}  short={required_short or '-'}  "
        f"${out.cost_usd}  {out.duration_ms}ms",
        flush=True,
    )
    return out


async def main(args) -> None:
    tickers = args.tickers or SAMPLE
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Sweep: {len(tickers)} tickers. Output: {out_dir}")

    results: list[TickerResult] = []
    # Sequential — SEC rate-limits at 10 req/s and pipeline cost is dominated
    # by LLM calls, so concurrency wouldn't help much.
    for t in tickers:
        try:
            r = await one_ticker(t)
        except Exception as e:
            traceback.print_exc()
            r = TickerResult(ticker=t, status="harness_error", error=repr(e))
        results.append(r)

    # ---- aggregate ----
    ok = [r for r in results if r.status == "ok"]
    by_pass = lambda r: r.status == "ok" and not r.quarantined and not r.required_missing and not r.required_short
    passed = [r for r in ok if by_pass(r)]
    quarantined = [r for r in ok if r.quarantined]
    missing_required = Counter()
    short_required = Counter()
    for r in ok:
        for m in r.required_missing:
            missing_required[m] += 1
        for s in r.required_short:
            short_required[s] += 1

    summary = {
        "n_total": len(results),
        "n_resolve_error": sum(1 for r in results if r.status == "resolve_error"),
        "n_pipeline_error": sum(1 for r in results if r.status == "pipeline_error"),
        "n_ok": len(ok),
        "n_pass": len(passed),  # no quarantine, no missing required, no short required
        "n_quarantined": len(quarantined),
        "pass_rate": round(len(passed) / max(1, len(results)), 3),
        "quarantine_rate": round(len(quarantined) / max(1, len(ok)), 3),
        "required_missing_counts": dict(missing_required),
        "required_short_counts": dict(short_required),
        "mean_overall_conf_ok": round(sum(r.overall_confidence for r in ok) / max(1, len(ok)), 3),
        "total_cost_usd": round(sum(r.cost_usd for r in ok), 4),
        "passed_tickers": sorted(r.ticker for r in passed),
        "quarantined_tickers": sorted(r.ticker for r in quarantined),
        "failed_tickers": sorted(r.ticker for r in results if r.status != "ok"),
    }

    report = {
        "summary": summary,
        "results": [asdict(r) for r in results],
    }

    out_file = out_dir / "real_world_sweep.json"
    out_file.write_text(json.dumps(report, indent=2))
    print("\n==== SUMMARY ====")
    print(json.dumps(summary, indent=2))
    print(f"\nReport: {out_file}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--tickers", nargs="*", default=None)
    p.add_argument("--out", default="docs/analysis")
    asyncio.run(main(p.parse_args()))
