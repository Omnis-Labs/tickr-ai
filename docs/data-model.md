# Hunch — Data Model

> Prisma schema, enum definitions, JSON field interfaces, asset registry structure, and data synchronization logic.

---

## Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Users ────────────────────────────────────────────────

model User {
  id            String     @id @default(cuid())
  privyUserId   String     @unique
  walletAddress String     @unique
  createdAt     DateTime   @default(now())
  mandate       Mandate?
  proposals     Proposal[]
  skips         Skip[]
  trades        Trade[]
  positions     Position[]
  orders        Order[]
}

// User creation: On the first authenticated API request after Privy login,
// upsert User by privyUserId, store/update walletAddress. If no mandate
// exists, route to Mandate Setup.

// ─── Mandate ──────────────────────────────────────────────

model Mandate {
  id              String        @id @default(cuid())
  userId          String        @unique
  holdingPeriod   HoldingPeriod
  maxDrawdown     Decimal?      @db.Decimal(5, 4)  // 0.03 | 0.05 | 0.08 | null (no limit)
  maxTradeSize    Decimal       @db.Decimal(20, 2)  // USD
  marketFocus     Json          // MarketFocusOption[] (see JSON Interfaces below)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  user            User          @relation(fields: [userId], references: [id])
}

// ─── Proposals ────────────────────────────────────────────

model Proposal {
  id                       String          @id @default(cuid())
  userId                   String
  assetId                  String          // Canonical asset identifier, e.g. "AAPLx", "SOL", "cbBTC"
  action                   ProposalAction  // BUY only in v1
  suggestedSizeUsd         Decimal         @db.Decimal(20, 2)
  suggestedTriggerPrice    Decimal         @db.Decimal(20, 8)  // AI-suggested entry price
  suggestedTakeProfitPrice Decimal         @db.Decimal(20, 8)  // Mandate-adjusted TP price
  suggestedStopLossPrice   Decimal         @db.Decimal(20, 8)  // Mandate-adjusted SL price
  rationale                String          @db.Text             // One-sentence quantitative summary
  reasoning                Json            // ProposalReasoning (see JSON Interfaces)
  positionImpact           Json            // PositionImpact (see JSON Interfaces)
  confidence               Decimal         @db.Decimal(3, 2)   // 0.00-1.00
  priceAtProposal          Decimal         @db.Decimal(20, 8)
  indicators               Json            // TechnicalIndicators (see JSON Interfaces)
  status                   ProposalStatus  @default(ACTIVE)
  expiresAt                DateTime
  createdAt                DateTime        @default(now())

  // Back-evaluation (populated 1h after creation)
  evaluatedAt              DateTime?
  priceAfter               Decimal?        @db.Decimal(20, 8)
  pctChange                Decimal?        @db.Decimal(8, 4)
  outcome                  ProposalOutcome?

  user                     User            @relation(fields: [userId], references: [id])
  skips                    Skip[]
  trades                   Trade[]

  @@index([userId, status, createdAt])
  @@index([evaluatedAt])
}

// Proposal Lifecycle:
//   ACTIVE -> EXECUTED    (after BUY order successfully created via POST /api/proposals/[id]/execute)
//   ACTIVE -> SKIPPED     (after POST /api/skips succeeds)
//   ACTIVE -> EXPIRED     (expiresAt < now, OR mandate updated triggering invalidation)

// ─── Skips ────────────────────────────────────────────────

model Skip {
  id          String     @id @default(cuid())
  userId      String
  proposalId  String
  reason      SkipReason
  detail      String?
  createdAt   DateTime   @default(now())
  user        User       @relation(fields: [userId], references: [id])
  proposal    Proposal   @relation(fields: [proposalId], references: [id])

  @@unique([userId, proposalId])
}

// ─── Positions ────────────────────────────────────────────
// A user can have multiple independent positions in the same asset.

model Position {
  id             String        @id @default(cuid())
  userId         String
  assetId        String        // Canonical asset identifier (matches Proposal.assetId)
  mint           String        // SPL token mint address
  tokenAmount    Decimal?      @db.Decimal(20, 8)  // Null until BUY fills
  entryPrice     Decimal?      @db.Decimal(20, 8)  // Null until BUY fills (weighted avg)
  totalCost      Decimal?      @db.Decimal(20, 2)  // Null until BUY fills
  currentTpPrice Decimal?      @db.Decimal(20, 8)  // Active TP price (may differ from original)
  currentSlPrice Decimal?      @db.Decimal(20, 8)  // Active SL price (may differ from original)
  state          PositionState @default(BUY_PENDING)
  firstEntryAt   DateTime?                          // Null until BUY fills
  closedAt       DateTime?
  closedReason   ClosedReason?
  realizedPnl    Decimal?      @db.Decimal(20, 2)
  updatedAt      DateTime      @updatedAt
  user           User          @relation(fields: [userId], references: [id])
  orders         Order[]
  trades         Trade[]

  @@index([userId, state])
  @@index([userId, assetId])
}

