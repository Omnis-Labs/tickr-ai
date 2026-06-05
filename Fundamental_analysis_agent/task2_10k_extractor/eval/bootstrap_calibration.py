"""Auto-bootstrap Platt-scaling labels from the eval set.

We do NOT have a hand-labelled dev set yet. Until somebody hand-grades item
boundaries, we synthesize labels from observable signals that strongly
correlate with extraction correctness:

  Positive label (correct):
    * Item is REQUIRED (in REQUIRED_ITEMS), AND
    * char_length is between the canonical min floor and a reasonable max
      (e.g. Item 1A: 5K–500K), AND
    * The eval case as a whole passed all assertions (no upstream bug)

  Negative label (incorrect):
    * Item has `notes` containing "empty content" or "TOC" anchor warning, OR
    * REQUIRED item char_length is < 25 % of the canonical floor, OR
    * The eval case as a whole was quarantined / failed

Synthetic labels are clearly tagged in the persisted file. The Platt fit
produced is a starting point for the dashboard's calibrated display, not a
substitute for human grading. Replace with hand-labelled data when available.

Usage:
    python -m task2_10k_extractor.eval.bootstrap_calibration build
    python -m task2_10k_extractor.eval.bootstrap_calibration train  # also: fit + persist
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from shared.cost_ledger import init_db
from task2_10k_extractor.pipeline.calibration import (
    LabeledExample,
    _LABELS_PATH,
    _PARAMS_PATH,
    _fit_platt,
)
from task2_10k_extractor.pipeline.confidence import (
    MIN_CHAR_LENGTH_HINTS,
    OPTIONAL_ITEMS,
    REQUIRED_ITEMS,
)
from task2_10k_extractor.pipeline.orchestrator import run_pipeline


EVAL_SET = Path(__file__).parent / "eval_set.yaml"

# "Sensible max" per required item — items longer than this are likely
# capturing chunks of the next item too. Conservative caps.
MAX_CHAR_LENGTH_HINTS = {
    "1": 250_000,
    "1A": 500_000,
    "7": 250_000,
    "7A": 100_000,
    "8": 600_000,  # financial statements are long
    "9A": 50_000,
    "15": 200_000,
}


def _synthetic_label(item: Any, case_passed: bool) -> bool | None:
    """Return True/False label, or None if too ambiguous to label."""
    iid = item.item_id
    is_optional = iid in OPTIONAL_ITEMS

    # Hard negatives: "empty content" or "TOC anchor only" for REQUIRED items
    if not is_optional and item.notes:
        if "empty content" in item.notes:
            return False
        if "TOC" in item.notes:
            return False

    # Hard negatives: REQUIRED item way under its floor
    floor = MIN_CHAR_LENGTH_HINTS.get(iid, 0)
    if not is_optional and floor and item.char_length < floor * 0.25:
        return False

    # Hard negatives: REQUIRED item over its sensible max (= absorbed next item)
    cap = MAX_CHAR_LENGTH_HINTS.get(iid, 0)
    if not is_optional and cap and item.char_length > cap:
        return False

    # The case-level fail is a weak signal — could be one bad item dragging
    # down or could be all items off. Don't use case_passed as a label by
    # itself, but DO use it to be conservative on borderline cases.
    if not case_passed and item.confidence < 0.5:
        return False

    # Positives: REQUIRED item in plausible length range, no warning notes,
    # case passed all assertions.
    if not is_optional and floor and item.char_length >= floor and case_passed:
        return True
    # Optional items: only label positive if length looks normal (not empty,
    # not absurdly long) — these are easy to ignore but we want SOMETHING
    # in this distribution for the model to learn.
    if is_optional and 30 < item.char_length < 50_000 and case_passed:
        return True

    return None  # ambiguous


async def build_labels() -> list[LabeledExample]:
    """Run every eval case and collect synthetic labels."""
    await init_db()
    spec = yaml.safe_load(EVAL_SET.read_text(encoding="utf-8"))
    labels: list[LabeledExample] = []
    for case in spec["cases"]:
        url = case.get("url")
        if not url or case.get("id") == "invalid-url-graceful-fail":
            continue
        try:
            result = await run_pipeline(url=url)
        except Exception as e:  # noqa: BLE001
            print(f"  [skip] {case['id']}: {e}", file=sys.stderr)
            continue
        # Re-check assertions to decide case-level pass (used as weak signal)
        case_passed = (not result.quarantined) and (
            result.overall_confidence >= case["assertions"].get("min_overall_confidence", 0.0)
        )
        for it in result.items:
            label = _synthetic_label(it, case_passed)
            if label is None:
                continue
            # NOTE: use the *raw* per-item confidence as the feature. This
            # is what the orchestrator passes to apply_calibration() at runtime.
            labels.append(
                LabeledExample(
                    raw_score=it.confidence,
                    correct=label,
                    case_id=case["id"],
                    item_id=it.item_id,
                )
            )
    return labels


def _save_labels(labels: list[LabeledExample]) -> None:
    _LABELS_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "_provenance": {
            "source": "synthetic (auto-bootstrapped from eval baseline)",
            "generator": "task2_10k_extractor.eval.bootstrap_calibration",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "caveat": "NOT HUMAN-LABELLED. Replace with hand-graded data before using calibrated confidence as a probability in production decisions.",
        },
        "labels": [
            {
                "raw_score": e.raw_score,
                "correct": e.correct,
                "case_id": e.case_id,
                "item_id": e.item_id,
            }
            for e in labels
        ],
    }
    # The Platt module expects a list, so we also write a sibling .raw.json
    # for human review (with provenance) and the bare list for the trainer.
    _LABELS_PATH.write_text(json.dumps(payload["labels"], indent=2))
    sidecar = _LABELS_PATH.with_suffix(".provenance.json")
    sidecar.write_text(json.dumps(payload["_provenance"], indent=2))


async def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("build", help="Run eval + emit synthetic labels.json")
    sub.add_parser(
        "train",
        help="Build + fit Platt + persist platt_params.json (one-shot)",
    )
    args = parser.parse_args()

    print("Building synthetic labels from eval set (this runs the full pipeline)...")
    labels = await build_labels()
    print(f"Collected {len(labels)} labels "
          f"({sum(1 for l in labels if l.correct)} positive, "
          f"{sum(1 for l in labels if not l.correct)} negative)")
    _save_labels(labels)
    print(f"  → {_LABELS_PATH}")

    if args.cmd == "train":
        params = _fit_platt(labels)
        _PARAMS_PATH.write_text(json.dumps(params.__dict__, indent=2))
        print(f"Fit Platt: a={params.a:.3f} b={params.b:.3f} "
              f"ECE={params.ece} Brier={params.brier} n_train={params.n_train}")
        print(f"  → {_PARAMS_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
