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
  "holdingPeriod": "SHORT_TERM",
  "maxDrawdown": 0.05,
  "maxTradeSize": 500.0,
  "marketFocus": ["SEMICONDUCTORS", "BLUECHIP_CRYPTO"],
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
  "holdingPeriod": "SHORT_TERM | SWING | MEDIUM_TERM | LONG_TERM",
  "maxDrawdown": 0.05,
  "maxTradeSize": 500.0,
  "marketFocus": ["SEMICONDUCTORS", "BLUECHIP_CRYPTO"]
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

**`POST /api/proposals/[id]/execute`** — Execute a proposal (approve BUY, create Position + Trade + Order).

This is the primary "Place Order" endpoint. Called after the frontend completes the Jupiter 4-step flow.

Request:

```json
{
  "actualSizeUsd": 400.0,
  "actualTriggerPrice": 174.5,
  "actualTpPrice": 195.0,
  "actualSlPrice": 168.0,
  "jupiterOrderId": "jupiter-order-id-string",
  "txSignature": "solana-tx-signature"
}
```

Response `201`:

```json
{
  "proposal": { "id": "...", "status": "EXECUTED" },
  "position": { "id": "...", "state": "BUY_PENDING" },
  "trade": { "id": "...", "source": "BUY_APPROVAL" },
  "order": { "id": "...", "kind": "BUY_TRIGGER", "status": "OPEN" }
}
```

Response `400`: Validation error (insufficient balance, invalid prices).
Response `404`: Proposal not found.
Response `409`: Proposal already executed, skipped, or expired.

**Atomicity**: Proposal status update, Position creation, Trade creation, and Order creation happen in a single DB transaction. If any step fails, all are rolled back.

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

Allowed only for:

- `kind = BUY_TRIGGER` with `status = OPEN`
- Expired orders needing vault fund withdrawal (use `/withdraw` instead for clarity)

The cancel flow is two steps: initiate cancellation, then client signs withdrawal tx, then confirm.

Request (step 1, initiate):

```json
{ "action": "initiate" }
```

Response `200`:

```json
{ "withdrawalTx": "base64-encoded-unsigned-tx" }
```

Request (step 2, confirm):

```json
{
  "action": "confirm",
  "signedTx": "base64-encoded-signed-tx"
}
```

Response `200`: Updated Order with `status = CANCELLED`.
Response `403`: Cannot cancel TP/SL orders directly (use Close Position or Edit instead).
Response `409`: Order not in cancellable state.

---

**`POST /api/orders/[id]/withdraw`** — Withdraw funds from an expired order's vault.

Same two-step flow as cancel. Used when a BUY order expires without filling.

Response `200`: Funds returned, Order status remains `EXPIRED`.

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

// Server verifies token, resolves user, joins room user:{userId}
// Server responds with:
socket.on('auth:success', { userId: string, walletAddress: string });
socket.on('auth:error', { message: string });
```

### Client to Server

| Event  | Payload                        | Description                  |
| ------ | ------------------------------ | ---------------------------- |
| `auth` | `{ privyAccessToken: string }` | Authenticate, join user room |
| `ping` | (none)                         | Heartbeat                    |

### Server to Client

| Event                  | Payload                                                                      | Description                            |
| ---------------------- | ---------------------------------------------------------------------------- | -------------------------------------- |
| `proposal:new`         | Full Proposal object                                                         | New proposal generated for this user   |
| `proposal:invalidated` | `{ proposalIds: string[], reason: "MANDATE_CHANGED" }`                       | Proposals invalidated (mandate update) |
| `order:filled`         | `{ orderId, positionId, kind, assetId, side, executionPrice, filledAmount }` | Order filled (BUY/TP/SL)               |
| `order:expired`        | `{ orderId, positionId, kind, assetId }`                                     | Order expired                          |
| `position:updated`     | `{ positionId, state, currentTpPrice?, currentSlPrice?, realizedPnl? }`      | Position state changed                 |
| `pong`                 | `{ timestamp }`                                                              | Heartbeat response                     |

**Frontend behavior on `position:updated`**: Refetch `GET /api/positions/[id]` and `GET /api/portfolio` for complete updated data.

---

## Proposal Lifecycle

| From   | Trigger                                     | To       |
| ------ | ------------------------------------------- | -------- |
| ACTIVE | `POST /api/proposals/[id]/execute` succeeds | EXECUTED |
| ACTIVE | `POST /api/skips` succeeds                  | SKIPPED  |
| ACTIVE | `expiresAt` < now (checked by ws-server)    | EXPIRED  |
| ACTIVE | Mandate updated                             | EXPIRED  |

Expired, skipped, and executed proposals are still queryable via `GET /api/proposals?status=...` but removed from the active feed.

---

## Order State Transitions

| From    | Event                           | To        | Side Effects                                                                              |
| ------- | ------------------------------- | --------- | ----------------------------------------------------------------------------------------- |
| PENDING | Jupiter submit succeeds         | OPEN      | Store `jupiterOrderId`, `txSignature`                                                     |
| PENDING | Submit fails                    | FAILED    | Show retry option                                                                         |
| OPEN    | Fill detected (Order Tracker)   | FILLED    | Set `executionPrice`, `filledAmount`, `filledAt`. Trigger downstream (Auto TP/SL or OCO). |
| OPEN    | Expiry detected (Order Tracker) | EXPIRED   | Prompt vault fund reclaim                                                                 |
| OPEN    | User cancel succeeds            | CANCELLED | Return vault funds                                                                        |
| OPEN    | Jupiter in-place edit succeeds  | OPEN      | Update `triggerPriceUsd`                                                                  |

---

## Jupiter Trigger Order v2 — Execution Flow

### BUY Order Placement (4-step flow)

When a user approves a proposal and taps "Place Order":

```
Step 1: GET  /trigger/v2/vault
        -> Get or register the user's Jupiter vault address

