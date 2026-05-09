# Hunch — API Contract

> REST API endpoints with request/response schemas, WebSocket event contract, Jupiter execution flows, and state transition rules.

---

## Global Rules

- **Authentication**: All REST endpoints require a valid Privy access token in the request header.
- **User resolution**: The authenticated user is resolved server-side from the Privy session. Client never passes userId.
- **Ownership enforcement**: All resource IDs (proposal, order, position) are scoped to the authenticated user. If a resource exists but belongs to another user, the API returns `404 Not Found` (not `403 Forbidden`).
- **Decimal precision**: All USD amounts use 2 decimal places. All prices and token amounts use 8 decimal places.

---

## REST API (apps/web/app/api/)

### Mandates

**`GET /api/mandates`** — Get the current user's mandate.

Response `200`:

```json
{
  "id": "cuid",
  "holdingPeriod": "1-3 days",
  "maxDrawdown": 0.05,
  "maxTradeSize": 500.0,
  "marketFocus": ["semiconductors", "crypto"],
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

Response `404`: No mandate exists (route to Mandate Setup).

---

**`POST /api/mandates`** — Create a mandate.

Request:

```json
{
  "holdingPeriod": "1-3 days | 1-2 weeks | 1-3 months | 6+ months",
  "maxDrawdown": 0.05,
  "maxTradeSize": 500.0,
  "marketFocus": ["semiconductors", "crypto"]
}
```

`maxDrawdown` is nullable (null = no limit).
`marketFocus` must contain valid `MarketFocusOption` values.

Response `201`: Created mandate object.
Response `409`: Mandate already exists (use PUT to update).

---

**`PUT /api/mandates`** — Update a mandate. Triggers invalidation of all ACTIVE proposals.

Request: Same shape as POST.
Response `200`: Updated mandate object.
Side effect: All ACTIVE proposals for this user are set to `EXPIRED`. A `proposal:invalidated` WebSocket event is emitted.

---

### Proposals

**`GET /api/proposals`** — Get the user's proposals.

Query params: `?status=ACTIVE` (default) | `EXPIRED` | `SKIPPED` | `EXECUTED`
Response `200`: Array of Proposal summary objects (without full reasoning/indicators for list view).

---

**`GET /api/proposals/[id]`** — Get a single proposal's full details.

Response `200`: Full Proposal object including reasoning, positionImpact, indicators.
Response `404`: Proposal not found or not owned by user.

---

**`POST /api/orders`** — Accept a BUY proposal into synthetic trigger state.

This is the primary "Approve" endpoint for BUY proposals. It creates a `Position(BUY_PENDING)` and an `Order(BUY_TRIGGER, OPEN, jupiterOrderId=null)`. It does not call Jupiter, sign a transaction, or lock USDC. When the trigger later hits, ws-server either auto-executes through Privy wallet v2 signer access or falls back to `trigger:hit` tap-to-execute.

Request:

```json
{
  "walletAddress": "base58",
  "proposalId": "cuid",
  "ticker": "AAPLx",
  "kind": "BUY_TRIGGER",
  "side": "BUY",
  "triggerPriceUsd": 174.5,
  "sizeUsd": 400.0,
  "jupiterOrderId": null,
  "txSignature": null,
  "slippageBps": 50,
  "createPosition": {
    "mint": "xstock-or-crypto-mint",
    "entryPriceEstimate": 174.5,
    "tpPrice": 195.0,
    "slPrice": 168.0
  }
}
```

Response `201`:

```json
{
  "ok": true,
  "duplicate": false,
  "order": { "id": "...", "kind": "BUY_TRIGGER", "status": "OPEN" },
  "positionId": "..."
}
```

Response `400`: Validation error (missing proposal data, invalid prices).
Response `404`: Proposal not found.
Response `409`: Proposal already executed, skipped, or expired.

**Atomicity**: Proposal status update, Position creation, and BUY trigger Order creation happen in a single DB transaction. The Trade row is written later when `/api/orders/[id]/execute` settles the on-chain fill.

---

### Skips

**`POST /api/skips`** — Record a skip.

Request:

```json
{
  "proposalId": "cuid",
  "reason": "TOO_RISKY | DISAGREE_THESIS | BAD_TIMING | ENOUGH_EXPOSURE | PRICE_NOT_ATTRACTIVE | TOO_MANY_PROPOSALS | OTHER",
  "detail": "optional free text"
}
```

Response `201`: Created Skip object.
Response `404`: Proposal not found.
Response `409`: Proposal already skipped, executed, or expired.

Side effect: Proposal status set to `SKIPPED`.

---

### Orders

**`GET /api/orders`** — Get user's open orders.

Query params: `?status=OPEN` (default) | `PENDING` | `ALL`
Response `200`: Array of Order objects.

---

**`POST /api/orders/[id]/cancel`** — Cancel a trigger order.

Allowed for `BUY_TRIGGER`, `TAKE_PROFIT`, and `STOP_LOSS` synthetic Orders in `OPEN` state. There is no vault withdrawal and no signature in the cancel path.

Request: empty JSON body.

Response `200`: Updated Order with `status = CANCELLED`.
Response `409`: Order not in cancellable state.

---

**`PUT /api/orders/[id]/edit`** — Edit a trigger order's price.

Allowed only when ALL conditions are met:

- `kind` is `TAKE_PROFIT` or `STOP_LOSS`
- `status` is `OPEN`
- Associated Position `state` is `ACTIVE`
- Authenticated user owns the order

Request:

```json
{ "triggerPriceUsd": 170.0 }
```

Response `200`: Updated Order object.
Response `409`: Order or Position not in editable state.

Side effect: Updates Position's `currentTpPrice` or `currentSlPrice`.

---

### Positions

**`GET /api/positions`** — Get all user positions.

Query params: `?state=ACTIVE` | `BUY_PENDING` | `CLOSED` | `ALL` (default: all non-CLOSED)
Response `200`: Array of Position objects.

---

**`GET /api/positions/[id]`** — Get a single position with associated orders.

Response `200`: Position object with nested orders array.
Response `404`: Position not found or not owned.

---

**`POST /api/positions/[id]/close`** — Close a position.

Allowed only when Position `state = ACTIVE`.

The close flow uses the strict model: cancel TP, then cancel SL, then swap. Both cancels must succeed before the swap executes.

Request: `{}` (no body needed)
Response `200`:

```json
{
  "position": { "id": "...", "state": "CLOSED", "realizedPnl": 43.25 },
  "trade": { "id": "...", "source": "USER_CLOSE" },
  "closeOrder": { "id": "...", "kind": "CLOSE_SWAP", "status": "FILLED" }
}
```

Response `409`: Position not in closeable state.

**Persistence**: Before executing the Jupiter Swap, create an `Order(kind = CLOSE_SWAP, side = SELL, status = PENDING)`. On swap success, set `status = FILLED` with `txSignature`, `executionPrice`, `filledAmount`. On failure, set `status = FAILED`.

---

### Delegated Execution

**`GET /api/delegated-execution/status`** — Read live Auto-execute triggers readiness.

This route does not read or write a Hunch DB toggle. Privy wallet v2 signer status is the source of truth, and Settings uses Privy client APIs to attach or remove signer access.

Response `200`:

```json
{
  "ok": true,
  "serverKey": {
    "configured": true,
    "env": "PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY"
  },
  "serverSigner": {
    "configured": true,
    "env": [
      "PRIVY_WALLET_AUTHORIZATION_SIGNER_ID",
      "NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_SIGNER_ID"
    ],
    "walletMatched": true
  },
  "wallet": {
    "address": "base58",
    "privyWalletId": "wallet-id",
    "delegated": true,
    "walletClientType": "privy-v2",
    "connectorType": "embedded",
    "additionalSignerIds": ["signer-id"],
    "ownerId": "did:privy:...",
    "policyIds": [],
    "authorizationThreshold": null,
    "resolveError": null
  },
  "ready": {
    "canExecute": true,
    "blockers": []
  }
}
```

Response `401`: Not authenticated.
Response `500`: Privy server configuration or lookup failed.

Common readiness blockers include `missing_privy_authorization_private_key`, `missing_privy_authorization_signer_id`, `unsupported_privy_wallet_client_type`, `wallet_missing_authorization_signer`, and `wallet_not_delegated`.

---

### Portfolio

**`GET /api/portfolio`** — Get portfolio summary.

Response `200`:

```json
{
  "totalValueUsd": 5130.0,
  "dayPnlUsd": 120.5,
  "dayPnlPct": 2.4,
  "totalPnlUsd": 330.0,
  "totalPnlPct": 6.9,
  "cashUsd": 1200.0,
  "positions": []
}
```

---

**`POST /api/portfolio/sync`** — Sync on-chain balances to DB.

Request:

```json
{
  "onChainBalances": [
    { "mint": "...", "amount": 5.62 },
    { "mint": "...", "amount": 100.0 }
  ]
}
```

Response `200`: Sync result with created/updated/unchanged counts.

---

### Trades

**`GET /api/trades`** — Get trade history.

Query params: `?limit=50&offset=0`
Response `200`: Array of Trade objects, newest first.

---

### Price Data

**`GET /api/bars/[assetId]`** — Proxy Pyth Benchmarks historical candle data.

Query params: `?range=1D` | `5D` | `1M` | `3M`
Response `200`: Array of OHLCV candle objects.

---

## WebSocket Events (Socket.IO)

The ws-server runs Socket.IO. Authentication uses Privy access tokens (not raw wallet addresses) to prevent unauthorized room joins.

### Connection and Authentication

```typescript
// Client connects and authenticates
socket.emit('auth', { privyAccessToken: string });

