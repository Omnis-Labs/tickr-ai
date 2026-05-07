# Hunch — Signal Engine

> Two-stage signal pipeline, market scanning, proposal generation, sizing logic, LLM cost control, order tracking, and back-evaluation.
>
> **Read with**: data-model.md (schema + JSON interfaces), api-contract.md (WebSocket events + order state transitions)

---

## Overview

The Signal Engine runs in `apps/ws-server` as a standalone Node.js process. In the frozen synthetic-trigger architecture, only proposal generation and trigger monitoring are in the default runtime; tracker/eval/thesis jobs are env-gated.

1. **Market Scanner** — monitor all supported assets for trading opportunities
2. **Proposal Generator** — convert opportunities into personalized BUY proposals per user
3. **Trigger Monitor** — poll Pyth for OPEN synthetic Orders and emit `trigger:hit`
4. **Back-Evaluator** — score proposal quality after the fact (env-gated)

The pipeline is split into two stages to balance performance and cost (LLM calls) against personalization (per-user context).

---

## Stage 1: Market Scanner (Per Asset)

The ws-server scans all supported assets on a default 60-second interval. To control LLM costs, it uses a pre-filter and stagger strategy.

### Scan Cycle

1. Fetch live price from Pyth Hermes
2. **Pre-filter (free, no LLM call)** — only proceed to LLM if any of these conditions are met:
   - 5-minute price change > 0.5%
   - RSI enters overbought (>70) or oversold (<30)
   - MACD crossover detected
   - More than 15 minutes since this asset was last scanned by LLM
3. Fetch historical candles from Pyth Benchmarks (5-minute bars, last 24 hours)
4. Calculate technical indicators: RSI-14, MACD (12,26,9), MA20, MA50
5. Send to Claude Sonnet/Opus LLM
6. LLM returns a **base analysis**:
   - `action`: BUY or HOLD
   - `confidence`: 0.00–1.00
   - `rationale`: one-sentence summary
   - `what_changed`: the market event that triggered this analysis
   - `why_this_trade`: the argument connecting the event to the trade thesis
   - `entryPrice`: suggested trigger/entry price (may be current price for "buy now" signals, or a lower price for limit-buy-the-dip signals)
   - `takeProfitPrice`: suggested TP price
   - `stopLossPrice`: suggested SL price

Assets are staggered by `TICKER_STAGGER_SECONDS` (default: 2 seconds) to avoid API burst.

### LLM Cost Control

A daily USD cap (`LLM_DAILY_USD_CAP`, default: $10) limits LLM spend inside each running ws-server process. When the cap is reached, the scanner falls back to rule-based analysis using technical indicators only (no LLM calls). The counter resets on the UTC day boundary or process restart.

---

## Stage 2: Proposal Generator (Per User)

When a Market Scanner cycle produces a viable base analysis (confidence > 0.7 and action = BUY), the Proposal Generator personalizes it for each relevant user. **This stage makes zero LLM calls.**

### User Matching

Query users whose `mandate.marketFocus` includes any of this asset's `marketFocusTags`:

```sql
-- Pseudocode
SELECT users WHERE
  mandate.marketFocus contains ANY OF asset.marketFocusTags
  OR mandate.marketFocus contains "NO_PREFERENCE"
```

Skip users with no available USDC (cannot execute a BUY).

### Generation Steps

For each matching user:

1. Read mandate: `holdingPeriod`, `maxDrawdown`, `maxTradeSize`, `marketFocus`
2. Read portfolio: current positions, available USDC
3. **Calculate `suggestedSizeUsd`** (see Sizing Logic below)
4. **Derive mandate-adjusted TP/SL and expiry** (see Mandate Personalization below)
5. **Derive `suggestedTriggerPrice`**: use `baseAnalysis.entryPrice` as the default. If the base analysis does not include an entry price, use the current market price.
6. **Assemble `reasoning`** (rule-based):
   - `whatChanged`: carried from base analysis
   - `whyThisTrade`: carried from base analysis
   - `whyFitsMandate`: template-generated sentences mapping mandate parameters, e.g.:
     - "Fits your 1-2 week holding period"
     - "Position size $400 is within your $500 max trade size"
     - "Adds semiconductor exposure, which your mandate targets"
7. **Calculate `positionImpact`**: before/after comparison of asset weight, cash, and sector exposure. When the user already has active positions in the same asset, use aggregate exposure across all positions for the "before" state.
8. **Save** the Proposal to PostgreSQL
9. **Push** to the user's Socket.IO room via `proposal:new`

---

## Mandate Personalization (TP/SL/Expiry Adjustment)

Stage 1 produces shared base TP/SL prices. Stage 2 adjusts them per user's mandate before saving the Proposal.

