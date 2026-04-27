# Hunch — Signal Engine

> Two-stage signal pipeline, market scanning, proposal generation, sizing logic, LLM cost control, order tracking, and back-evaluation.
>
> **Read with**: data-model.md (schema + JSON interfaces), api-contract.md (WebSocket events + order state transitions)

---

## Overview

The Signal Engine runs in `apps/ws-server` as a standalone Node.js process. It has five responsibilities:

1. **Market Scanner** — monitor all supported assets for trading opportunities
2. **Proposal Generator** — convert opportunities into personalized BUY proposals per user
3. **Order Tracker** — poll Jupiter for order status changes (fills, expirations, cancellations)
4. **Auto TP/SL Placer** — place exit orders after BUY fills
5. **Back-Evaluator** — score proposal quality after the fact

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

A daily USD cap (`LLM_DAILY_USD_CAP`, default: $10) limits total LLM spend. When the cap is reached, the scanner falls back to rule-based analysis using technical indicators only (no LLM calls). The spend counter is tracked in the `LlmUsageDaily` PostgreSQL table with an atomic upsert (see data-model.md).

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

## Order Tracker

Runs every 30 seconds in the ws-server.

### Cycle

1. Query all Orders with `status = OPEN`
2. Batch call Jupiter Trigger Order History API to get latest statuses
3. **Filled** → update Order + Position + Trade, trigger downstream actions:
   - BUY fill → invoke Auto TP/SL Placer
   - TP or SL fill → invoke OCO cancel logic
4. **Expired** → update Order status, notify user to reclaim vault funds
5. **Cancelled** → update Order status

The tracker is idempotent: it selects only OPEN orders and updates them atomically. Jupiter API 5xx errors do not mark orders as FAILED; the tracker retries on the next cycle.

---

## Auto TP/SL Placer

Triggered by the Order Tracker when a BUY order fills.

### Flow

1. Update Position: set `entryPrice`, `tokenAmount`, `state = ENTERING`
2. Place TP trigger order using the user's confirmed TP price
3. Place SL trigger order using the user's confirmed SL price
4. Both succeed → Position `state = ACTIVE`
5. Either fails → retry; Position remains `ENTERING` until both are placed

### OCO (One-Cancels-Other)

When the Order Tracker detects a TP or SL fill:

1. Cancel the other unfilled exit order
2. Calculate `realizedPnl`
3. Update Position: `state = CLOSED`
4. Record Trade (source = `TP_FILL` or `SL_FILL`)
5. Push notification to user

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