// Server verifies token, resolves user, joins room user:{walletAddress}
// Server responds with:
socket.on('auth:ok', { room: string });
socket.on('auth:error', { reason: string });
```

### Client to Server

| Event  | Payload                        | Description                  |
| ------ | ------------------------------ | ---------------------------- |
| `auth` | `{ privyAccessToken: string }` | Authenticate, join user room |
| `ping` | (none)                         | Heartbeat                    |

### Server to Client

| Event              | Payload                                                                                                          | Description                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `signal:new`       | Legacy Signal object                                                                                             | Legacy signal modal path                                    |
| `proposal:new`     | Full Proposal object                                                                                             | New BUY or SELL proposal generated for this user            |
| `trigger:hit`      | `{ orderId, positionId, ticker, mint, kind, side, triggerPriceUsd, currentPriceUsd, sizeUsd, tokenAmount }`      | Synthetic trigger matched and needs tap-to-execute fallback |
| `trade:filled`     | `{ orderId, positionId, ticker, kind, side, executionMode, executionPrice, tokenAmount, usdValue, txSignature }` | Trigger filled, usually by delegated execution              |
| `position:updated` | `{ positionId, state, currentTpPrice?, currentSlPrice?, realizedPnl? }`                                          | Position state changed                                      |
| `pong`             | `{ timestamp }`                                                                                                  | Heartbeat response                                          |

**Frontend behavior on `position:updated`**: Refetch `GET /api/positions/[id]` and `GET /api/portfolio` for complete updated data.
**Frontend behavior on `trade:filled`**: Dismiss stale trigger prompts, show a fill notification, and refetch orders, positions, the filled position, and portfolio state.

---

## Proposal Lifecycle

| From   | Trigger                                            | To       |
| ------ | -------------------------------------------------- | -------- |
| ACTIVE | BUY acceptance through `POST /api/orders` succeeds | EXECUTED |
| ACTIVE | `POST /api/skips` succeeds                         | SKIPPED  |
| ACTIVE | `expiresAt` < now (checked by ws-server)           | EXPIRED  |
| ACTIVE | Mandate updated                                    | EXPIRED  |

Expired, skipped, and executed proposals are still queryable via `GET /api/proposals?status=...` but removed from the active feed.

---

## Order State Transitions

| From    | Event                                                       | To        | Side Effects                                                                                                  |
| ------- | ----------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| OPEN    | `POST /execution-claim` succeeds                            | PENDING   | Claim execution before any wallet signing; BUY moves `BUY_PENDING → ENTERING`, exits move `ACTIVE → CLOSING`. |
| PENDING | Jupiter Ultra `/execute` returns signature, then DB settles | FILLED    | Set `txSignature`, execution price, token amount. BUY arms TP/SL Orders; TP/SL cancels sibling exit.          |
| PENDING | Swap fails before Jupiter Ultra returns signature           | OPEN      | `DELETE /execution-claim` releases the claim for retry.                                                       |
| OPEN    | User cancel succeeds                                        | CANCELLED | Cancel synthetic BUY trigger; close parent `BUY_PENDING` Position.                                            |
| OPEN    | TP/SL edit succeeds                                         | OPEN      | Replace the matching synthetic exit Order in DB.                                                              |

---

## Synthetic Trigger + Jupiter Ultra Execution Flow

### BUY Proposal Acceptance

When a user approves a proposal:

```
POST /api/orders
  -> Position(BUY_PENDING)
  -> Order(BUY_TRIGGER, OPEN, jupiterOrderId=null)
