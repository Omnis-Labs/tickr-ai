# Hunch It — Data Model

> Prisma schema, canonical asset ids, JSON field shapes, and data synchronization notes.
>
> Source of truth: `packages/db/prisma/schema.prisma`, `packages/shared/src/types.ts`,
> `packages/shared/src/constants.ts`, and `packages/shared/src/assets.ts`.

---

## Current Model Summary

The database keeps the older column name `ticker` for migration safety, but the value space is now canonical `AssetId`. Treat every `Proposal.ticker`, `Position.ticker`, `Order.position.ticker`, and `Trade.ticker` as an asset id such as `AAPLx`, `NVDAx`, `wBTC`, `ETH`, `BNB`, `wXRP`, `TRX`, or `HYPE`.

Do not store or pass bare US equity symbols.

### User

`User` is keyed by Privy identity and wallet address. It owns one optional `Mandate`, plus `Proposal`, `Position`, `Order`, `Trade`, and `Skip` rows.

### Mandate

`Mandate` stores the four setup constraints:

| Field           | Current value shape                                           |
| --------------- | ------------------------------------------------------------- |
| `holdingPeriod` | `"1-3 days"`, `"1-2 weeks"`, `"1-3 months"`, or `"6+ months"` |
| `maxDrawdown`   | `0.0300`, `0.0500`, `0.0800`, or `null`                       |
| `maxTradeSize`  | USD decimal                                                   |
| `marketFocus`   | JSON array of lowercase ids from `MarketFocusVerticalSchema`  |

Market focus ids include:

```typescript
type MarketFocusVertical =
  | 'no_preference'
  | 'technology_software'
  | 'semiconductors'
  | 'ev_clean_energy'
  | 'financials_fintech'
  | 'healthcare_pharma'
  | 'consumer_retail'
  | 'energy_utilities'
  | 'crypto_mining'
  | 'industrials'
  | 'tokenized_etfs'
  | 'crypto';
```

### Proposal

`Proposal` is the personalized recommendation row.

Important fields:

