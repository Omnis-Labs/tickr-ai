# Manual click-through — minimal cohesive core

This is the executable contract for "the system works" under the synthetic-trigger freeze (ADR-0001). Run it whenever you need a confidence check that nothing in the core trade lifecycle has regressed.

## Setup

```bash
pnpm install
cp .env.example .env
# For local deterministic proposal/trigger testing:
#   ENABLE_DEV_TOOLS=true
#   DEV_TOOLS_PASSWORD=Omnis-2026
# For background proposals:
#   ENABLE_SIGNAL_LOOP=true      (live Pyth + Gemini proposals; needs GEMINI_API_KEY)
pnpm db:up && pnpm db:push
pnpm dev                          # syncs .env into both app env files before booting
```

Open `http://localhost:3000` and `http://localhost:4000/healthz`. The `ws-server` health endpoint should return `{"ok":true}`. The web app on `:3000` is what you click through below.

## The ten steps

### 1. Public landing renders for signed-out visitors
Open `/` in a fresh incognito tab. The marketing landing should appear immediately with no flash of any other page. The Login button is visible top-right.

**What's being verified**: server-side `SessionGate.resolveSessionFromCookies()` returns `SIGNED_OUT` for a tab without a `privy-token` cookie, so `app/page.tsx` renders `<LandingMarketing/>` instead of redirecting. The cookie-less-but-Privy-authed client fallback inside marketing calls `/api/me/state` (which never 401s) — never `/api/mandates` (which would trip the global 401 redirect into `/login`).

### 2. Sign in routes a fresh user to `/mandate`
Click **Login** → complete Privy. After the embedded Solana wallet creates, you should land on `/mandate` with an empty form.

**What's being verified**: SessionGate sees a verifiable `privy-token` cookie but no `User` row yet (or no `Mandate` for that user) and returns `NEEDS_MANDATE`. The server redirects you before any client JavaScript runs.

### 3. Saving the mandate routes you to `/desk`
Pick a holding period, drawdown, max trade size, and one or more market focus tags. Click **Start Desk**. You should bounce briefly through `/` and land on `/desk`.

**What's being verified**: `POST /api/mandates` upserts the User (first-touch) and creates the Mandate row in one shot via `requireAuthOrUpsert`. `router.push('/')` then triggers the server SessionGate, which now returns `READY` and redirects to `/desk`. No localStorage flag is involved.

### 4. The desk shows at least one BUY proposal
You should see a proposal card. If you don't, open `/dev-tools`, unlock it, and generate a `[DEV_TOOLS]` BUY proposal for the signed-in user. The card has a ticker, suggested size, TP/SL prices, expiry, and short reasoning.

**What's being verified**: `/dev-tools` or `ENABLE_SIGNAL_LOOP=true` ran Pyth + Gemini and persisted Proposal rows for the signed-in user.

### 5. Approving a BUY creates the BUY_PENDING row pair
Click **Review** on the card → adjust parameters if needed → tap **Approve / Place Order**. The card disappears from the feed.

**What's being verified**: `POST /api/orders` with `kind=BUY_TRIGGER` delegates to `acceptBuyProposal` in `packages/db/src/lifecycle/position-lifecycle.ts`. In one Prisma transaction the lifecycle:
- claims the Proposal via `updateMany({where: {status: 'ACTIVE', action: 'BUY'}, data: {status: 'EXECUTED'}})` — concurrent approvals from another tab return `proposal_status_executed` (409),
- creates `Position(state=BUY_PENDING, currentTpPrice, currentSlPrice, entryPriceEstimate)`,
- creates `Order(kind=BUY_TRIGGER, status=OPEN, jupiterOrderId=null)`.

In Postgres, you can verify with:
```sql
SELECT id, state, "currentTpPrice", "currentSlPrice" FROM "Position" ORDER BY "firstEntryAt" DESC LIMIT 1;
SELECT id, kind, status, "triggerPriceUsd" FROM "Order" ORDER BY "createdAt" DESC LIMIT 1;
```

### 6. Trigger-monitor fires a sticky toast when price hits
Open `/desk` and wait for the trigger condition, or use `/dev-tools` to force trigger the owned dev order. In normal runtime the ws-server polls Pyth every 30 s. When the condition matches (BUY: price within ±0.5 % of trigger) you should see a sticky toast.

**What's being verified**: `apps/ws-server/src/orders/trigger-monitor.ts` selects OPEN synthetic Orders, checks Pyth, and emits `trigger:hit` to the user's Socket.IO room. **No DB writes happen here.** The toast can fire repeatedly (every poll) until the user executes — that's intentional idempotent re-firing.

### 7. Executing the BUY trigger fills the order, activates the position, arms TP+SL
Tap **Execute** in the toast. The Privy modal-bypass path (Jupiter Ultra, raw `Uint8Array`, `skipPreflight=true`) signs and broadcasts the swap. After confirmation the toast disappears and the desk shows your new ACTIVE position.

