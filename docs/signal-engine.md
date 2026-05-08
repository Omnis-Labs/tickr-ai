# Hunch — Signal Engine

> Base market analysis, proposal fan-out, sizing logic, LLM cost control, synthetic trigger monitoring, and back-evaluation.
>
> **Read with**: data-model.md (schema + JSON interfaces), api-contract.md (WebSocket events + order state transitions)

---

## Overview

The Signal Engine runs in `apps/ws-server` as a standalone Node.js process. In the frozen synthetic-trigger architecture, trigger monitoring is always on; live signal generation, back-evaluation, and thesis monitoring are env-gated.

1. **Market Scanner** — monitor all supported assets for trading opportunities
2. **Proposal Generator** — convert Base Market Analysis into personalized BUY proposals per user
3. **Trigger Monitor** — poll Pyth for OPEN synthetic Orders and emit `trigger:hit`
4. **Back-Evaluator** — score proposal quality after the fact (env-gated)

The pipeline is asset-native. Every signalable item is a canonical `AssetId` from the Asset Universe in `packages/shared/src/assets.ts` such as `AAPLx`, `NVDAx`, `wBTC`, `ETH`, `BNB`, `wXRP`, `TRX`, or `HYPE`. Equity-like signals use xStock-native Pyth feeds such as `Crypto.AAPLX/USD`; Hunch does not recognize bare US equity symbols and does not fall back to underlying equity feeds.

The canonical proposal rule is: **Hunch may generate a proposal only when the asset's signal data is fresh for that asset class.** Freshness is data-driven using Pyth publish time through `evaluateSignalDataFreshness`; there is no US market-hours gate.

The Signal Engine seam is intentionally narrow: `AssetId + Signal Data -> Base Market Analysis`. It owns Pyth/Gemini/indicator work in `apps/ws-server/src/signals/base-analysis.ts`, but it does not own mandate personalization, `/dev-tools`, order acceptance, or PositionLifecycle.

---

## Stage 1: Market Scanner (Per Asset)

The ws-server scans `getSignalAssets()` on a default 60-second interval. That list is the asset registry filtered to assets with a configured Pyth feed id. As of this branch it contains 13 assets: `AAPLx`, `NVDAx`, `TSLAx`, `SPYx`, `QQQx`, `GOOGLx`, `METAx`, `wBTC`, `ETH`, `BNB`, `wXRP`, `TRX`, and `HYPE`.

### Scan Cycle

1. Fetch live price from Pyth Hermes using the asset's configured feed id.
2. Evaluate freshness. The current rule accepts snapshots whose publish time is no more than 15 minutes old.
3. Fetch historical candles from Pyth Benchmarks using the asset's configured `pythSymbol` (5-minute bars, last 24 hours).
4. Calculate technical indicators: RSI-14, MACD (12,26,9), MA20, MA50.
5. Send the asset id, latest price, bars, and indicators to Gemini via `@google/genai`.
6. Gemini returns a base signal:
   - `action`: BUY, SELL, or HOLD
   - `confidence`: 0.00-1.00
   - `rationale`: one-sentence technical summary
   - `ttl_seconds`: 30-120 seconds

Only BUY signals with confidence >= `MIN_ACTIONABLE_CONFIDENCE` fan out into personalized proposals. SELL signals are used by the legacy signal path; thesis-based SELL proposals are handled separately by the env-gated thesis monitor.

Assets are staggered by `TICKER_STAGGER_SECONDS` (default: 2 seconds) to avoid API burst. The env var name is legacy; the values are asset ids, not bare tickers.

### LLM Cost Control

A daily USD cap (`LLM_DAILY_USD_CAP`, default: $10) limits LLM spend inside each running ws-server process. When the cap is reached, the scanner falls back to rule-based analysis using technical indicators only (no LLM calls). The counter resets on the UTC day boundary or process restart.

---

## Stage 2: Proposal Generator (Per User)

When a Market Scanner cycle produces a viable Base Market Analysis (confidence >= `MIN_ACTIONABLE_CONFIDENCE` and action = BUY), the Proposal Generator personalizes it for each relevant user. **This stage makes zero LLM calls.**

