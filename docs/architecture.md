# Hunch — Architecture

> System architecture, monorepo structure, tech stack, infrastructure, and realtime communication design.

---

## Monorepo Structure

```
hunch-it/
├── apps/
│   ├── web/           # Next.js 15 App Router (PWA frontend + REST API routes)
│   └── ws-server/     # Signal Engine (Express + Socket.IO, standalone process)
└── packages/
    ├── shared/        # Shared Zod schemas, asset registry, types, enums
    └── config/        # Shared tsconfig
```

**apps/web**: Next.js PWA frontend. Handles all user-facing UI and exposes REST API routes under `/api/*`.

**apps/ws-server**: Standalone Node.js backend. Responsible for market monitoring, proposal generation, WebSocket realtime push, back-evaluation, order tracking, and automatic TP/SL placement.

**packages/shared**: Zod schemas, asset registry (static TypeScript), and type definitions shared between both apps.

Both apps connect to the same PostgreSQL database (self-managed, running in Docker on the prod VM), each through its own Prisma client instance.

---

## System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    Frontend (apps/web)                        │
│                    Next.js 15 PWA                             │
│                                                              │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌───────────┐ │
│  │ Mandate  │  │    Home    │  │ Proposal │  │ Position  │ │
│  │  Setup   │→ │            │→ │  Detail  │  │  Detail   │ │
│  └──────────┘  └────────────┘  └──────────┘  └───────────┘ │
│                                                              │
│  REST API Routes (/api/*)                                    │
│  mandates | proposals | trades | orders | portfolio | bars   │
└──────┬──────────┬──────────┬──────────┬─────────────────────┘
       │          │          │          │
  Socket.IO   Jupiter     Privy     Solana     Pyth
  (realtime)  Trigger    (auth +    RPC     Benchmarks
       │    Order v2   wallet)  (balances)  (charts)
       │    + Swap
       │
┌──────┴──────────────────────────────────────────────────┐
│                ws-server (apps/ws-server)                 │
│                Signal Engine                             │
│                                                          │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────┐ │
│  │   Market     │  │   Proposal     │  │   Order      │ │
│  │   Scanner    │→ │   Generator    │  │   Tracker    │ │
│  │ (per ticker) │  │  (per user)    │  │ (cron 30s)   │ │
│  └──────────────┘  └────────────────┘  └──────────────┘ │
│         │                  │                   │         │
│    Pyth Hermes      Claude Sonnet/Opus    Jupiter API    │
│   (live prices)    (LLM analysis)       (order status)   │
│                                                          │
│  ┌──────────────┐  ┌────────────────┐                   │
│  │   Auto       │  │    Back-       │                   │
│  │   TP/SL      │  │   Evaluator    │                   │
│  │   Placer     │  │  (every 5min)  │                   │
│  └──────────────┘  └────────────────┘                   │
└─────────────────────────┬───────────────────────────────┘
                          │
                   ┌──────┴──────┐
                   │ VM Postgres │
                   │ (Docker)    │
                   │ via Prisma  │
                   └─────────────┘
```

---

## Tech Stack

| Layer                  | Tool                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Framework              | Next.js 15 (App Router)                                                                                              |
| UI Components          | shadcn/ui                                                                                                            |
| Styling                | Tailwind CSS v4                                                                                                      |
| Animation              | Magic UI + Motion (Framer Motion)                                                                                    |
| State Management       | Zustand (client state) + TanStack Query (server state)                                                               |
| Auth + Wallet          | Privy (email / Google / Apple / optional external wallet; embedded Solana wallet for in-app execution)               |
| Order Execution        | Jupiter Trigger Order API v2 (BUY, TP, SL) + Jupiter Swap API (Close Position)                                       |
| Price Data             | Pyth Hermes (live) + Pyth Benchmarks (historical candles)                                                            |
| Chart Rendering        | Lightweight Charts (TradingView open-source)                                                                         |
| On-chain Data          | Solana RPC (@solana/web3.js)                                                                                         |
| Realtime Communication | Socket.IO (server) + Shared Worker + BroadcastChannel (client)                                                       |
| Signal Engine LLM      | Claude Sonnet or Opus (@anthropic-ai/sdk)                                                                            |
| Technical Indicators   | technicalindicators library                                                                                          |
| Database               | PostgreSQL 15 (self-managed, in Docker on the prod VM)                                                               |
| ORM                    | Prisma                                                                                                               |
| Schema Validation      | Zod                                                                                                                  |
| Asset Registry         | Static TypeScript (packages/shared/src/constants.ts)                                                                 |
| PWA                    | manifest.json + Service Worker (offline fallback page only; all trading, pricing, and auth features require network) |

---

## Infrastructure (GCP)

| Component                      | Deployment                | Notes                                                   |
| ------------------------------ | ------------------------- | ------------------------------------------------------- |
| Frontend (apps/web)            | GCP VM + Docker           | Next.js container                                       |
| Signal Engine (apps/ws-server) | GCP VM + Docker           | Long-running Node.js process with WebSocket connections |
| Database                       | PostgreSQL 15 in Docker   | Single instance on the prod VM; apps connect via the docker-compose network |
| DNS                            | Cloud DNS                 | <app-domain>                                            |

Both apps/web and ws-server are packaged as Docker images, deployed on the same (or two separate) GCP VMs. Environment variables (API keys, DB credentials) are configured directly in Docker Compose or `.env` on the VM.

---

## Realtime Communication Architecture

The frontend uses a **Shared Worker** to manage the Socket.IO connection:

- The Shared Worker maintains a single WebSocket connection across all browser tabs
- BroadcastChannel distributes events to every tab
- When a new proposal arrives and the tab is in the background, the system uses the HTML5 `Notification` API to show an in-session desktop notification (this is a local browser notification, not a remote push notification; it only works while the app has an active tab or Shared Worker)
- This prevents multiple tabs from creating duplicate connections

**Socket.IO room model**: After connecting, the client sends an `auth` event with `{ privyAccessToken }`. The server verifies the token, resolves the user, and joins the socket to `user:{userId}`. All proposal pushes and trade notifications are emitted to that user's room only (not broadcast globally).

---

## Related Documents

For ws-server implementation, read alongside:

1. **signal-engine.md** — Signal pipeline, Order Tracker, Back-Evaluator
2. **data-model.md** — Prisma schema, enums, JSON field interfaces
3. **api-contract.md** — WebSocket events, order state transitions

For frontend implementation, read alongside:

1. **screens-and-flows.md** — Screen specs, user flows, error states
2. **api-contract.md** — REST endpoints with request/response contracts
3. **data-model.md** — Data model, Asset Registry structure

---

## Local Development

```bash
git clone <repo>
cd hunch-it
pnpm install
cp .env.example .env
# Edit .env with your keys

pnpm --filter @hunch-it/web exec prisma generate
pnpm db:push
pnpm dev   # Runs web + ws-server concurrently
```

**Demo Mode**: Set `DEMO_MODE=true` to run the full UX without any external API keys. The ws-server generates fake signals. By default, demo trades are persisted to PostgreSQL like real trades. Set `DEMO_IN_MEMORY=true` to skip DB persistence entirely.