```

No Jupiter request happens here.

### Tap-to-Execute Trigger Fill

This is the fallback when Auto-execute triggers is off, Privy wallet v2 signer access is not live, or delegated execution fails before `/execute` is attempted. When the ws-server emits `trigger:hit` and the user taps Execute:

1. `POST /api/orders/[id]/execution-claim` atomically claims `OPEN → PENDING`.
2. Browser prepares the swap amount. BUY spends USDC. SELL reads the wallet's matching mint balance across both classic SPL Token (`Tokenkeg...`) and Token-2022 (`TokenzQd...`) accounts, then caps the submitted raw amount at the lesser of the Order's `tokenAmount` and the wallet balance.
3. Browser requests Jupiter Ultra `/order`.
4. Browser asks Privy `signTransaction` to sign the user/taker signature slot.
5. Browser sends `{ requestId, signedTransaction }` to Jupiter Ultra `/execute`.
6. If Jupiter returns a signature, browser posts `{ txSignature, executionPrice, tokenAmount }` to `POST /api/orders/[id]/execute`.
7. If the swap fails before Jupiter returns a signature, browser releases the claim with `DELETE /api/orders/[id]/execution-claim`.

**Failure recovery by phase:**

- Claim fails: another tab/user action already owns or settled the Order; do not start a swap.
- Ultra `/order` or signing fails before `/execute` is attempted: release claim and allow retry.
- `/execute` is attempted but no signature is returned, or Jupiter returns a signature but DB settle fails: do not release the claim automatically; refresh/reconcile before retry.

### Delegated Trigger Fill

When a trigger hits and Privy wallet v2 signer access is live:

1. ws-server resolves the user's Privy delegated wallet and signer readiness at execution time using the shared readiness Module.
2. ws-server prepares the same Jupiter Ultra swap plan used by tap-to-execute. BUY spends USDC. SELL reads the wallet's matching mint balance across both token programs and caps the submitted raw amount at the lesser of the Order's `tokenAmount` and the wallet balance.
3. ws-server atomically claims the Order.
4. ws-server requests Jupiter Ultra `/order`.
5. ws-server asks Privy to sign with the delegated wallet authorization key.
6. ws-server sends `{ requestId, signedTransaction }` to Jupiter Ultra `/execute`.
7. If Jupiter returns a signature, ws-server settles through the same PositionLifecycle functions used by `POST /api/orders/[id]/execute`.
8. On success, ws-server emits `trade:filled`.

If delegation, server signing readiness, or balance is unavailable, TriggerExecutionDispatch emits `trigger:hit` and lets the normal fallback path handle execution. If a transient Privy/Jupiter runtime error happens before `/execute` is attempted, TriggerExecutionDispatch may apply a short delegated runtime cooldown and then falls back. If `/execute` is attempted but no signature is returned, or if Jupiter returns a signature but DB settlement fails, ws-server keeps the execution claim locked for reconciliation and does not emit a manual fallback because a second swap could double-fill.

### BUY Fill Settlement

When `POST /api/orders/[id]/execute` settles a BUY:

1. `Order.status` moves `PENDING` (or legacy `OPEN`) to `FILLED`.
2. `Position.state` moves `ENTERING` (or legacy `BUY_PENDING`) to `ACTIVE`.
3. Trade row records `source=BUY_APPROVAL`.
4. Two synthetic exit Orders are created: `TAKE_PROFIT(OPEN)` and `STOP_LOSS(OPEN)`.

### OCO Behavior (One-Cancels-Other)

When a TP or SL synthetic Order is executed and settled:

1. Filled exit Order moves `PENDING` (or legacy `OPEN`) to `FILLED`.
2. Sibling exit Order moves `OPEN` to `CANCELLED`.
3. Calculate `realizedPnl` on the Position
4. Update Position: `state = CLOSED`, set `closedAt`, `closedReason` (TP_FILLED or SL_FILLED)
5. Record a Trade with `source = TP_FILL` or `SL_FILL`, `proposalId` pointing to original BUY proposal
6. Emit `order:filled` and `position:updated` to user

### Close Position (User-initiated, strict model)

1. Set Position `state = CLOSING`
2. Cancel TP trigger order (must succeed)
3. Cancel SL trigger order (must succeed)
4. Create Order `(kind = CLOSE_SWAP, side = SELL, status = PENDING)`
5. Execute Jupiter Swap at market price for full position
6. Update CLOSE_SWAP Order: `status = FILLED`, set `txSignature`, `executionPrice`, `filledAmount`
7. Update Position: calculate `realizedPnl`, `state = CLOSED`, `closedReason = USER_CLOSE`
8. Record Trade with `source = USER_CLOSE`, `proposalId = null`

If cancel fails: do NOT proceed to swap. Retry cancellation. Position stays `CLOSING`.
If swap fails after both cancels succeed: Position stays `CLOSING` with no exit orders. Prompt user to retry swap.

### Cancel BUY Pending Order

1. Cancel via `POST /api/orders/[id]/cancel`
2. Server atomically updates Order: `status = CANCELLED`
3. Server closes the parent `BUY_PENDING` Position with `closedReason = BUY_CANCELLED`

### Open Orders — Allowed Actions

| Order Kind  | Cancel?                 | Edit?                    |
| ----------- | ----------------------- | ------------------------ |
| BUY_TRIGGER | Yes                     | No                       |
| TAKE_PROFIT | No (use Close Position) | Yes (edit trigger price) |
| STOP_LOSS   | No (use Close Position) | Yes (edit trigger price) |
| CLOSE_SWAP  | No                      | No                       |
