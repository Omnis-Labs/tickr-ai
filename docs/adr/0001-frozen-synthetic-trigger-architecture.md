# ADR-0001: Frozen synthetic-trigger architecture

- **Status**: Accepted (2026-05-04)
- **Supersedes**: the earlier autonomous external execution model described in older architecture drafts.
- **Set by**: PR #8 (commit `c2cb153`, 2026-05-02) verified end-to-end on Solana mainnet (BUY tx `5FUrvR…7Rf`, SELL/close tx `5W9GE5…D2KQ`).

## Context

The original v1.3 design assumed an external provider would custody assets and execute triggers autonomously while the user was away. That model did not fit the tokenized-asset surface we are actually shipping, and it added auth, custody, and polling state that competed with the product's tap-to-execute lifecycle. PR #8 froze the product on a synthetic model instead.

## Decision

The product is frozen on the synthetic-trigger model. Its shape:

1. **Approve** a BUY proposal writes a `Position(BUY_PENDING)` and a single `Order(kind=BUY_TRIGGER, status=OPEN, jupiterOrderId=null)` to Postgres. **No Jupiter call. No signature. No USDC lock.**
2. **`apps/ws-server`** runs `runTriggerMonitor` every 30 s. It polls Pyth Hermes for every OPEN synthetic order's ticker, checks the trigger condition (BUY: within 0.5 % of trigger; TP: ≥; SL: ≤), and emits `trigger:hit` over Socket.IO to `user:<walletAddress>`. **No DB writes.**
3. **The user** sees a sticky toast and taps **Execute**. The frontend claims the Order (`OPEN → PENDING`), requests a Jupiter **Ultra** `/order`, has Privy sign the user's/taker's signature slot with `signTransaction`, then submits the signed bytes to Jupiter Ultra `/execute`. Jupiter returns the on-chain signature for the sponsored swap.
4. **`POST /api/orders/[id]/execute`** settles after the Ultra swap returns a signature: marks the Order `FILLED`, transitions `Position` to `ACTIVE` (BUY) or `CLOSED` (TP/SL), records a `Trade`, arms or OCO-cancels exit Orders.

The system is deliberately **not autonomous**. It is **tap-to-execute**: ws-server detects, user confirms, frontend swaps. Server-side transaction signing is out of scope for this freeze.

## Consequences

### What stays in default runtime

- `apps/web` (REST + UI)
- `apps/ws-server` `trigger-monitor` task (the only required ws-server service)
- Privy embedded wallet (Solana)
- Pyth Hermes price feeds
- Jupiter Ultra swap aggregator (client-side user signature, Jupiter `/execute` relay for sponsored execution)
- Postgres / Prisma; one shared DB; one Prisma client per process

### What is now opt-in (env-gated, default off)

| Env flag                | Service                         | Why disabled                                                                                |
| ----------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| `ENABLE_THESIS_MONITOR` | `apps/ws-server` Thesis Monitor | Generates SELL signals that race the OCO close model; not part of the documented exit flow. |
| `ENABLE_BACK_EVAL`      | `apps/ws-server` back-evaluator | Analytics, not user-visible.                                                                |

### What is dead and can be deleted

- External trigger client/proxy modules — deleted before this freeze.
- The `localStorage` `onboarded:<wallet>` flag and the four-step `/onboarding` browser-permission wizard — deleted in this branch (commits `62bacb2`, `d73f52d`).

### What is residual but kept (deliberate)

- **`Order.jupiterOrderId`** column. Always `null` under the frozen model but retained as a vestigial nullable column for schema compatibility. Treat it as read-only legacy shape; do not write it.
- **`Position.state` values `ENTERING` and `CLOSING`**. These are now used as short-lived execution-claim states while the browser is signing/submitting a synthetic trigger swap: `BUY_PENDING → ENTERING → ACTIVE` for BUY fills and `ACTIVE → CLOSING → CLOSED` for TP/SL fills. If the wallet swap fails before Jupiter Ultra `/execute` returns a signature, the claim is released back to `BUY_PENDING` or `ACTIVE`.
- **`Order.status` value `PENDING`**. This is now the short-lived execution-claim status for synthetic trigger Orders. `POST /api/orders/[id]/execution-claim` atomically claims `OPEN → PENDING` before any on-chain swap starts; `/execute` consumes either `OPEN` (legacy/no-claim path) or `PENDING`; `DELETE /execution-claim` releases only pre-broadcast failures. `PARTIALLY_FILLED`, `EXPIRED`, and `FAILED` remain residual enum values in the frozen synthetic path.
- **Legacy v1.2 types in `packages/shared/src/types.ts`** (`Signal`, `SignalSchema`, `Approval*`, `LlmSignalOutput`, `TradeStatus`, the legacy `Trade`/`Position` Zod shapes that collide with Prisma names, `WsServerEvents.SignalNew/SignalExpired`, `WsClientEvents.ApprovalDecision`). Still wired through the parallel signal/proposal flow (`signal-modal`, `apps/ws-server/src/signals/generator.ts`, `/signals/[id]`). Merging that flow into the proposal flow is its own deepening candidate; do not touch in this pass.

### What we are NOT doing in v1 of the freeze

- Server-side transaction signing in the default product flow. `/dev-tools` may contain isolated experiments, such as the Privy delegated Ultra swap block, but those experiments do not change the frozen production runtime.
- Truly autonomous execution.
- Returning to autonomous external execution.
- Real LLM-driven proposal generation in production.
- Back-evaluation in default runtime.
- OS push notifications.
- Leaderboard, Life Credit, fiat onramp.
- Schema migrations to drop unused enum values or vestigial columns.

## Manual click-through that defines "the system works"

> **To exercise step 4**, the operator must turn on a proposal source.
> Use `/dev-tools` locally (`ENABLE_DEV_TOOLS=true`) for deterministic
> `[DEV_TOOLS]` proposals and forced owned triggers, or set
> `ENABLE_SIGNAL_LOOP=true` for live Pyth + Gemini background proposals
> (`GEMINI_API_KEY`, real DB connection, `LLM_DAILY_USD_CAP`). The system
> is ship-ready WITHOUT background proposals — the trade execution +
> protection lifecycle is the load-bearing core.

1. Open `/` while signed out → see the marketing landing.
2. Sign in via Privy → if no mandate, land on `/mandate`.
3. Fill the four mandate inputs and save → land on `/desk`.
4. See at least one BUY proposal (requires the operator to enable a
   proposal source, see note above).
5. Tap **Approve** → `Order(BUY_TRIGGER, status=OPEN)` and `Position(BUY_PENDING)` exist.
6. Force or wait for the BUY trigger to fire → toast appears.
7. Tap **Execute** → Jupiter Ultra `/order` is signed by the user, Jupiter Ultra `/execute` returns a signature, then our `/execute` settles `Order=FILLED`, `Position=ACTIVE`; **two** OPEN exit Orders (TP, SL) exist.
8. Open `/positions/[id]` → TP and SL render from the OPEN exit Orders; adjust either → the corresponding Order updates.
9. Force or wait for a TP or SL trigger → toast → tap **Execute** → `Order=FILLED`, sibling Order = `CANCELLED`, `Position=CLOSED`, realized P&L recorded.
10. From `/desk`, **panic-close** any open `Position` → cleanly closes and cancels its open exits.

If any of those ten steps fails, the freeze is leaky and we fix it before adding any new feature.
