# CONTEXT — Hunch It domain language

This file is the canonical glossary for the codebase. Architecture decisions live in `docs/adr/`.

## Architecture freeze

The system is frozen on the **synthetic-trigger** architecture (ADR-0001). Read that first before proposing any change to trade-state handling.

## Domain terms

### Mandate

The user's core trading constraints captured at setup: `holdingPeriod`, `maxDrawdown`, `maxTradeSize`, `marketFocus`. Stored in the `Mandate` table (one per `User`). The presence of a `Mandate` row is the **only** signal that a user is "set up"; there is no separate onboarding flag. In the current Grill direction, the user's AI Trading Team may live alongside the Mandate as a preference, but it does not change the Mandate's risk constraints.

### SessionGate

The server-side resolver in `apps/web/lib/auth/session.ts`. Single seam that answers "given this request, who is the user, do they have a Mandate, what page do they belong on?". Three stages:

- `SIGNED_OUT` → `nextPath = /login`
- `NEEDS_MANDATE` → `nextPath = /mandate`
- `READY` → `nextPath = /desk`

Two entrypoints: `resolveSession(req)` for API routes (Bearer token), `resolveSessionFromCookies()` for server components (Privy cookie). Exposed to clients via `GET /api/me/state`.

### Proposal

A personalized BUY recommendation produced by the signal pipeline. Snapshotted into a `Proposal` row with suggested size / trigger / TP / SL / expiry / reasoning; expiry follows the mandate-based lifetime and is not shortened by exchange close.

### AI Analyst

A user-selectable investment viewpoint with its own technique, data lens, and trading style. AI Analysts do not place Orders or act autonomously; they help turn a market setup or user-supplied trade idea into Analyst Opinions that can support, challenge, or reject the idea.

### AI Analyst Catalog

The set of AI Analysts Hunch exposes for the user to add to their AI Trading Team. The catalog may draw from existing research agents when their technique can be made to work on Hunch Tradable Assets and Hunch data sources; research agents that cannot produce reliable Analyst Opinions in the Hunch product context should stay out of the catalog until adapted.

### AI Trading Team

The user's chosen set of up to six AI Analysts. The AI Trading Team can contain multiple AI Analysts at once, so a trade idea or market setup can be evaluated from several viewpoints before the user decides whether to create one Proposal. In the current product direction, Team is a primary signed-in surface alongside Home, Grill, and Portfolio rather than a required onboarding step.

### Grill

The signed-in surface where a user brings an outside trade idea from a friend, creator, social feed, or market move and asks their AI Trading Team to challenge it. Grill shows each selected AI Analyst's Opinion without collapsing the debate into a final verdict; the user decides whether to turn the idea into one Proposal.

### Grill Idea

The user-supplied trade idea entered in Grill. When the user creates a Proposal from Grill, the Proposal should retain that original Grill Idea as its context, while the transient Analyst Opinions do not need to be preserved.

### Analyst Opinion

One AI Analyst's visible read on a trade idea or market setup during Grill. Analyst Opinions may disagree with each other, and that disagreement is part of the user's decision-making moment; they are not separate Proposals and do not need to be preserved after the user leaves the Grill result.

### Signal

A legacy v1.2 user-facing product object that Hunch is removing during current development. Signals are not reviewable, executable, persisted, or emitted as a browser event; users review Proposals instead. Keep "Signal" terminology only for internal market-data language such as Signal Engine and Signal Data Freshness.

### Tradable Asset

The canonical asset a user can trade through Hunch, identified by an asset id such as `AAPLx`, `NVDAx`, `wBTC`, `ETH`, `BNB`, `wXRP`, `TRX`, or `HYPE`; equity names without the `x` suffix are not valid Hunch asset identifiers.

### Asset Universe

The declarative whitelist in `packages/shared/src/assets.ts`. It answers product questions about Tradable Assets: which assets are signalable, which mandate verticals contain an asset, and which mint / Pyth latest feed / Pyth bars symbol belongs to that asset. It does not perform runtime provider verification.

