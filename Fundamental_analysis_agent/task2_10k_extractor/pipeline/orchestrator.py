"""Task 2 — orchestrate the L1 → L2 → L3 pipeline.

Current state: L1 + confidence scoring + quarantine. L2 (structural) and L3
(LLM self-consistency) are stubbed as hooks at the right place. Adding them
later is a localised change.
"""

from __future__ import annotations

import time
import uuid
from collections import Counter
from datetime import datetime, timezone

from shared.cost_ledger import cost_for_trace
from shared.logging import get_logger
from shared.schemas import FilingExtraction, JobStatus

from task2_10k_extractor.pipeline.confidence import (
    QUARANTINE_THRESHOLD,
    REQUIRED_ITEMS,
    core_item_gate,
    score_items,
)
from task2_10k_extractor.pipeline.ingest import fetch_filing
from task2_10k_extractor.pipeline.l1_anchor import extract_l1
from task2_10k_extractor.pipeline.l2_structural import extract_l2
from task2_10k_extractor.pipeline.l3_llm import maybe_extract_l3
from task2_10k_extractor.pipeline.recover import recover_core_items
from task2_10k_extractor.pipeline.calibration import apply_calibration
from task2_10k_extractor.pipeline.normalize import normalize_html, persist_ir

logger = get_logger(__name__)


def new_job_id() -> str:
    return uuid.uuid4().hex[:16]


async def run_pipeline(
    *, url: str, job_id: str | None = None, enable_l3: bool = True
) -> FilingExtraction:
    """Full pipeline. Returns FilingExtraction; cost is queried from ledger.

    `enable_l3=False` skips the L3 LLM self-consistency layer — useful for
    latency-sensitive callers (e.g. Task 3's interactive flow) where L3 adds
    ~20 s of sequential LLM calls but, in practice, rarely recovers a core item
    that L1/L2 missed. The structural quarantine gate runs the same either way.
    """
    job_id = job_id or new_job_id()
    started = time.perf_counter()

    # ----- INGEST -----------------------------------------------------------
    filing_meta, html = await fetch_filing(url=url, job_id=job_id)
    logger.info("ingest_done", job_id=job_id, bytes=len(html))

    # ----- NORMALIZE --------------------------------------------------------
    ir = normalize_html(html)
    await persist_ir(job_id=job_id, ir=ir)
    logger.info(
        "normalize_done",
        job_id=job_id,
        char_total=ir.char_total,
        headings=len(ir.headings),
    )

    # ----- L1 ---------------------------------------------------------------
    items = extract_l1(ir)
    n_l1 = len(items)
    logger.info("l1_done", job_id=job_id, items_found=n_l1)

    # Pre-score to decide whether to invoke deeper layers. Cheap — just looks
    # at coverage and item-length plausibility, no LLM.
    _, pre_overall, _ = score_items(list(items), total_chars=ir.char_total)
    l1_required_coverage = (
        len([i for i in REQUIRED_ITEMS if i in {it.item_id for it in items}])
        / max(1, len(REQUIRED_ITEMS))
    )

    # ----- L2 (structural — TOC anchor reverse-lookup) ----------------------
    # Run when L1 missed any required item OR overall confidence is below
    # the release threshold. Cheap (zero LLM), so we lean on it generously.
    if l1_required_coverage < 1.0 or pre_overall < 0.7:
        l2_items = extract_l2(l1_items=items, ir=ir)
        n_l2_recovered = sum(1 for it in l2_items if it.extraction_method == "L2")
        if n_l2_recovered > 0:
            logger.info("l2_engaged", job_id=job_id, recovered=n_l2_recovered)
            items = l2_items

    # ----- L3 (LLM self-consistency, cost-capped) --------------------------
    # Fires only when required items are missing or below 0.6 confidence
    # after L1 + L2. Budget cap enforced inside; per-call cost recorded in
    # the ledger under purpose=task2.l3.extractor_a|b.
    _, post_l2_overall, _ = score_items(list(items), total_chars=ir.char_total)
    if enable_l3 and (post_l2_overall < 0.6 or l1_required_coverage < 1.0):
        items = await maybe_extract_l3(trace_id=job_id, items=items, ir=ir)

    # ----- RECOVERY (deterministic, zero-LLM) -------------------------------
    # Label legitimate incorporation-by-reference (Part III → proxy, Item 8 →
    # Item 15) and gap-fill core items that are cleanly bracketed by trusted
    # neighbours. Makes the extraction both more correct and more honest
    # before it hits the hard structural gate. See pipeline/recover.py.
    items = recover_core_items(items, ir)

    # ----- SCORE + CALIBRATE + QUARANTINE -----------------------------------
    items, raw_overall, quarantine_reasons = score_items(items, total_chars=ir.char_total)
    overall, calibrated = apply_calibration(raw_overall)
    if calibrated:
        # Also rescale per-item confidences. Cheap: each is one sigmoid eval.
        for it in items:
            it.confidence = round(apply_calibration(it.confidence)[0], 4)
    method_counts = Counter(it.extraction_method for it in items)

    # Hard structural gate: any missing/truncated core substance item
    # quarantines regardless of the learned score. This is the primary
    # reliability mechanism — the score alone missed every real failure in
    # the sweep (see pipeline/confidence.core_item_gate).
    core_gate_reasons = core_item_gate(items)
    quarantine_reasons.extend(core_gate_reasons)

    quarantined = (
        overall < QUARANTINE_THRESHOLD
        or bool(core_gate_reasons)
        or bool([r for r in quarantine_reasons if "no items" in r or "below 50%" in r])
    )
    if not calibrated:
        # Surface honestly: until labels exist, we expose the raw score and
        # mark the reasons list so the dashboard can flag "uncalibrated".
        quarantine_reasons.append(
            "confidence uncalibrated (no Platt model trained yet; "
            "see task2_10k_extractor/pipeline/calibration.py)"
        )

    cost = await cost_for_trace(job_id)
    duration_ms = int((time.perf_counter() - started) * 1000)

    found_ids = {it.item_id for it in items}
    n_required_found = len([i for i in REQUIRED_ITEMS if i in found_ids])

    return FilingExtraction(
        job_id=job_id,
        filing=filing_meta,
        items=items,
        overall_confidence=round(overall, 4),
        quarantined=quarantined,
        quarantine_reasons=quarantine_reasons,
        extraction_method_summary={
            "L1": method_counts.get("L1", 0),
            "L2": method_counts.get("L2", 0),
            "L3": method_counts.get("L3", 0),
        },
        n_expected_items=len(REQUIRED_ITEMS),
        n_found_items=n_required_found,
        coverage_ratio=round(n_required_found / max(1, len(REQUIRED_ITEMS)), 4),
        cost_usd=round(cost, 6),
        duration_ms=duration_ms,
        created_at=datetime.now(timezone.utc),
    )
