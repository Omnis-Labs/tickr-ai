"""Task 2 endpoints — mounted onto the shared FastAPI app from task1_browser_agent.api.main."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from shared.logging import get_logger
from shared.schemas import FilingExtraction, JobStatus, Task2Job

from task2_10k_extractor.pipeline.orchestrator import new_job_id, run_pipeline

router = APIRouter(prefix="/task2", tags=["task2"])
logger = get_logger(__name__)


# Single-process in-memory store for MVP. Swap for Postgres-backed when
# multi-worker. Mirrors task1.JobStore pattern.
_JOBS: dict[str, Task2Job] = {}


class CreateExtractionBody(BaseModel):
    source_url: str = Field(min_length=10, max_length=2000)


class ParseInputBody(BaseModel):
    input: str = Field(min_length=1, max_length=500)


@router.post("/edgar/parse")
async def edgar_parse(body: ParseInputBody) -> dict:
    """LLM-powered free-text input parser.

    Accepts any input (English / Chinese / mixed) and returns the resolved
    EDGAR URL plus an `interpretation` string the frontend can show as a
    "Resolved as: …" pill.

    Single call from the frontend covers four flows:
      - User pastes a URL → returned directly.
      - User names a company → LLM extracts ticker → SEC submissions
        API → 10-K URL.
      - User wants a non-10-K form (10-Q etc.) → typed refusal.
      - User input has no SEC context → typed refusal.

    Uses CHEAP-tier LLM (~$0.0001/call) + Anthropic-style prompt caching
    on the system prompt. Total added latency vs. URL paste path: ~1 s.
    """
    from shared.llm_gateway import LLMGateway, LLMRequest, Tier, new_trace_id
    from task1_browser_agent.agent.prompt_loader import render as _render
    from task2_10k_extractor.eval.edgar_lookup import (
        KNOWN_CIKS,
        resolve_filing,
    )

    # Load the input_parser prompt from disk (split into system + user template).
    parser_dir = Path(__file__).resolve().parents[2] / "prompts" / "task2_10k"
    raw = (parser_dir / "input_parser.md").read_text(encoding="utf-8")
    system = raw.split("## System", 1)[1].split("## User template", 1)[0].strip()
    user_tmpl = raw.split("## User template", 1)[1].strip()
    user = _render(user_tmpl, user_input=body.input.strip())

    trace = new_trace_id()
    try:
        resp = await LLMGateway.instance().call(
            LLMRequest(
                trace_id=trace,
                purpose="task2.edgar_parser",
                tier=Tier.CHEAP,
                system=system,
                messages=[{"role": "user", "content": user}],
                max_tokens=250,
                temperature=0.0,
                response_format="json",
                cache_system=True,
            ),
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail={"kind": "llm_failed", "message": str(e)[:200]},
        )

    parsed = resp.parsed_json or {}
    kind = parsed.get("kind")

    if kind == "url":
        target = str(parsed.get("url", "")).strip()
        if not target.startswith(("http://", "https://")):
            raise HTTPException(
                status_code=400,
                detail={"kind": "refuse", "reason": "LLM returned a non-http URL"},
            )
        return {
            "url": target,
            "interpretation": "Direct EDGAR URL",
            "trace_id": trace,
            "parse_cost_usd": round(resp.cost_usd, 6),
        }

    if kind == "ticker_query":
        ticker = str(parsed.get("ticker", "")).upper().strip()
        year = parsed.get("year")
        company_guess = parsed.get("company_guess")
        if not ticker:
            raise HTTPException(
                status_code=400,
                detail={"kind": "refuse", "reason": "LLM did not produce a ticker"},
            )
        try:
            ref = await resolve_filing(ticker, fiscal_year=year if isinstance(year, int) else None)
        except KeyError as e:
            raise HTTPException(
                status_code=404,
                detail={
                    "kind": "ticker_unknown",
                    "ticker": ticker,
                    "company_guess": company_guess,
                    "message": str(e),
                },
            )
        except Exception as e:  # noqa: BLE001
            raise HTTPException(
                status_code=502,
                detail={"kind": "edgar_lookup_failed", "message": str(e)[:200]},
            )
        if ref is None:
            raise HTTPException(
                status_code=404,
                detail={
                    "kind": "filing_not_found",
                    "ticker": ticker,
                    "year": year,
                    "message": (
                        f"No 10-K found for {ticker}"
                        + (f" fiscal year {year}" if year else "")
                        + "."
                    ),
                },
            )
        company_label = company_guess or ticker
        interpretation = (
            f"{company_label} ({ref.ticker}) — FY{ref.fiscal_year} 10-K, "
            f"accession {ref.accession_number}"
        )
        return {
            "url": ref.url,
            "interpretation": interpretation,
            "ticker": ref.ticker,
            "year": ref.fiscal_year,
            "industry": ref.industry,
            "trace_id": trace,
            "parse_cost_usd": round(resp.cost_usd, 6),
        }

    if kind == "unsupported":
        raise HTTPException(
            status_code=400,
            detail={
                "kind": "unsupported",
                "reason": parsed.get("reason", "Form type other than 10-K"),
                "company_guess": parsed.get("company_guess"),
            },
        )

    # kind == "refuse" or unrecognised
    raise HTTPException(
        status_code=400,
        detail={
            "kind": "refuse",
            "reason": parsed.get("reason", "Could not interpret as an SEC 10-K request."),
        },
    )


@router.get("/edgar/lookup")
async def edgar_lookup(
    ticker: str,
    year: int | None = None,
) -> dict[str, str | int | None]:
    """Resolve a ticker (+ optional fiscal year) to an EDGAR 10-K URL.

    Calls the same SEC submissions-API helper the eval set generator uses.
    Returns 404 with a friendly message when the ticker is not in our
    KNOWN_CIKS table or the requested year is not in the filer's history.
    """
    from task2_10k_extractor.eval.edgar_lookup import KNOWN_CIKS, resolve_filing

    t = ticker.strip().upper()
    if t not in KNOWN_CIKS:
        raise HTTPException(
            status_code=404,
            detail={
                "kind": "ticker_unknown",
                "message": (
                    f"Ticker '{t}' is not in our supported list. "
                    "Add it to KNOWN_CIKS in task2_10k_extractor/eval/edgar_lookup.py, "
                    "or paste a full EDGAR URL instead."
                ),
                "supported_tickers": sorted(KNOWN_CIKS.keys()),
            },
        )
    try:
        ref = await resolve_filing(t, fiscal_year=year)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail={"kind": "edgar_lookup_failed", "message": str(e)[:300]},
        )
    if ref is None:
        raise HTTPException(
            status_code=404,
            detail={
                "kind": "filing_not_found",
                "message": (
                    f"No 10-K found for {t}"
                    + (f" fiscal year {year}" if year else " in EDGAR recent block")
                    + "."
                ),
            },
        )
    return {
        "ticker": ref.ticker,
        "company": ref.ticker,
        "cik": ref.cik,
        "industry": ref.industry,
        "fiscal_year": ref.fiscal_year,
        "accession_number": ref.accession_number,
        "filed_date": ref.filed_date,
        "url": ref.url,
    }


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/capabilities")
async def capabilities() -> dict[str, object]:
    """Detailed capability matrix.

    `proven_supported_filings` and `known_failure_cases` are CONCRETE example
    URLs drawn from our eval baseline, so reviewers can verify behaviour
    directly. `format_categories` enumerates the broader format buckets and
    `refusal_categories` documents the typed-refusal flows that prevent the
    system from hallucinating answers on out-of-scope inputs.
    """
    return {
        "proven_supported_filings": [
            # Pass cases from the committed task2_10k_extractor/eval/report.json
            # baseline (19/20 across 7 industries + 3 pre-iXBRL filings).
            {
                "label": "Apple (AAPL) FY2023 10-K",
                "industry": "tech",
                "url": "https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm",
                "items_extracted": 23,
                "overall_confidence": 0.948,
                "method_mix": "L1 × 23",
                "cost_usd": 0.0,
                "notes": "Modern iXBRL — golden case for L1 anchor extractor",
            },
            {
                "label": "Microsoft (MSFT) FY2023 10-K",
                "industry": "tech",
                "url": "https://www.sec.gov/Archives/edgar/data/789019/000095017023035122/msft-20230630.htm",
                "items_extracted": 22,
                "overall_confidence": 0.948,
                "method_mix": "L1 × 22",
                "cost_usd": 0.0,
                "notes": "Page running-headers DOM exercises density-based TOC + first-with-gap heuristic (see bug T2.1 in VERIFICATION.md)",
            },
            {
                "label": "JPMorgan Chase (JPM) FY2025 10-K",
                "industry": "bank",
                "url": "https://www.sec.gov/Archives/edgar/data/19617/000162828026008131/jpm-20251231.htm",
                "items_extracted": 22,
                "overall_confidence": 0.947,
                "method_mix": "L1 × 22",
                "cost_usd": 0.0,
                "notes": "Large bank filing — incorporated-by-reference handled gracefully",
            },
            {
                "label": "ExxonMobil (XOM) FY2025 10-K",
                "industry": "energy",
                "url": "https://www.sec.gov/Archives/edgar/data/34088/000003408826000045/xom-20251231.htm",
                "items_extracted": 22,
                "overall_confidence": 0.946,
                "method_mix": "L1 × 22",
                "cost_usd": 0.0,
            },
            {
                "label": "Walmart (WMT) FY2026 10-K",
                "industry": "retail",
                "url": "https://www.sec.gov/Archives/edgar/data/104169/000010416926000055/wmt-20260131.htm",
                "items_extracted": 23,
                "overall_confidence": 0.935,
                "method_mix": "L1 × 23",
                "cost_usd": 0.0,
                "notes": "Different fiscal-year-end (January) — confirms year-independence",
            },
            {
                "label": "Johnson & Johnson (JNJ) FY2025 10-K",
                "industry": "pharma",
                "url": "https://www.sec.gov/Archives/edgar/data/200406/000020040626000016/jnj-20251228.htm",
                "items_extracted": 23,
                "overall_confidence": 0.948,
                "method_mix": "L1 × 23",
                "cost_usd": 0.0,
            },
            {
                "label": "Apple (AAPL) FY2015 10-K — pre-iXBRL",
                "industry": "tech",
                "url": "https://www.sec.gov/Archives/edgar/data/320193/000119312515356351/d17062d10k.htm",
                "items_extracted": 20,
                "overall_confidence": 0.948,
                "method_mix": "L1 × 20",
                "cost_usd": 0.0,
                "notes": "Pre-iXBRL plain HTML — proves L1 anchor extractor is not iXBRL-dependent",
            },
            {
                "label": "JPMorgan Chase (JPM) FY2015 10-K — pre-iXBRL",
                "industry": "bank",
                "url": "https://www.sec.gov/Archives/edgar/data/19617/000001961716000902/corp10k2015.htm",
                "items_extracted": 20,
                "overall_confidence": 0.947,
                "method_mix": "L1 × 20",
                "cost_usd": 0.0,
                "notes": "Pre-iXBRL bank filing — heavily references-by-reference",
            },
        ],
        "known_failure_cases": [
            {
                "label": "Microsoft (MSFT) FY2015 10-K — pre-iXBRL",
                "url": "https://www.sec.gov/Archives/edgar/data/789019/000119312515272806/d918813d10k.htm",
                "issue": "Item 8 (Financial Statements and Supplementary Data) cannot be located",
                "root_cause": "Pre-iXBRL filing incorporates Item 8 entirely by reference to financial statement exhibits — no in-document section exists",
                "system_response": "Quarantined with `required item '8' missing` reason. System refuses to fabricate content rather than hallucinating",
                "fix_direction": "L3 LLM probe could detect the reference pattern and emit a structured 'incorporated by reference' marker rather than just missing",
            },
            {
                "label": "Citigroup (C) FY2025 10-K",
                "url": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=831001&type=10-K",
                "issue": "Item 7 (MD&A) entirely missing; Item 1 (Business) truncated. 19/23 items, coverage 0.81",
                "root_cause": "Citi's MD&A is not introduced by any 'Management's Discussion and Analysis' or 'Item 7.' heading string our detector recognises, so L1 has no anchor to land on (heading-detection collapse — only ~3 body headings detected for the whole filing)",
                "system_response": "QUARANTINED by the structural gate (ADR-007): reasons 'core item 7 (MD&A) missing', 'core item 1 (Business) truncated'. The extraction is still incomplete, but the system no longer vouches for it — the user is told exactly which substance items failed. (Pre-ADR-007 it slipped through at confidence 0.48.)",
                "fix_direction": "Extraction itself needs a normalize-layer heading-detection rework or an LLM full-document segmentation pass; the gate already prevents silent bad output in the meantime",
            },
            {
                "label": "Intel (INTC) FY2025 10-K",
                "url": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=50863&type=10-K",
                "issue": "Items 1 (Business) and 8 (Financial Statements) truncated below floor",
                "root_cause": "Intel labels its Item 1 body 'Our Business' (non-canonical) and its TOC sits at the very end of the document; the gap-based picker recovered Items 1A/7 (fix shipped 2026-06-04) but Items 1 + 8 still mis-bound",
                "system_response": "QUARANTINED by the structural gate (ADR-007): 'core item 1 (Business) truncated — 221 < 2000 chars', 'core item 8 (Financial Statements) truncated — 73 < 2000 chars'. No longer a silent partial result.",
                "fix_direction": "Expand canonical-title list + normalize-layer heading detection; gate guarantees the failure is visible today",
            },
        ],
        "format_categories": {
            "supported": [
                "Modern iXBRL 10-K (2017+) — golden path",
                "Pre-iXBRL plain HTML 10-K (any year)",
                "10-K filings with page running-headers, TOC anchors, density-detected TOC",
                "Filings with incorporated-by-reference content (Items 10–14 commonly)",
            ],
            "unsupported_or_unreliable": [
                {
                    "pattern": "Foreign filers (file 20-F, not 10-K)",
                    "example": "TSMC, Toyota, ASML",
                    "system_response": "LLM input parser returns `kind: 'unsupported'` with explanation",
                },
                {
                    "pattern": "Other SEC forms — 10-Q, 8-K, S-1, 13F-HR, 13D",
                    "example": "Tesla 10-Q",
                    "system_response": "Same — typed `unsupported` refusal from parser",
                },
                {
                    "pattern": "Image-only PDF filings",
                    "example": "Some smaller filers' historical 10-Ks",
                    "system_response": "No OCR layer; ingestion produces empty IR and quarantines with `no items extracted`",
                },
                {
                    "pattern": "10-K/A amendments — tracked but not differentiated",
                    "example": "Filings ending in 10-K/A",
                    "system_response": "Pipeline extracts items, but `is_amendment` field not yet surfaced (planned in PRODUCTION_HARDENING_ROADMAP Week 8)",
                },
            ],
        },
        "refusal_categories": [
            {
                "category": "Unknown ticker",
                "example_input": "PTLR 2024 (not a current SEC-registered symbol; Permian Resources actually trades as PR)",
                "system_response": "HTTP 404 — `Ticker not in SEC's public registry`. Frontend shows actionable guidance",
            },
            {
                "category": "Non-public-company input",
                "example_input": "what is the meaning of life",
                "system_response": "LLM parser returns `kind: 'refuse'` with reason: `Input does not name a specific publicly-traded company`",
            },
            {
                "category": "Vague company reference",
                "example_input": "the search engine company",
                "system_response": "Typed refuse — parser is instructed to refuse rather than hallucinate a ticker without explicit naming",
            },
        ],
        "supported": [
            # Backward-compat field for clients of the previous schema.
            {
                "kind": "Modern iXBRL 10-K (2016+)",
                "example": "https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm",
                "notes": "Standard SEC iXBRL filings have explicit Item headings — L1 anchors hit reliably.",
            },
            {
                "kind": "Plain HTML 10-K",
                "example": "https://www.sec.gov/Archives/edgar/data/320193/000119312515356351/d17062d10k.htm",
                "notes": "Pre-iXBRL filings — L1 works as long as headings include the literal 'Item X.' marker.",
            },
        ],
        "unsupported_or_unreliable": [
            {
                "pattern": "10-K filings only — other forms (10-Q, 8-K, S-1, 20-F) get a typed refusal",
                "reason": "Item schema (Items 1–16) is 10-K specific; LLM parser refuses non-10-K forms rather than misapplying the schema",
            },
            {
                "pattern": "Image-only PDF filings",
                "reason": "No OCR layer; we read HTML only.",
            },
            {
                "pattern": "Filings with non-standard item numbering (e.g. older foreign issuers)",
                "reason": "Some foreign issuers and amendments deviate from Items 1–16 ordering; LLM parser refuses 20-F filers up front",
            },
        ],
        "extraction_layers": {
            "L1_anchor": "implemented — regex + heading scan + density-based TOC + first-with-gap heuristic, zero LLM cost",
            "L2_structural": "implemented — TOC anchor reverse-lookup via captured anchor targets, zero LLM cost",
            "L3_llm_self_consistency": "implemented — two independent prompts + boundary IoU agreement check, cost-capped per filing",
            "quarantine_threshold": 0.45,
            "confidence_calibration": "Platt-scaled sigmoid trained on 192 synthetic labels — ECE 0.056 (production calibration requires ~20 human-graded examples)",
        },
        "schema_version": "1.0.0",
    }


@router.post("/extractions", response_model=Task2Job)
async def create_extraction(body: CreateExtractionBody) -> Task2Job:
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task2Job(
        job_id=job_id,
        source_url=body.source_url,
        status=JobStatus.PENDING,
        created_at=now,
        updated_at=now,
    )
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/extractions", response_model=list[Task2Job])
async def list_extractions() -> list[Task2Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/extractions/{job_id}", response_model=Task2Job)
async def get_extraction(job_id: str) -> Task2Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "extraction not found")
    return job


async def _run(job: Task2Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        result: FilingExtraction = await run_pipeline(url=job.source_url, job_id=job.job_id)
        job.extraction = result
        job.status = JobStatus.QUARANTINED if result.quarantined else JobStatus.SUCCEEDED
    except Exception as e:  # noqa: BLE001
        logger.exception("task2_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