### TP/SL Adjustment

```typescript
// Adjust SL to respect max drawdown
if (mandate.maxDrawdown !== null) {
  const maxSlPrice = triggerPrice * (1 - mandate.maxDrawdown);
  suggestedSlPrice = Math.max(baseAnalysis.stopLossPrice, maxSlPrice);
}
// If no maxDrawdown limit, use base SL directly
else {
  suggestedSlPrice = baseAnalysis.stopLossPrice;
}

// TP adjustment by holding period (longer = wider targets)
const tpMultiplier = {
  SHORT_TERM: 0.8, // Tighter TP for quick trades
  SWING: 1.0, // Base TP as-is
  MEDIUM_TERM: 1.2, // Wider TP for medium holds
  LONG_TERM: 1.5, // Widest TP
}[mandate.holdingPeriod];

const tpSpread = baseAnalysis.takeProfitPrice - triggerPrice;
suggestedTpPrice = triggerPrice + tpSpread * tpMultiplier;
```

### Proposal Expiry by Holding Period

| Holding Period | Proposal Expiry |
| -------------- | --------------- |
| SHORT_TERM     | 2 hours         |
| SWING          | 6 hours         |
| MEDIUM_TERM    | 24 hours        |
| LONG_TERM      | 48 hours        |

Configurable via `PROPOSAL_EXPIRY_HOURS_*` environment variables.

---

## Sizing Logic

The Signal Engine determines signal quality. Sizing is calculated mechanically based on available funds:

| Available USDC | Suggested Size                                                                              |
| -------------- | ------------------------------------------------------------------------------------------- |
| >= $400        | 25% of available balance, capped at mandate `maxTradeSize` AND asset `maxSuggestedTradeUsd` |
| $100 - $399    | $100, capped at mandate `maxTradeSize` AND asset `maxSuggestedTradeUsd`                     |
| < $100         | Full available balance                                                                      |

**Available USDC** = wallet USDC balance minus all funds locked in OPEN trigger order vaults.

The `maxSuggestedTradeUsd` from the Asset Registry prevents oversized trades on low-liquidity assets (e.g., Tier 4 assets cap at ~$1K).

Users can adjust the size on Proposal Detail. If the adjusted size exceeds `maxTradeSize`, a warning is shown but execution is not blocked.

---

## Trigger Monitor

Runs every 30 seconds in the ws-server.

### Cycle

1. Query all synthetic Orders with `status = OPEN`
2. Fetch current Pyth price for each ticker
3. Check trigger condition:
   - BUY: current price within the configured trigger band
   - TP: current price >= trigger price
   - SL: current price <= trigger price
4. Emit `trigger:hit` to the user's Socket.IO room. **No DB writes happen here.**
5. The browser performs tap-to-execute: execution claim, Jupiter Ultra `/order`, Privy user signature, Jupiter Ultra `/execute`, then `POST /api/orders/[id]/execute` to settle DB state.

The monitor is intentionally idempotent: it may re-emit the same OPEN Order every poll until the user executes, cancels, or the Order is filled.

---

## TP/SL Arming And OCO Settlement

Handled by `POST /api/orders/[id]/execute` after a Jupiter Ultra swap succeeds.

### Flow

1. BUY fill: update Position with actual entry data and create OPEN synthetic TP + SL Orders.
2. TP/SL fill: mark the filled exit Order, cancel the sibling exit Order, close the Position, and record realized P&L.

### OCO (One-Cancels-Other)

When the browser executes and settles a TP or SL fill:

1. Cancel the sibling OPEN exit Order
2. Calculate `realizedPnl`
3. Update Position: `state = CLOSED`
4. Record Trade (source = `TP_FILL` or `SL_FILL`)

---

## Back-Evaluation

Runs every 5 minutes in the ws-server.

### Scope

Evaluates **every generated proposal regardless of user action** (active, executed, skipped, expired). This measures signal quality independent of whether the user acted on it.

### Cycle

1. Query Proposals where `evaluatedAt IS NULL` and `createdAt + 1 hour < now()`
2. Fetch the price at the 1-hour mark from Pyth Benchmarks
3. Calculate `pctChange` from `priceAtProposal`
4. Classify outcome (v1 default thresholds, configurable via `BACK_EVAL_WIN_THRESHOLD_PCT`):
   - **WIN**: price moved favorably by > 1%
   - **LOSS**: price moved unfavorably by > 1%
   - **NEUTRAL**: within +/-1%
5. Update Proposal with `evaluatedAt`, `priceAfter`, `pctChange`, `outcome`

**Purpose**: Monitor signal quality over time, improve LLM prompts, and provide the data foundation for a future leaderboard.
