# CONTEXT — Hunch It domain language

This file is the canonical glossary for the codebase. Architecture decisions live in `docs/adr/`.

## Architecture freeze

The system is frozen on the **synthetic-trigger** architecture (ADR-0001). Read that first before proposing any change to trade-state handling.

## Domain terms

### Mandate

The four trading constraints captured at setup: `holdingPeriod`, `maxDrawdown`, `maxTradeSize`, `marketFocus`. Stored in the `Mandate` table (one per `User`). The presence of a `Mandate` row is the **only** signal that a user is "set up"; there is no separate onboarding flag.

### SessionGate

The server-side resolver in `apps/web/lib/auth/session.ts`. Single seam that answers "given this request, who is the user, do they have a Mandate, what page do they belong on?". Three stages:

- `SIGNED_OUT` → `nextPath = /login`
- `NEEDS_MANDATE` → `nextPath = /mandate`
- `READY` → `nextPath = /desk`

Two entrypoints: `resolveSession(req)` for API routes (Bearer token), `resolveSessionFromCookies()` for server components (Privy cookie). Exposed to clients via `GET /api/me/state`.

### Proposal

A personalized BUY recommendation produced by the signal pipeline. Snapshotted into a `Proposal` row with suggested size / trigger / TP / SL / expiry / reasoning; expiry follows the mandate-based lifetime and is not shortened by exchange close.

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

A row in the `Order` table that the server tracks and the user executes by tapping. Synthetic Orders never represent an external conditional order; `jupiterOrderId` is a vestigial nullable column and stays `null`. Four kinds:

- `BUY_TRIGGER` — fire when current price is within 0.5 % of `triggerPriceUsd`.
- `TAKE_PROFIT` — fire when current price ≥ `triggerPriceUsd`.
- `STOP_LOSS` — fire when current price ≤ `triggerPriceUsd`.
- `CLOSE_SWAP` — currently unused; reserved for future user-initiated market close.

Three durable statuses: `OPEN | FILLED | CANCELLED`. `PENDING` is a short-lived execution-claim status while the browser is signing/submitting a triggered swap. The other enum values (`PARTIALLY_FILLED`, `EXPIRED`, `FAILED`) are residual in the frozen synthetic path.

### Position

A holding in a single asset. Durable states are `BUY_PENDING → ACTIVE → CLOSED`. `ENTERING` and `CLOSING` are short-lived execution-claim states while the browser is signing/submitting a BUY or TP/SL swap.

### Trade

A historical row recording a fill. Always paired with an `Order` and a `Position`. `source` is one of `BUY_APPROVAL | TP_FILL | SL_FILL | USER_CLOSE`.

### trigger:hit

The Socket.IO event emitted by `apps/ws-server` when a Synthetic Order's price condition matches Pyth and the user needs tap-to-execute fallback. Carries `{ orderId, ticker, mint, kind, triggerPriceUsd, currentPriceUsd, sizeUsd, tokenAmount }`. Notification-only — does **not** mutate DB. Re-fires every poll cycle until the Order is executed or cancelled.

### tap-to-execute

The user-facing interaction model: ws-server detects a trigger, the frontend shows a sticky toast, the user taps **Execute**, the frontend obtains the user's signature for a Jupiter Ultra transaction, submits the signed bytes to Jupiter Ultra `/execute`, then `POST /api/orders/[id]/execute` settles the DB. The system is deliberately **not** autonomous.

### Delegated Execution

The opt-in execution model: after a Synthetic Order trigger hits, Hunch executes the same Jupiter Ultra swap and PositionLifecycle settlement on the user's behalf through delegated wallet access, without a manual Execute tap. Privy delegated wallet status is the source of truth; Hunch does not keep a separate DB toggle. Turning it off revokes the delegated wallet access rather than merely pausing automation. Delegated Execution runs from `apps/ws-server` so it can fill Orders when the user has no browser tab open. If delegated execution is unavailable or fails before broadcast, Hunch falls back to tap-to-execute; after broadcast, Hunch does not offer an immediate retry because a second swap could double-fill.

### Jupiter Ultra

The single broker integration. Used for sponsored, client-authorized swaps (BUY entry, exit on TP/SL fill, manual close). Trigger Order v2 is **not** used (xStocks fail allowlist).

### Sponsored Ultra Execution

The current Jupiter Ultra execution policy. The frontend requests an Ultra `/order`, deserializes the returned transaction, asks Privy to sign only the user's/taker's required signature slot, then submits the signed transaction bytes to Jupiter Ultra `/execute`. Direct Privy `signAndSendTransaction` is **not** the sponsored Ultra path because it bypasses Jupiter `/execute` and can fail sponsored multi-signer transactions before program execution.

### Privy Delegated Ultra Swap Experiment

A `/dev-tools`-only experiment that lets an operator test server-side execution of an owned synthetic Order using Privy delegated wallet access plus Jupiter Ultra `/order` and `/execute`. It requires the user to grant delegated access from the browser and requires the server to hold `PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY`. It does not replace Sponsored Ultra Execution, TriggerExecution, or the production tap-to-execute model.

### JupiterUltraSwap

The frontend Module that owns Sponsored Ultra Execution. Its Interface accepts a swap intent plus wallet signer/connection adapters; its Implementation handles amount preparation, targeted SELL balance capping, Ultra `/order`, transaction decoding, user signature, Ultra `/execute`, and normalized swap diagnostics. SELL balance lookup scans both classic SPL Token (`Tokenkeg...`) and Token-2022 (`TokenzQd...`) accounts because whitelisted crypto wrappers are classic SPL while xStocks are Token-2022.

### TriggerExecution

The frontend Module that owns tap-to-execute execution semantics after a `trigger:hit`. Its Implementation claims the Order, invokes JupiterUltraSwap, settles `/api/orders/[id]/execute`, releases only pre-signature/pre-broadcast failures, and returns typed outcomes for the toast UI to render.

### ClientDiagnosticsLog

The in-browser diagnostic bus used by `/dev-tools`. It stores rich events in session storage and renders full payload/error/debug context for future incident analysis. Terminal mirroring is a separate opt-in adapter; the browser log is the source of truth.

### PositionLifecycle

The single owner of `Position`/`Order`/`Trade` state transitions. Lives in `packages/db/src/lifecycle/position-lifecycle.ts`; API routes and execution adapters call this Module instead of writing lifecycle state directly.

### ProtectionOrders

The pair of OPEN exit Orders attached to an ACTIVE `Position`. Order rows are the canonical TP/SL source of truth; `Position.currentTpPrice/currentSlPrice` remain as denormalized cache fields.

## Architecture vocabulary

The team uses one architectural vocabulary across reviews and ADRs: **Module / Interface / Implementation / Depth / Seam / Adapter / Locality / Leverage**. Definitions in `~/.agents/skills/improve-codebase-architecture/LANGUAGE.md`. Don't drift into "service", "boundary", or "component" when one of those terms applies.