### xStock

The tokenized equity asset Hunch users trade on Solana, identified by the xStock symbol such as `AAPLx` or `NVDAx`; avoid presenting these as direct trades in native US-listed shares.

### xStock Signal

A Proposal for an xStock based on fresh tokenized-asset price data for that xStock; this replaces the older idea of an underlying US equity signal.

### xStock Market Data

Price and bar data keyed by xStock symbols such as `AAPLx`; one xStock-native source must provide both latest price and historical bars, and Hunch does not fall back to underlying equity feeds or mixed equity charts for xStock Proposals.

### Pyth Benchmark Bars

Historical OHLC bars for Hunch Tradable Assets from Pyth Benchmarks. Callers request bars by canonical `AssetId` and time window through the shared Pyth Benchmark Bars Module; provider symbol lookup, TradingView-shaped URL construction, response parsing, retry/backoff, throttling, and short-lived stale-cache fallback stay inside that Module. Signal Engine, Grill, charts, and dev-tools must not reimplement Pyth Benchmarks parsing.

### Signal Data Freshness

The asset-specific condition that the price data used to create a Proposal is current enough for that tradable asset, using the existing publish-time staleness check; for xStocks, there is no market-hours logic or equity-feed fallback.

### Base Market Analysis

The standalone Signal Engine output for one asset before personalization. It contains the asset id, current price, indicators, confidence, and technical rationale. It does not know about users, mandates, order creation, or PositionLifecycle.

### Base Analysis Refresh Policy

The rule for when price movement or candle progression is meaningful enough to request a new Base Market Analysis for an asset instead of reusing the previous interpretation.

### ProposalCreation

The `packages/db/src/lifecycle/proposal-creation.ts` Module that turns Base Market Analysis plus a Mandate and position-impact context into a persisted BUY Proposal. It owns sizing defaults, trigger / TP / SL derivation, expiry, reasoning, thesis tags, and Proposal row creation. Live signal generation and `/dev-tools` are adapters into this Module.

### Crypto

The supported crypto Proposal universe, selected by the `crypto` market focus: `wBTC`, `ETH`, `BNB`, `wXRP`, `TRX`, and `HYPE`. `SOL` is excluded because Hunch treats it as wallet fee balance, not a recommended Position.

Approved crypto mints:

- `wBTC` — `3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh`
- `ETH` — `7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs`
- `BNB` — `9gP2kCy3wA1ctvYWQk75guqXuHfrEomqydHLtcTCqiLa`
- `wXRP` — `6UpQcMAb5xMzxc7ZfPaVMgx3KqsvKZdT5U718BzD5We2`
- `TRX` — `GbbesPbaYh5uiAZSYNXTc7w9jty1rpg3P9L4JeN4LkKc`
- `HYPE` — `98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g`

### Synthetic Order

A row in the `Order` table that the server tracks and later fills through delegated execution or tap-to-execute fallback. Synthetic Orders never represent an external conditional order; `jupiterOrderId` is a vestigial nullable column and stays `null`. Four kinds:

- `BUY_TRIGGER` — wake when Pyth is at or below `triggerPriceUsd * 1.005`, then fire only when the fresh Ultra BUY executable price is at or below `triggerPriceUsd`.
- `TAKE_PROFIT` — wake when Pyth is at or above `triggerPriceUsd * 0.995`, then fire only when the fresh Ultra SELL executable price is at or above `triggerPriceUsd`.
- `STOP_LOSS` — wake when Pyth is at or below `triggerPriceUsd * 1.005`, then fire only when the fresh Ultra SELL executable price is at or below `triggerPriceUsd`.
- `CLOSE_SWAP` — currently unused; reserved for future user-initiated market close.