**What's being verified**: before the wallet signs, the client claims the order via `POST /api/orders/[id]/execution-claim`, which CASes `Order.status` from OPEN to PENDING and `Position.state` from BUY_PENDING to ENTERING. Duplicate tabs/stale toasts now fail at claim time and do not start a second on-chain swap. If the wallet swap fails before broadcast, `DELETE /execution-claim` releases the claim back to OPEN/BUY_PENDING. After broadcast, the client posts `{txSignature, executionPrice, tokenAmount}` to `/api/orders/[id]/execute`, which delegates to `confirmBuyFill`. In one Prisma transaction:
- `Order.status` CAS from PENDING (or legacy OPEN) to FILLED (writes `txSignature` — `Order.txSignature @unique` still makes a duplicate settle replay a no-op),
- `Position.state` CAS from ENTERING (or legacy BUY_PENDING) to ACTIVE (writes the actual `entryPrice` / `tokenAmount` / `totalCost`),
- `Trade(side=BUY, source=BUY_APPROVAL)` row,
- `Order(kind=TAKE_PROFIT, status=OPEN, tokenAmount=filled, triggerPriceUsd=tp)`,
- `Order(kind=STOP_LOSS, status=OPEN, tokenAmount=filled, triggerPriceUsd=sl)`.

If TP or SL is missing on the Position, the lifecycle throws `LifecycleInvariantError` and rolls back the entire transaction — no partial state. If two tabs both tap Execute, only the first claim reaches the wallet; later clicks see `order_pending` or `order_filled`.

### 8. `/positions/[id]` reads TP/SL from OPEN exit Orders, and Adjust updates them atomically
Tap your new ACTIVE row. The Position Detail page should show:
- the exact TP/SL prices you confirmed at approve time,
- a chart with TP (green) and SL (red) markers,
- an Adjust TP/SL form prefilled with the current values.

Edit one of the prices (e.g., raise TP) and tap **Update**. The toast says "TP/SL updated"; the page re-renders with the new value.

**What's being verified**: page derives `liveDerivedTp/Sl` from `livePosition.orders.filter(o => o.kind === 'TAKE_PROFIT'/'STOP_LOSS' && o.status === 'OPEN')`. After tapping Update, the client sends one PUT to `/api/positions/[id]/protection`, which delegates to `replaceProtectionOrders`. The lifecycle locks the ACTIVE Position via `updateMany`, cancels the matching OPEN exit Orders, creates new ones (using `Position.tokenAmount` it reads internally, not a value the caller supplies), all in one transaction.

In Postgres after Update you should see exactly one OPEN TAKE_PROFIT and one OPEN STOP_LOSS Order for the position, plus the previously-OPEN ones flipped to CANCELLED.

### 9. A TP or SL trigger closes the position, cancels the sibling, books realized P&L
Wait for the price to cross your TP or SL. The toast fires; tap **Execute**. The Position Detail page transitions to CLOSED with realized P&L visible.

**What's being verified**: the same execution claim runs before the wallet signs: the triggered exit Order moves OPEN → PENDING and the Position moves ACTIVE → CLOSING. Then `confirmExitFill` in one transaction:
- `Order.status` CAS from PENDING (or legacy OPEN) to FILLED for the leg that triggered,
- `Position.state` CAS from CLOSING (or legacy ACTIVE) to CLOSED with `closedReason` and `realizedPnl`,
- sibling exit Order CAS from OPEN to CANCELLED (the OCO cancel),
- `Trade(side=SELL, source=TP_FILL or SL_FILL)`.

If TP and SL trigger at the same poll cycle and both clients tap Execute, the loser fails the execution claim or the Position state CAS and gets a 409 conflict. Only one Trade is ever written, only one realizedPnl is booked, and the loser does not start a second swap after the winner has claimed the position.

### 10. Manual close + panic-close-all both close cleanly
Open another ACTIVE position (or take a fresh one through steps 5-7). Tap **Close Position** on the detail page → confirm. The toast says "<TICKER> closed."; you bounce back to `/desk`.

Repeat with multiple positions ACTIVE, then go to `/desk` and tap **Panic close all**. Each position closes sequentially.

**What's being verified**: `userCloseActive` in one transaction:
- pre-checks `Order.txSignature` (idempotent replay returns `duplicate: true`),
- `Position.state` CAS from ACTIVE to CLOSED with `closedReason='USER_CLOSE'` and computed `realizedPnl`,
- cancels every OPEN TAKE_PROFIT and STOP_LOSS Order on this position,
- creates a synthetic `Order(kind=CLOSE_SWAP, status=FILLED)` carrying the `txSignature` (uniform idempotency mechanism + paired Order for this fill),
- creates `Trade(side=SELL, source=USER_CLOSE)`.

Even if the client fails to cancel exits before calling close (the prior best-effort path), the server still cancels them — the lifecycle owns the invariant, not the client.

## What this script does NOT cover (deferred per ADR-0001)

- Real Privy delegated server signing (the system requires the user to tap)
- LLM proposal generation in production (gated by `ENABLE_SIGNAL_LOOP`)
- Back-evaluation, thesis-monitor SELL signals, Jupiter Trigger v2 order tracker (gated off)
- OS push notifications, leaderboard, fiat onramp
- Multi-user production hardening beyond ownership checks

If any step above fails, fix the lifecycle / route / SessionGate first — never the script.
