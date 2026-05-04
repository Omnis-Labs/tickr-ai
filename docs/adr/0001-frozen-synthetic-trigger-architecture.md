# ADR-0001: Frozen synthetic-trigger architecture

- **Status**: Accepted (2026-05-04)
- **Supersedes**: the autonomous "Jupiter Trigger Order v2" model described in `docs/architecture.md`, `docs/signal-engine.md`, and `docs/screens-and-flows.md`.
- **Set by**: PR #8 (commit `c2cb153`, 2026-05-02) verified end-to-end on Solana mainnet (BUY tx `5FUrvR…7Rf`, SELL/close tx `5W9GE5…D2KQ`).

## Context

The original v1.3 design assumed Jupiter Trigger Order v2 would hold USDC in a vault and execute trigger orders autonomously while the user was away. In practice **Backed Finance xStocks (Token-2022 mints) are not on Jupiter Trigger v2's allowlist**, so we cannot deposit them into a Jupiter vault. Two days of attempts to coerce Jupiter into accepting Token-2022 (custom auth, server-side mint mapping, modal bypasses) ended in PR #8: drop the Jupiter Trigger v2 client entirely and replace it with a synthetic model.

## Decision

The product is frozen on the synthetic-trigger model. Its shape:

1. **Approve** a BUY proposal writes a `Position(BUY_PENDING)` and a single `Order(kind=BUY_TRIGGER, status=OPEN, jupiterOrderId=null)` to Postgres. **No Jupiter call. No signature. No USDC lock.**
2. **`apps/ws-server`** runs `runTriggerMonitor` every 30 s. It polls Pyth Hermes for every OPEN synthetic order's ticker, checks the trigger condition (BUY: within 0.5 % of trigger; TP: ≥; SL: ≤), and emits `trigger:hit` over Socket.IO to `user:<walletAddress>`. **No DB writes.**
3. **The user** sees a sticky toast and taps **Execute**. The frontend signs and broadcasts a Jupiter **Ultra** swap (Privy `useSignAndSendTransaction` with raw `Uint8Array` + `skipPreflight=true`).
4. **`POST /api/orders/[id]/execute`** settles: marks the Order `FILLED`, transitions `Position` to `ACTIVE` (BUY) or `CLOSED` (TP/SL), records a `Trade`, arms or OCO-cancels exit Orders.

The system is deliberately **not autonomous**. It is **tap-to-execute**: ws-server detects, user confirms, frontend swaps. Server-side delegated signing is out of scope for this freeze.

## Consequences

### What stays in default runtime

- `apps/web` (REST + UI)
- `apps/ws-server` `trigger-monitor` task (the only required ws-server service)
- Privy embedded wallet (Solana)
- Pyth Hermes price feeds
- Jupiter Ultra swap aggregator (client-side, user-signed)
- Postgres / Prisma; one shared DB; one Prisma client per process

### What is now opt-in (env-gated, default off)

| Env flag | Service | Why disabled |
|---|---|---|
| `ENABLE_JUPITER_ORDER_TRACKER` | `apps/ws-server` Order Tracker | Polls Jupiter for orders that don't exist; synthetic Orders have `jupiterOrderId=null`. |
| `ENABLE_THESIS_MONITOR` | `apps/ws-server` Thesis Monitor | Generates SELL signals that race the OCO close model; not part of the documented exit flow. |
| `ENABLE_BACK_EVAL` | `apps/ws-server` back-evaluator | Analytics, not user-visible. |

### What is dead and can be deleted

- `apps/web/lib/jupiter/use-jupiter-trigger.ts` and the v2 client modules — already deleted in PR #8.
- `apps/web/app/api/jupiter/[...path]/route.ts` proxy — already deleted.
- The `localStorage` `onboarded:<wallet>` flag and the four-step `/onboarding` browser-permission wizard — deleted in this branch (commits `62bacb2`, `d73f52d`).

### What is residual but kept (deliberate)

- **`Order.jupiterOrderId`** column. Always `null` under the frozen model but retained because (a) dropping a column requires a Postgres migration that's not on the cohesive-core critical path, (b) the gated `runOrderTracker` task still type-references it. Treat it as vestigial; do not write it.
- **`Position.state` values `ENTERING` and `CLOSING`**. Documented but never emitted; code transitions `BUY_PENDING → ACTIVE → CLOSED` directly. Will be revisited when `PositionLifecycle` lands (C4) and TP/SL arming becomes transactional (Q8 in the gotchas Oracle session).
- **`Order.status` values `PENDING`, `PARTIALLY_FILLED`, `EXPIRED`, `FAILED`**. Code uses only `OPEN`, `FILLED`, `CANCELLED`. `PARTIALLY_FILLED` appears in the `/execute` precondition check (`OPEN | PARTIALLY_FILLED`); leave the value, never write it.
- **Legacy v1.2 types in `packages/shared/src/types.ts`** (`Signal`, `SignalSchema`, `Approval*`, `LlmSignalOutput`, `TradeStatus`, the legacy `Trade`/`Position` Zod shapes that collide with Prisma names, `WsServerEvents.SignalNew/SignalExpired`, `WsClientEvents.ApprovalDecision`). Still wired through the parallel signal/proposal flow (`signal-modal`, `apps/ws-server/src/signals/generator.ts`, `/signals/[id]`). Merging that flow into the proposal flow is its own deepening candidate; do not touch in this pass.

### What we are NOT doing in v1 of the freeze

- Server-side delegated signing.
- Truly autonomous execution.
- Returning to Jupiter Trigger v2.
- Real LLM-driven proposal generation in production.
- Back-evaluation in default runtime.
- OS push notifications.
- Leaderboard, Life Credit, fiat onramp.
- Schema migrations to drop unused enum values or vestigial columns.

## Manual click-through that defines "the system works"

> **To exercise step 4**, the operator must turn on a proposal source.
> The two supported modes are: `DEMO_MODE=true` (in-memory demo loop
> generates fake proposals — best for click-through smoke tests) or
> `ENABLE_SIGNAL_LOOP=true` (live Pyth + LLM proposal generator —
> requires `ANTHROPIC_API_KEY`, real DB connection, and respects
> `LLM_DAILY_USD_CAP`). Both default to false in the freeze; the
> system is ship-ready WITHOUT proposals — the trade execution +
> protection lifecycle is the load-bearing core.

1. Open `/` while signed out → see the marketing landing.
2. Sign in via Privy → if no mandate, land on `/mandate`.
3. Fill the four mandate inputs and save → land on `/desk`.
4. See at least one BUY proposal (requires the operator to enable a
   proposal source, see note above).
5. Tap **Approve** → `Order(BUY_TRIGGER, status=OPEN)` and `Position(BUY_PENDING)` exist.
6. Force or wait for the BUY trigger to fire → toast appears.
7. Tap **Execute** → Jupiter Ultra swap signs and broadcasts; `/execute` settles `Order=FILLED`, `Position=ACTIVE`; **two** OPEN exit Orders (TP, SL) exist.
8. Open `/positions/[id]` → TP and SL render from the OPEN exit Orders; adjust either → the corresponding Order updates.
9. Force or wait for a TP or SL trigger → toast → tap **Execute** → `Order=FILLED`, sibling Order = `CANCELLED`, `Position=CLOSED`, realized P&L recorded.
10. From `/desk`, **panic-close** any open `Position` → cleanly closes and cancels its open exits.

If any of those ten steps fails, the freeze is leaky and we fix it before adding any new feature.
