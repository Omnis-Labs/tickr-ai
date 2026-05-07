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
A personalized BUY recommendation produced by the signal pipeline. Snapshotted into a `Proposal` row with suggested size / trigger / TP / SL / expiry / reasoning. Lifecycle: `ACTIVE → EXECUTED | SKIPPED | EXPIRED`.

### Synthetic Order
A row in the `Order` table that the server tracks and the user executes by tapping. **Not** a Jupiter trigger order. `jupiterOrderId` is always `null`. Four kinds:

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
The Socket.IO event emitted by `apps/ws-server` when a synthetic Order's price condition matches Pyth. Carries `{ orderId, ticker, mint, kind, triggerPriceUsd, currentPriceUsd, sizeUsd, tokenAmount }`. Notification-only — does **not** mutate DB. Re-fires every poll cycle until the user executes or the Order is cancelled.

### tap-to-execute
The user-facing interaction model: ws-server detects a trigger, the frontend shows a sticky toast, the user taps **Execute**, the frontend obtains the user's signature for a Jupiter Ultra transaction, submits the signed bytes to Jupiter Ultra `/execute`, then `POST /api/orders/[id]/execute` settles the DB. The system is deliberately **not** autonomous.

### Jupiter Ultra
The single broker integration. Used for sponsored, client-authorized swaps (BUY entry, exit on TP/SL fill, manual close). Trigger Order v2 is **not** used (xStocks fail allowlist).

### Sponsored Ultra Execution
The current Jupiter Ultra execution policy. The frontend requests an Ultra `/order`, deserializes the returned transaction, asks Privy to sign only the user's/taker's required signature slot, then submits the signed transaction bytes to Jupiter Ultra `/execute`. Direct Privy `signAndSendTransaction` is **not** the sponsored Ultra path because it bypasses Jupiter `/execute` and can fail sponsored multi-signer transactions before program execution.

### ClientDiagnosticsLog
The in-browser diagnostic bus used by `/dev-tools`. It stores rich events in session storage and renders full payload/error/debug context for future incident analysis. Terminal mirroring is a separate opt-in adapter; the browser log is the source of truth.

### PositionLifecycle (forthcoming)
The single owner of `Position`/`Order`/`Trade` state transitions. Lives in `packages/db/src/lifecycle/`. Scheduled to land in commits 14-20 of `refactor/minimal-cohesive-core`. Until then, transitions are scattered across `/api/orders/[id]/execute`, `/api/positions/[id]/close`, and `apps/ws-server` tasks.

### ProtectionOrders (forthcoming)
The pair of OPEN exit Orders attached to an ACTIVE `Position`. After C5 lands, the Order rows become the canonical TP/SL source of truth and `Position.currentTpPrice/currentSlPrice` will be deleted or downgraded to a denormalized cache.

## Architecture vocabulary

The team uses one architectural vocabulary across reviews and ADRs: **Module / Interface / Implementation / Depth / Seam / Adapter / Locality / Leverage**. Definitions in `~/.agents/skills/improve-codebase-architecture/LANGUAGE.md`. Don't drift into "service", "boundary", or "component" when one of those terms applies.
