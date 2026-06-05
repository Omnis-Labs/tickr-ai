"""Confidence calibration via Platt scaling — scaffold + persistence layer.

PLAN.md §3.5 specifies that the raw confidence score (weighted sum of
anchor_coverage / boundary_agreement / structural_invariant / cross_year)
must be **calibrated** so that "0.85 confidence" actually corresponds to
~85% correct extractions on held-out data. Without calibration, the score
is a useful ordering but not a probability.

This module:
  * Stores a labelled dev set on disk (`labels.json`).
  * Trains a 1-D logistic regression (Platt scaling) from raw score → P(correct).
  * Applies the trained transform to a new raw score at runtime.
  * Reports calibration quality (Expected Calibration Error / Brier).

We deliberately do NOT auto-train at runtime — calibration is a model that
should be reviewed against the eval baseline before being released. Train
once via the CLI; persist `platt_params.json`; the orchestrator reads it
on next run.

Status: **scaffolded but NOT TRAINED**. We need ~20 hand-labelled
(extraction → correct/incorrect) pairs before the Platt fit is meaningful.
Today the eval set has 17 filings × 16 required items = 272 candidate
labels, but they are not yet hand-graded. Calibration applies only after
labels exist.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

from shared.logging import get_logger

logger = get_logger(__name__)


_LABELS_PATH = Path(__file__).resolve().parents[1] / "eval" / "labels.json"
_PARAMS_PATH = Path(__file__).resolve().parents[1] / "eval" / "platt_params.json"


@dataclass
class PlattParams:
    """Sigmoid `1 / (1 + exp(a*x + b))` parameters. a < 0 means score
    correlates positively with P(correct)."""

    a: float
    b: float
    n_train: int
    ece: float           # expected calibration error on training set
    brier: float
    fit_at: str

    def transform(self, raw_score: float) -> float:
        """Standard Platt: P(correct) = 1 / (1 + exp(a*x + b)).

        With `a < 0`, P increases with raw_score (the common case — higher
        raw confidence is more likely correct). With `a > 0`, P decreases.
        Sign of `a` is determined by the training data; we don't enforce it.
        """
        z = self.a * raw_score + self.b
        # Numerically stable: never compute exp() of a large positive number.
        if z >= 0:
            ez = math.exp(-z)
            return ez / (1.0 + ez)
        ez = math.exp(z)
        return 1.0 / (1.0 + ez)


def load_params() -> PlattParams | None:
    if not _PARAMS_PATH.exists():
        return None
    try:
        data = json.loads(_PARAMS_PATH.read_text(encoding="utf-8"))
        return PlattParams(**data)
    except Exception as e:  # noqa: BLE001
        logger.warning("platt_params_load_failed", error=str(e)[:200])
        return None


def apply_calibration(raw_score: float) -> tuple[float, bool]:
    """Return (calibrated_score, used_calibration).

    If no trained model exists yet, returns the raw score unchanged with
    used_calibration=False so callers can label the dashboard accordingly.
    """
    params = load_params()
    if params is None:
        return raw_score, False
    return params.transform(raw_score), True


# ---------------------------------------------------------------------------
# Training (CLI-driven; not invoked at request time)
# ---------------------------------------------------------------------------


@dataclass
class LabeledExample:
    raw_score: float
    correct: bool       # True if the extraction was actually correct
    case_id: str
    item_id: str


def _load_labels() -> list[LabeledExample]:
    if not _LABELS_PATH.exists():
        return []
    raw = json.loads(_LABELS_PATH.read_text(encoding="utf-8"))
    return [LabeledExample(**r) for r in raw]


def _fit_platt(examples: list[LabeledExample], *, max_iter: int = 300) -> PlattParams:
    """Fit Platt scaling via gradient descent on log-loss.

    Implementation note: we avoid sklearn here for zero-dep deployment.
    Standard scaled-input + analytic gradient + small Tikhonov regulariser.
    """
    if not examples:
        raise RuntimeError("no labels to train on")

    xs = [e.raw_score for e in examples]
    ys = [1.0 if e.correct else 0.0 for e in examples]

    a, b = -1.0, 0.0  # init slope negative (higher score → higher P)
    lr = 0.5
    for _ in range(max_iter):
        ga = gb = 0.0
        for x, y in zip(xs, ys, strict=True):
            z = a * x + b
            # sigmoid(-z) gives P(label=1)
            if -z >= 0:
                p1 = 1.0 / (1.0 + math.exp(z))
            else:
                ez = math.exp(-z)
                p1 = ez / (1.0 + ez)
            diff = p1 - y
            # gradient of cross-entropy w.r.t. a,b
            ga += diff * (-x)
            gb += diff * (-1)
        # Tikhonov regularisation pulls slope toward -1 (gentle prior)
        ga += 0.01 * (a - (-1.0))
        gb += 0.01 * b
        a -= lr * ga / len(examples)
        b -= lr * gb / len(examples)

    # Eval
    brier = 0.0
    buckets: dict[int, list[float]] = {i: [] for i in range(10)}
    for x, y in zip(xs, ys, strict=True):
        params = PlattParams(a=a, b=b, n_train=0, ece=0.0, brier=0.0, fit_at="")
        p = params.transform(x)
        brier += (p - y) ** 2
        bkt = min(9, int(p * 10))
        buckets[bkt].append(y)
    brier /= max(1, len(examples))
    # ECE: |avg_predicted_in_bucket - avg_actual| weighted by bucket size
    ece = 0.0
    n = len(examples)
    for bkt, ys_in in buckets.items():
        if not ys_in:
            continue
        mid = (bkt + 0.5) / 10
        avg_actual = sum(ys_in) / len(ys_in)
        ece += (len(ys_in) / n) * abs(mid - avg_actual)

    from datetime import datetime, timezone

    return PlattParams(
        a=a,
        b=b,
        n_train=len(examples),
        ece=round(ece, 4),
        brier=round(brier, 4),
        fit_at=datetime.now(timezone.utc).isoformat(),
    )


def _cli() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Calibration training & inspection")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    sub.add_parser("train")
    args = parser.parse_args()

    if args.cmd == "status":
        params = load_params()
        labels = _load_labels()
        print(f"Labels on disk: {len(labels)} ({_LABELS_PATH})")
        if params:
            print(
                f"Trained: a={params.a:.3f} b={params.b:.3f} "
                f"n_train={params.n_train} ECE={params.ece} Brier={params.brier}"
            )
            print(f"  fit_at: {params.fit_at}")
        else:
            print("Not trained yet. Run `train` after collecting >= 20 labels.")
        return 0
    if args.cmd == "train":
        labels = _load_labels()
        if len(labels) < 20:
            print(
                f"WARNING: only {len(labels)} labels — Platt fit will be unstable.",
                flush=True,
            )
        params = _fit_platt(labels)
        _PARAMS_PATH.write_text(json.dumps(params.__dict__, indent=2))
        print(f"Wrote {_PARAMS_PATH}: ECE={params.ece}  Brier={params.brier}")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(_cli())
