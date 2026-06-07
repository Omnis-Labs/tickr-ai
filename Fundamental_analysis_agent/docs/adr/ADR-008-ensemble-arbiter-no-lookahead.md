# ADR-008 — The ensemble arbiter sees reasoning, not realized returns

**Date:** 2026-06-07
**Status:** Accepted
**Context for:** Task 5 — ensemble / multi-agent arbitration.

## Context

Task 5 fuses two existing agents on one ticker:

- the **fundamental** agent (Task 3 — a strategy authored from the latest 10-K), and
- the **technical** agent (Task 4 — a strategy authored from as-of indicator readings).

An LLM **arbiter** decides *how* to combine them, picking one `combine_mode` from a
fixed DSL (`and` / `or` / `weighted` / `fundamental_gated_technical` /
`defer_fundamental` / `defer_technical`). The combined daily position is then
backtested over a single common window.

Task 3 and Task 4 share a hard discipline: the LLM authors its strategy **before**
the backtest runs, so the *selection* cannot be fit to the test window. (Execution
is rule-based, so future prices can't leak into the run either — but selection bias
is the subtler risk.) The question for Task 5: **what may the arbiter see?**

The tempting answer is "everything, including each leg's backtest performance — an
informed committee chair would look at the track record." But each leg is
backtested over the *same window the ensemble is then scored on*. If the arbiter
chooses the combine policy after seeing those realized returns, it is selecting the
policy to fit the test window — exactly the lookahead/overfitting failure the rest
of the system is built to prevent. With six modes and two weights, an arbiter shown
the scores can trivially pick the mode that happened to win in-sample.

## Decision

The arbiter is given each leg's **forward-looking reasoning only**:

- stance (bullish / neutral / cautious),
- the thesis text,
- the chosen entry/exit signals,
- the evidence each leg cites (Task 3's 10-K citations; Task 4's as-of indicator
  readings).

It is **not** given either leg's realized return, alpha, Sharpe, drawdown, or any
backtest metric. The prompt states this explicitly and instructs the model not to
speculate about realized performance. The combined backtest that follows is the
genuine out-of-sample check on the arbiter's choice.

Realized returns per leg **are** computed and **are** shown to the *user* in the
result (so the UI can show "ensemble vs each agent alone") — the withholding
applies only to the arbiter's prompt, after which the decision is already made.

```
author fundamental leg ─┐
                        ├─ stances + theses + signals + evidence ──▶ ARBITER ──▶ combine_mode
author technical leg  ──┘            (NO realized returns)                          │
                                                                                    ▼
                              deterministic combine → ONE backtest (out-of-sample check)
                                                                                    │
                                                       returns shown to USER ◀───────┘
```

## Consequences

- The combine policy is chosen on the same information footing as each leg's own
  strategy — consistent with the whole system's "select forward, test out-of-sample"
  stance. Task 5 inherits Task 3/4's lookahead guarantees rather than weakening them.
- The arbiter is "weaker" than a chair who peeks at the track record. That is the
  intended trade: a policy that looks good only because it was picked after seeing
  the scores is not evidence of edge.
- When only one leg is available (no 10-K / foreign filer / quarantined extraction),
  no arbitration happens at all — the ensemble deterministically defers to the
  available leg (`defer_technical` / `defer_fundamental`) with a loud caveat. No LLM
  call, no decision to bias.
- A deterministic stance-based fallback covers an unavailable/garbled LLM response,
  so the agent fails soft, never silent (the fallback reason is logged + surfaced).

## Notes

The combined backtest reuses Task 4's `_metrics` verbatim, so the ensemble is scored
on exactly the same ruler (Sharpe, drawdown, alpha vs S&P 500, entry-aligned
benchmark) as the legs it is compared against. The unit test
`test_defer_technical_reproduces_technical_backtest` pins the consistency property:
an ensemble that defers to one agent reproduces that agent's own backtest.