// Required-by-state rules:
//   BUY_PENDING: tokenAmount, entryPrice, totalCost, firstEntryAt = null
//   ENTERING:    fill fields required (set by Order Tracker on BUY fill)
//   ACTIVE:      fill fields + currentTpPrice + currentSlPrice required
//   CLOSING:     same as ACTIVE
//   CLOSED:      fill fields + closedAt + closedReason required; realizedPnl required for SELL exits

// ─── Orders ───────────────────────────────────────────────
// One record per Jupiter trigger order or swap execution.

model Order {
  id              String      @id @default(cuid())
  userId          String
  positionId      String
  kind            OrderKind   // BUY_TRIGGER | TAKE_PROFIT | STOP_LOSS | CLOSE_SWAP
  side            TradeSide   // BUY | SELL
  triggerPriceUsd Decimal?    @db.Decimal(20, 8)  // Present for trigger orders; null for swaps
  sizeUsd         Decimal     @db.Decimal(20, 2)  // See sizeUsd semantics below
  tokenAmount     Decimal?    @db.Decimal(20, 8)
  status          OrderStatus @default(PENDING)
  jupiterOrderId  String?     @unique
  txSignature     String?
  executionPrice  Decimal?    @db.Decimal(20, 8)
  filledAmount    Decimal?    @db.Decimal(20, 8)
  filledAt        DateTime?
  slippageBps     Int?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt
  user            User        @relation(fields: [userId], references: [id])
  position        Position    @relation(fields: [positionId], references: [id])

  @@index([userId, status])
  @@index([positionId])
}

// sizeUsd semantics by order kind:
//   BUY_TRIGGER:  USDC amount deposited into vault (exact)
//   TAKE_PROFIT:  Estimated notional at trigger price (tokenAmount * triggerPriceUsd)
//   STOP_LOSS:    Estimated notional at trigger price (tokenAmount * triggerPriceUsd)
//   CLOSE_SWAP:   Estimated pre-swap value; updated to actual output on fill

// ─── Trades ───────────────────────────────────────────────
// Records the dual-layer information: what the proposal suggested vs. what the user actually executed.

model Trade {
  id                    String      @id @default(cuid())
  userId                String
  positionId            String
  proposalId            String?     // BUY = required; TP/SL fill = points to original BUY proposal; user close = null
  assetId               String
  side                  TradeSide   // BUY | SELL
  source                TradeSource // BUY_APPROVAL | TP_FILL | SL_FILL | USER_CLOSE

  // Proposal suggestion (immutable snapshot)
  suggestedSizeUsd      Decimal?    @db.Decimal(20, 2)
  suggestedTriggerPrice Decimal?    @db.Decimal(20, 8)
  suggestedTpPrice      Decimal?    @db.Decimal(20, 8)
  suggestedSlPrice      Decimal?    @db.Decimal(20, 8)

  // User's actual execution
  actualSizeUsd         Decimal     @db.Decimal(20, 2)
  actualTriggerPrice    Decimal?    @db.Decimal(20, 8)
  actualTpPrice         Decimal?    @db.Decimal(20, 8)
  actualSlPrice         Decimal?    @db.Decimal(20, 8)
  executionPrice        Decimal?    @db.Decimal(20, 8)  // Fill price
  filledAmount          Decimal?    @db.Decimal(20, 8)  // Fill quantity
  realizedPnl           Decimal?    @db.Decimal(20, 2)  // Calculated on SELL

  createdAt             DateTime    @default(now())
  user                  User        @relation(fields: [userId], references: [id])
  position              Position    @relation(fields: [positionId], references: [id])
  proposal              Proposal?   @relation(fields: [proposalId], references: [id])

  @@index([userId, createdAt])
  @@index([positionId])
}

// ─── LLM Usage Tracking ──────────────────────────────────

model LlmUsageDaily {
  date         DateTime @id @db.Date
  spendUsd     Decimal  @db.Decimal(10, 4)
  requestCount Int      @default(0)
  updatedAt    DateTime @updatedAt
}

// Atomic upsert: INSERT ... ON CONFLICT (date) DO UPDATE SET spendUsd = spendUsd + $delta, requestCount = requestCount + 1
```

---

## Enum Definitions

```prisma
enum HoldingPeriod {
  SHORT_TERM    // UI label: "1-3 days"
  SWING         // UI label: "1-2 weeks"
  MEDIUM_TERM   // UI label: "1-3 months"
  LONG_TERM     // UI label: "6+ months"
}