Three durable statuses: `OPEN | FILLED | CANCELLED`. `PENDING` is a short-lived execution-claim status while the execution adapter is signing/submitting a triggered swap. The other enum values (`PARTIALLY_FILLED`, `EXPIRED`, `FAILED`) are residual in the frozen synthetic path.

### Position

A holding in a single asset. Durable states are `BUY_PENDING → ACTIVE → CLOSED`. `ENTERING` and `CLOSING` are short-lived execution-claim states while an execution adapter is signing/submitting a BUY or TP/SL swap.

### Portfolio Summary

The user-visible valuation snapshot shared by Desk and Portfolio. It combines wallet USDC (`cashUsd`) plus open holding mark value into Total Value, reports realized and unrealized P&L separately, and exposes the derived holdings / closable positions that portfolio surfaces need. `apps/web/lib/portfolio/summary.ts` is the Module that owns this calculation; pages should not recompute Total Value locally.

### Trade

A historical row recording a fill. Always paired with an `Order` and a `Position`. `source` is one of `BUY_APPROVAL | TP_FILL | SL_FILL | USER_CLOSE`.

### Notification Center

The durable in-app inbox for a User's production Hunch events, shown from every signed-in surface; it stores read/unread state but does not imply remote push delivery.

### Executable Trigger

The trigger policy for Synthetic Orders. Pyth is only a cheap wake-up band; it does not make an Order actionable by itself. When Pyth wakes an Order, Hunch fetches a fresh Jupiter Ultra `/order` quote and uses the quote-derived executable price as the final source of truth for triggerability. Manual tap-to-execute and Delegated Execution both use this semantics. If Ultra does not satisfy the Order's actual price condition, the Order stays open and no actionable Execute toast is shown.

### trigger:hit

The Socket.IO event emitted by `apps/ws-server` when a Synthetic Order has passed the Executable Trigger policy and the user needs tap-to-execute fallback. Carries `{ orderId, ticker, mint, kind, triggerPriceUsd, currentPriceUsd, executablePriceUsd, sizeUsd, tokenAmount }` plus optional executable quote details. Notification-only — does **not** mutate DB. Re-fires every poll cycle until the Order is executed or cancelled.

### tap-to-execute

The fallback user-facing interaction model: ws-server detects a trigger, the frontend shows a sticky toast, the user taps **Execute**, the frontend obtains the user's signature for a Jupiter Ultra transaction, submits the signed bytes to Jupiter Ultra `/execute`, then `POST /api/orders/[id]/execute` settles the DB. This remains the default path when the wallet is not delegated, when delegated execution is unavailable, and for manual flows such as Close Position.

### Delegated Execution

The opt-in execution model: after a Synthetic Order trigger hits, Hunch executes the same Jupiter Ultra swap and PositionLifecycle settlement on the user's behalf through Privy wallet v2 signer access, without a manual Execute tap. The UI label is **Auto-execute triggers**, with copy that enabling it delegates execution ability, remains non-custodial, and can be revoked anytime. It applies only to triggered Synthetic Orders (`BUY_TRIGGER`, `TAKE_PROFIT`, `STOP_LOSS`); manual close and SELL proposal confirmation stay user-signed. Privy wallet v2 delegated signer status is the source of truth; Hunch does not keep a separate DB toggle or support legacy Privy wallet delegation in the current dev phase. Turning it off revokes the delegated signer access rather than merely pausing automation. Delegated Execution runs from `apps/ws-server` so it can fill Orders when the user has no browser tab open. If delegated execution is unavailable or fails before `/execute` is attempted, Hunch falls back to tap-to-execute; persistent readiness blockers fall back without retrying delegated execution, while transient Privy/Jupiter runtime errors may use a light cooldown. Once `/execute` is attempted, Hunch keeps the Order claim locked for reconciliation if no signature is returned, because a second swap could double-fill. Successful delegated execution emits `trade:filled` as a status event, not `trigger:hit` as an action prompt. `packages/shared/src/delegated-execution-readiness.ts` owns readiness blocker derivation so Settings, `/dev-tools`, and execution adapters use the same readiness vocabulary.