| Field                                                 | Notes                                                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ticker`                                              | Canonical `AssetId`; column name is legacy.                                                           |
| `action`                                              | `BUY` for entry proposals; `SELL` for thesis-invalidation exit proposals.                             |
| `suggestedSizeUsd`                                    | Suggested USDC notional.                                                                              |
| `suggestedTriggerPrice`                               | Synthetic trigger price watched by ws-server.                                                         |
| `suggestedTakeProfitPrice` / `suggestedStopLossPrice` | Initial exit protection prices.                                                                       |
| `reasoning`                                           | `{ what_changed, why_this_trade, why_fits_mandate }`.                                                 |
| `positionImpact`                                      | `{ weight_before, weight_after, cash_after, sector_before, sector_after }`.                           |
| `thesisTags`                                          | BUY-time structured thesis tags used by the env-gated thesis monitor.                                 |
| `origin`                                              | `SIGNAL_ENGINE`, `DEV_TOOLS`, or `GRILL`.                                                             |
| `originContext`                                       | Optional source context. Grill proposals store the original Grill Idea and selected analyst ids here. |

Lifecycle:

| From     | Trigger                                   | To         |
| -------- | ----------------------------------------- | ---------- |
| `ACTIVE` | BUY acceptance through `POST /api/orders` | `EXECUTED` |
| `ACTIVE` | `POST /api/skips`                         | `SKIPPED`  |
| `ACTIVE` | `expiresAt` passes or mandate changes     | `EXPIRED`  |

### Position

`Position` is one independent holding in one asset. The same user can have multiple independent positions in the same asset.

Durable states:

```text
BUY_PENDING -> ACTIVE -> CLOSED
```

`ENTERING` and `CLOSING` are short-lived execution-claim states while the active execution path is signing/submitting a Jupiter Ultra swap.

### Order

`Order` is a synthetic trigger or close intent. Synthetic orders have `jupiterOrderId = null`; ws-server watches Pyth as a wake-up band, confirms triggerability with a fresh Jupiter Ultra executable price, and only then auto-executes through Privy signer access or emits `trigger:hit` fallback.

Kinds:

| Kind          | Meaning                                                      |
| ------------- | ------------------------------------------------------------ |
| `BUY_TRIGGER` | Fire when current price is within 0.5% of `triggerPriceUsd`. |
| `TAKE_PROFIT` | Fire when current price is at or above `triggerPriceUsd`.    |
| `STOP_LOSS`   | Fire when current price is at or below `triggerPriceUsd`.    |
| `CLOSE_SWAP`  | Reserved for explicit close flows.                           |

Statuses used in the frozen synthetic path:

| Status      | Meaning                                                        |
| ----------- | -------------------------------------------------------------- |
| `OPEN`      | Waiting for ws-server trigger monitor.                         |
| `PENDING`   | An execution path claimed the order and is signing/submitting. |
| `FILLED`    | On-chain swap settled and DB lifecycle wrote the fill.         |
| `CANCELLED` | User/lifecycle cancelled the synthetic order.                  |

`PARTIALLY_FILLED`, `EXPIRED`, and `FAILED` remain enum values but are residual in the frozen synthetic-trigger path.

### Trade

`Trade` records a fill after a Jupiter Ultra execution has returned a signature and `/api/orders/[id]/execute` has settled it.

Sources:

| Source         | Meaning                                    |
| -------------- | ------------------------------------------ |
| `BUY_APPROVAL` | BUY trigger fill activated the Position.   |
| `TP_FILL`      | Take-profit exit fill closed the Position. |
| `SL_FILL`      | Stop-loss exit fill closed the Position.   |
| `USER_CLOSE`   | User manually closed the Position.         |

---

## Asset Registry

Canonical asset metadata lives in the Asset Universe at `packages/shared/src/assets.ts`, backed by xStock constants in `packages/shared/src/constants.ts`. It is a static whitelist, not a runtime provider-verification loop.

```typescript
interface Asset {
  assetId: string;
  displaySymbol: string;
  name: string;
  kind: 'XSTOCK' | 'CRYPTO';
  mint: string;
  decimals: number;
  pythFeedId: string;
  pythSymbol: string;
}
```

Supported signal assets:

| Kind                | Assets                                                       |
| ------------------- | ------------------------------------------------------------ |
| xStock / ETF xStock | `AAPLx`, `NVDAx`, `TSLAx`, `SPYx`, `QQQx`, `GOOGLx`, `METAx` |
| Crypto              | `wBTC`, `ETH`, `BNB`, `wXRP`, `TRX`, `HYPE`                  |

`SOL` is wallet fee balance only. It is not a Position recommendation asset. `MSFTx` is not in the supported universe until xStock-native Pyth signal data exists.

Market-focus verticals live in `MARKET_FOCUS_VERTICALS`. The `crypto` vertical maps to `wBTC`, `ETH`, `BNB`, `wXRP`, `TRX`, and `HYPE`.

Asset Universe helpers derive signal eligibility and mandate matching from this whitelist:

```typescript
getSignalAssets();
getMarketFocusVerticalsForAsset(assetId);
getSignalAssetIdsForVerticals(verticalIds);
```

---

## Signal Data

Hunch It may generate a proposal only when the asset's signal data is fresh for that asset class.

- Latest prices come from Pyth Hermes using `Asset.pythFeedId`.
- Historical bars come from Pyth Benchmarks using `Asset.pythSymbol`.
- xStock feeds use `Crypto.<XSTOCK>/USD` symbols such as `Crypto.AAPLX/USD`.
- Freshness is the shared `evaluateSignalDataFreshness` publish-time rule, currently max 15 minutes old.
- There is no underlying-equity fallback and no US market-hours guardrail.

---

## Proposal Creation

`packages/db/src/lifecycle/proposal-creation.ts` owns BUY Proposal row construction for live signal generation, Grill proposal creation, and `/dev-tools`.

Inputs:

- Base Market Analysis: asset id, price at analysis, confidence, rationale, optional target prices, and indicators.
- Mandate numbers: holding period, max trade size, and max drawdown.
- Position-impact context: total USD, cash USD, same-asset exposure, and same-vertical exposure.

Owned outputs:

- `suggestedSizeUsd`
- `suggestedTriggerPrice`
- `suggestedTakeProfitPrice`
- `suggestedStopLossPrice`
- `reasoning`
- `positionImpact`
- `thesisTags`
- `expiresAt`

Grill and `/dev-tools` use the same wallet-aware sizing Module as live signal generation so user-supplied and local test proposals stay close to real execution. Proposal Lab may display the computed size in its LLM prompt, but `ProposalCreation` remains the owner of `suggestedSizeUsd`.

---

## Data Sync

The Proposal Generator reads wallet balances on-chain to calculate portfolio context. The synthetic trigger monitor reads Pyth every poll cycle for open synthetic Orders, then asks Jupiter Ultra for an executable quote when Pyth enters the wake-up band. If the executable price satisfies the Order condition and Auto-execute triggers is live, ws-server executes the Jupiter Ultra swap through Privy signer access and settles with PositionLifecycle. Otherwise it emits `trigger:hit`; the browser executes the Jupiter Ultra swap and then settles DB state through `/api/orders/[id]/execute`.

Back-evaluation is env-gated and writes `evaluatedAt`, `priceAfter`, `pctChange`, and `outcome` after the 1-hour mark when benchmark data is available.