Step 2: POST /trigger/v2/deposit/craft
        -> Build a deposit transaction (wallet -> vault)
        -> Returns unsigned transaction

Step 3: Privy embedded wallet signs the deposit transaction

Step 4: POST /trigger/v2/orders/price
        -> Submit signed deposit tx + order parameters
        -> Returns { id, txSignature }
```

**Failure recovery by step:**

- Step 1-2 fail: No funds moved. Show error, retry.
- Step 3 (user rejects signature): No funds moved. Show "Transaction was not signed. No order was placed."
- Step 3 succeeds, Step 4 fails: Deposit may be confirmed but order not created. Funds are in Jupiter vault. Show "Deposit confirmed but order creation failed." Offer retry order creation or fund withdrawal.
- Step 4 succeeds: Call `POST /api/proposals/[id]/execute` to persist all records atomically.

**Record creation timing**: DB records (Position, Trade, Order) are created ONLY after Step 4 succeeds, via the `/execute` endpoint. No records are created before the Jupiter order is confirmed.

### Auto TP/SL Placement (after BUY fills)

When the Order Tracker detects a BUY fill:

1. Update BUY Order: `status = FILLED`, set `executionPrice`, `filledAmount`, `filledAt`
2. Update Position: set `entryPrice`, `tokenAmount`, `totalCost`, `firstEntryAt`, `state = ENTERING`
3. Create Order `(kind = TAKE_PROFIT, side = SELL, status = PENDING)`, place via Jupiter, set `status = OPEN`, store `jupiterOrderId`
4. Create Order `(kind = STOP_LOSS, side = SELL, status = PENDING)`, place via Jupiter, set `status = OPEN`, store `jupiterOrderId`
5. Update Position: set `currentTpPrice`, `currentSlPrice`, `state = ACTIVE`
6. If either placement fails, retry. Position stays `ENTERING` until both succeed.
7. Emit `position:updated` to user

### OCO Behavior (One-Cancels-Other)

When the Order Tracker detects a TP or SL fill:

1. Update filled Order: `status = FILLED`
2. Cancel the other exit order, update: `status = CANCELLED`
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

1. Initiate cancellation via `POST /api/orders/[id]/cancel`
2. Build withdrawal transaction (vault to wallet)
3. Privy wallet signs the withdrawal
4. Confirm the withdrawal
5. Funds return from Jupiter vault to wallet
6. Update Order: `status = CANCELLED`
7. Update Position: `state = CLOSED`, `closedReason = BUY_CANCELLED`

### Open Orders — Allowed Actions

| Order Kind  | Cancel?                 | Edit?                    |
| ----------- | ----------------------- | ------------------------ |
| BUY_TRIGGER | Yes                     | No                       |
| TAKE_PROFIT | No (use Close Position) | Yes (edit trigger price) |
| STOP_LOSS   | No (use Close Position) | Yes (edit trigger price) |
| CLOSE_SWAP  | No                      | No                       |