### Delegated Execution Runtime

The `@hunch-it/execution` package. It owns the production Delegated Execution Module and concrete adapters for Privy wallet v2 signing, Jupiter Ultra `/order` + `/execute`, Solana token balance reads, and PositionLifecycle settlement. `apps/ws-server` calls it from the trigger dispatch path; `/dev-tools` wraps the same Module with diagnostic adapters instead of reimplementing execution order.

### Jupiter Ultra

The single broker integration. Used for sponsored, client-authorized swaps (BUY entry, exit on TP/SL fill, manual close). Trigger Order v2 is **not** used (xStocks fail allowlist).

### Sponsored Ultra Execution

The current Jupiter Ultra execution policy. The frontend requests an Ultra `/order`, deserializes the returned transaction, asks Privy to sign only the user's/taker's required signature slot, then submits the signed transaction bytes to Jupiter Ultra `/execute`. Direct Privy `signAndSendTransaction` is **not** the sponsored Ultra path because it bypasses Jupiter `/execute` and can fail sponsored multi-signer transactions before program execution.

### Privy Delegated Ultra Swap Experiment

The server-side Ultra execution adapter proven first in `/dev-tools` and now used by Delegated Execution. It requires the user to attach Privy wallet v2 signer access from the browser and requires the server to hold `PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY`. `/dev-tools` remains the diagnostic harness for owned dev Orders; production trigger fills and the diagnostic harness both call the shared Delegated Execution Runtime.

### JupiterUltraSwap

The frontend Module that owns Sponsored Ultra Execution. Its Interface accepts a swap intent plus wallet signer/connection adapters; its Implementation handles amount preparation, targeted SELL balance capping, Ultra `/order`, transaction decoding, user signature, Ultra `/execute`, and normalized swap diagnostics. SELL balance lookup scans both classic SPL Token (`Tokenkeg...`) and Token-2022 (`TokenzQd...`) accounts because whitelisted crypto wrappers are classic SPL while xStocks are Token-2022.

### TriggerExecution

The frontend Module that owns tap-to-execute fallback semantics after a `trigger:hit`. Its Implementation claims the Order, invokes JupiterUltraSwap, settles `/api/orders/[id]/execute`, releases only pre-signature/pre-broadcast failures, and returns typed outcomes for the toast UI to render.

### TriggerExecutionDispatch

The ws-server Module in `apps/ws-server/src/orders/trigger-execution-dispatch.ts` that owns what happens after an Executable Trigger is detected: try Delegated Execution, emit `trade:filled`, emit fallback `trigger:hit`, suppress already-owned work, or retain the claim for reconciliation. `trigger-monitor.ts` owns Pyth wake-up polling plus executable quote gating; dispatch owns execution outcome policy.

### ClientDiagnosticsLog

The in-browser diagnostic bus used by `/dev-tools`. It stores rich events in session storage and renders full payload/error/debug context for future incident analysis. Terminal mirroring is a separate opt-in adapter; the browser log is the source of truth.

### PositionLifecycle

The single owner of `Position`/`Order`/`Trade` state transitions. Lives in `packages/db/src/lifecycle/position-lifecycle.ts`; API routes and execution adapters call this Module instead of writing lifecycle state directly.

### ProtectionOrders

The pair of OPEN exit Orders attached to an ACTIVE `Position`. Order rows are the canonical TP/SL source of truth; `Position.currentTpPrice/currentSlPrice` remain as denormalized cache fields.

## Architecture vocabulary

The team uses one architectural vocabulary across reviews and ADRs: **Module / Interface / Implementation / Depth / Seam / Adapter / Locality / Leverage**. Definitions in `~/.agents/skills/improve-codebase-architecture/LANGUAGE.md`. Don't drift into "service", "boundary", or "component" when one of those terms applies.