enum ProposalAction {
  BUY           // v1 only supports BUY
}

enum ProposalStatus {
  ACTIVE
  EXPIRED       // Also used for mandate-change invalidation
  SKIPPED
  EXECUTED
}

enum ProposalOutcome {
  WIN
  LOSS
  NEUTRAL
}

enum SkipReason {
  TOO_RISKY
  DISAGREE_THESIS
  BAD_TIMING
  ENOUGH_EXPOSURE
  PRICE_NOT_ATTRACTIVE
  TOO_MANY_PROPOSALS
  OTHER
}

enum PositionState {
  BUY_PENDING     // BUY trigger order placed, waiting for fill
  ENTERING        // BUY filled, TP/SL being placed automatically
  ACTIVE          // TP + SL both live, strategy running
  CLOSING         // User-initiated close in progress
  CLOSED          // Position fully exited
}

enum ClosedReason {
  TP_FILLED       // Take-profit order filled
  SL_FILLED       // Stop-loss order filled
  USER_CLOSE      // User manually closed
  BUY_CANCELLED   // User cancelled unfilled BUY order
  BUY_EXPIRED     // BUY order expired without fill
}

enum OrderKind {
  BUY_TRIGGER
  TAKE_PROFIT
  STOP_LOSS
  CLOSE_SWAP
}

enum OrderStatus {
  PENDING           // Being prepared / awaiting signature
  OPEN              // Submitted to Jupiter
  FILLED            // Fully executed
  CANCELLED
  EXPIRED
  FAILED
}

// Note: PARTIALLY_FILLED is removed for v1. Jupiter Trigger Orders fill fully or not at all.
// If partial fills become relevant in v2, reintroduce with defined handling rules.

enum TradeSide {
  BUY
  SELL
}

enum TradeSource {
  BUY_APPROVAL    // User approved a BUY proposal
  TP_FILL         // Take-profit order filled
  SL_FILL         // Stop-loss order filled
  USER_CLOSE      // User manually closed the position
}
```

---

## JSON Field Interfaces

These TypeScript interfaces define the shape of all JSON columns. Stored as JSON in PostgreSQL, validated by Zod schemas in `packages/shared`.

### MarketFocusOption

```typescript
// Stored in Mandate.marketFocus as MarketFocusOption[]
type MarketFocusOption =
  | 'TECH_SOFTWARE'
  | 'SEMICONDUCTORS'
  | 'EV_CLEAN_ENERGY'
  | 'FINANCIALS_FINTECH'
  | 'HEALTHCARE_PHARMA'
  | 'CONSUMER_RETAIL'
  | 'ENERGY_UTILITIES'
  | 'CRYPTO_MINING'
  | 'INDUSTRIALS'
  | 'TOKENIZED_ETFS'
  | 'BLUECHIP_CRYPTO'
  | 'NO_PREFERENCE'; // Matches all assets
```

### ProposalReasoning

```typescript
// Stored in Proposal.reasoning
interface ProposalReasoning {
  whatChanged: string; // Market event that triggered this proposal
  whyThisTrade: string; // Argument connecting the event to the trade thesis
  whyFitsMandate: string[]; // List of mandate-mapping sentences, e.g.:
  //   "Fits your 1-2 week holding period"
  //   "Position size $400 is within your $500 max trade size"
  //   "Adds semiconductor exposure, which your mandate targets"
}
```

### PositionImpact

```typescript
// Stored in Proposal.positionImpact
interface PositionImpact {
  assetWeightBefore: number; // 0-1, e.g. 0 means no current exposure
  assetWeightAfter: number; // 0-1, projected after trade
  cashBeforeUsd: number; // Available USDC before trade
  cashAfterUsd: number; // Available USDC after trade
  sector: string; // Sector name, e.g. "Semiconductors"
  sectorWeightBefore: number; // 0-1, aggregate sector exposure before
  sectorWeightAfter: number; // 0-1, aggregate sector exposure after
}
```

### TechnicalIndicators

```typescript
// Stored in Proposal.indicators
interface TechnicalIndicators {
  rsi14: number;
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  };
  ma20: number;
  ma50: number;
}
```

---

## Relationship Model

A BUY proposal becomes a position through the `BUY_APPROVAL` Trade:

```
Proposal.id
  -> Trade.proposalId  (BUY_APPROVAL trade created on execution)
  -> Trade.positionId
  -> Position.id
  -> Order.positionId  (BUY_TRIGGER + TAKE_PROFIT + STOP_LOSS orders)