### User Matching

Query users whose `mandate.marketFocus` overlaps any market-focus vertical that contains the asset id. Asset-to-vertical membership is derived by the Asset Universe, not rebuilt in the signal engine:

```sql
-- Pseudocode
SELECT users WHERE
  mandate.marketFocus contains ANY OF getMarketFocusVerticalsForAsset(assetId)
  OR mandate.marketFocus contains "no_preference"
```

Skip users who already have an open position in the same asset. The order-acceptance UI is still responsible for checking that the user has enough USDC at decision time.

### Generation Steps

For each matching user:

1. Read mandate: `holdingPeriod`, `maxDrawdown`, `maxTradeSize`, `marketFocus`
2. Read portfolio: current positions, available USDC
3. Pass Base Market Analysis, Mandate, and position-impact context to `ProposalCreation`.
4. **Calculate `suggestedSizeUsd`** from available USDC and the mandate max trade size (current default: 20% of wallet USDC, rounded up to the next $5 increment, with a small-balance floor and caps at wallet USDC and max trade size).
5. **Derive TP/SL and expiry** from the base defaults plus the user's mandate.
6. **Derive `suggestedTriggerPrice`** from current analysis price (current default: 0.3% below the analysis price).
7. **Assemble `reasoning`** (rule-based):
   - `what_changed`: carried from base analysis
   - `why_this_trade`: carried from base analysis
   - `why_fits_mandate`: template-generated sentences mapping mandate parameters, e.g.:
     - "Fits your 1-2 week holding period"
     - "Position size $400 is within your $500 max trade size"
     - "Adds semiconductor exposure, which your mandate targets"
8. **Calculate `positionImpact`**: before/after comparison of asset weight, cash, and vertical exposure.
9. **Save** the Proposal to PostgreSQL
10. **Push** to the user's Socket.IO room via `proposal:new`

---

## Mandate Personalization (TP/SL/Expiry Adjustment)

Stage 1 currently returns a Base Market Analysis with simple base defaults (`suggestedTpPct = 4%`, `suggestedSlPct = 2.5%`) before Stage 2 personalizes them.

### TP/SL Adjustment

```typescript
const triggerPrice = priceAtAnalysis * 0.997;
const suggestedTakeProfitPrice = max(baseTpPrice, triggerPrice * 1.01);
const uncappedStop = min(baseSlPrice, triggerPrice * 0.995);
const suggestedStopLossPrice =
  mandate.maxDrawdown == null
    ? uncappedStop
    : max(uncappedStop, triggerPrice * (1 - mandate.maxDrawdown));
```

### Proposal Expiry by Holding Period

| Holding Period | Proposal Expiry |
| -------------- | --------------- |
| 1-3 days       | 30 minutes      |
| 1-2 weeks      | 90 minutes      |
| 1-3 months     | 180 minutes     |
| 6+ months      | 240 minutes     |

---

## Sizing Logic

The Signal Engine determines signal quality. `ProposalCreation` determines proposal sizing. Current production sizing is wallet-aware: default proposal size is 20% of the user's available USDC, rounded up to the next $5 increment; if that target is below $5, Hunch uses up to $5; the result is capped by both wallet USDC and the user's `maxTradeSize`. If wallet USDC or max trade size is zero, no BUY proposal is created.

Users can adjust the size on Proposal Detail. If the adjusted size exceeds `maxTradeSize`, a warning is shown but execution is not blocked.

---

## Trigger Monitor

Runs every 30 seconds in the ws-server.

### Cycle

1. Query all synthetic Orders with `status = OPEN`
2. Fetch current Pyth price for each asset id
3. Check trigger condition:
   - BUY: current price within 0.5% of trigger
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
   - **WIN**: price moved favorably by > 0.5%
   - **LOSS**: price moved unfavorably by > 0.5%
   - **NEUTRAL**: within +/-0.5%
5. Update Proposal with `evaluatedAt`, `priceAfter`, `pctChange`, `outcome`

**Purpose**: Monitor signal quality over time, improve LLM prompts, and provide the data foundation for a future leaderboard.