```

- TP/SL fill Trades keep `proposalId` pointing to the original BUY proposal.
- `USER_CLOSE` Trades use `proposalId = null`.
- Each Position may have 1 BUY_TRIGGER order + 1 TAKE_PROFIT order + 1 STOP_LOSS order (and optionally 1 CLOSE_SWAP order).

---

## Asset Registry

Static TypeScript file at `packages/shared/src/constants.ts`. Manually maintained. New xStocks are added when they become available on Jupiter.

### Asset Structure

```typescript
interface AssetMeta {
  assetId: string; // Canonical ID used across all DB fields. e.g. "AAPLx", "SOL", "cbBTC"
  underlyingTicker: string; // Bare ticker for display context. e.g. "AAPL", "SOL"
  name: string; // "Apple", "Solana"
  mint: string; // SPL Token-2022 mint address
  decimals: number;
  pythFeedId: string; // 0x-prefixed 32-byte hex
  sector: string; // "Technology / Software"
  marketFocusTags: MarketFocusOption[]; // e.g. ["TECH_SOFTWARE"] or ["TOKENIZED_ETFS"]
  liquidityTier: 1 | 2 | 3 | 4;
  maxSuggestedTradeUsd: number; // Derived from liquidity. Tier 4 assets cap at ~$1K.
  logoUrl: string;
  description: string; // Company description, displayed on Position Detail
}
```

### Sector Taxonomy

Canonical asset metadata (including sector assignment and `marketFocusTags`) lives in the Asset Registry. Screen docs reference this taxonomy for display purposes only.

| MarketFocusOption  | Display Label         | Example Assets                                                                     |
| ------------------ | --------------------- | ---------------------------------------------------------------------------------- |
| TECH_SOFTWARE      | Technology / Software | AAPLx, MSFTx, GOOGLx, METAx, AMZNx, CRMx, ORCLx, PLTRx, AVGOx, CRCLx, ADBEx, SHOPx |
| SEMICONDUCTORS     | Semiconductors        | NVDAx, TSMx, AMDx, INTCx, AMATx, ASMLx, GEVx                                       |
| EV_CLEAN_ENERGY    | EV & Clean Energy     | TSLAx                                                                              |
| FINANCIALS_FINTECH | Financials / Fintech  | JPMx, GSx, HOODx, COINx, BACx, MAx, Vx, PYPLx, SQx                                 |
| HEALTHCARE_PHARMA  | Healthcare / Pharma   | LLYx, UNHx, ABTx, JNJx, MRKx, PFEx                                                 |
| CONSUMER_RETAIL    | Consumer / Retail     | MCDx, WMTx, NKEx, SBUXx                                                            |
| ENERGY_UTILITIES   | Energy / Utilities    | XLEx, XOPx, URAx                                                                   |
| CRYPTO_MINING      | Crypto Mining         | MSTRx, RIOTx, MARAx, CLSKx                                                         |
| INDUSTRIALS        | Industrials           | CATx, DELLx, BAx                                                                   |
| TOKENIZED_ETFS     | Tokenized ETFs        | SPYx, QQQx, IWMx, VTIx, IEMGx, VGKx, SMHx, URAx, SGOVx, XLEx                       |
| BLUECHIP_CRYPTO    | Bluechip Crypto       | SOL, cbBTC, wETH                                                                   |

Assets like SMHx and URAx may have multiple tags (e.g., SMHx: `["SEMICONDUCTORS", "TOKENIZED_ETFS"]`).

---

## Data Synchronization

### Portfolio State Assembly

The frontend assembles portfolio state client-side:

1. **Token balances**: Frontend calls Solana RPC (`getParsedTokenAccountsByOwner`) to read wallet token accounts
2. **Current prices**: Frontend calls Pyth Hermes REST API directly
3. **Entry prices and position metadata**: Read from PostgreSQL via REST API
4. **Assembly**: Client combines on-chain balances, live prices, and DB records into the portfolio view

### Portfolio Sync (On-chain / DB Reconciliation)

The Proposal Generator depends on accurate Position data in PostgreSQL. To keep the DB in sync with on-chain state:

1. **Frontend sync**: Every time the portfolio loads, the frontend compares Solana RPC balances against DB Positions. On detecting a mismatch, it calls `POST /api/portfolio/sync` to update the DB.

2. **Order fill sync**: The ws-server Order Tracker polls Jupiter every 30 seconds for all OPEN orders, detecting fills, expirations, and cancellations.

3. **External transfer detection**: If the frontend discovers a token in the wallet that has no corresponding DB Position, it creates a new Position using the current market price as the cost basis.

### Entry Price Tracking

All entry prices are stored in PostgreSQL (Position table).

| Scenario                                           | Entry Price Source                                       |
| -------------------------------------------------- | -------------------------------------------------------- |
| Trade via app                                      | Fill price from the BUY trigger order                    |
| Pre-existing holdings (tokens in wallet at signup) | Market price at the time the app first loads             |
| External transfer in                               | Market price at the time the app detects the new balance |
