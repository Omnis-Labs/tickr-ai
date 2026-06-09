# Hunch It — Architecture

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

**apps/ws-server**: Standalone Node.js backend. Responsible for Base Market Analysis, proposal fan-out, WebSocket realtime push, back-evaluation, thesis monitoring, and synthetic trigger monitoring. Trigger monitoring is always on in the default runtime; proposal generation and evaluator jobs are env-gated.

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
│  │ Mandate  │  │ Home/Grill │  │ Proposal │  │ Position  │ │
│  │  Setup   │→ │   /Team    │→ │  Detail  │→ │  Detail   │ │
│  └──────────┘  └────────────┘  └──────────┘  └───────────┘ │
│                                                              │
│  REST API Routes (/api/*)                                    │
│  mandates | grill | proposals | trades | orders | portfolio │
└──────┬──────────┬──────────┬──────────┬─────────────────────┘
       │          │          │          │
  Socket.IO   Jupiter     Privy     Solana     Pyth
  (realtime)  Ultra      (auth +    RPC     Benchmarks
       │      /order    wallet)  (balances)  (charts)
       │      + /execute
       │
┌──────┴──────────────────────────────────────────────────┐
│                ws-server (apps/ws-server)                 │
│                Signal Engine                             │
│                                                          │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────┐ │
│  │   Market     │  │   Proposal     │  │  Trigger     │ │
│  │   Scanner    │→ │   Generator    │  │  Monitor     │ │
│  │ (per asset)  │  │  (per user)    │  │ (cron 30s)   │ │
│  └──────────────┘  └────────────────┘  └──────────────┘ │
│         │                  │                   │         │
│    Pyth Hermes          Gemini          Pyth Hermes      │
│   (live prices)    (LLM analysis)     (trigger marks)    │
│                                                          │
│  ┌──────────────┐  ┌────────────────┐                   │
│  │   Thesis     │  │    Back-       │                   │
│  │   Monitor    │  │   Evaluator    │                   │
│  │  (opt-in)    │  │  (opt-in)      │                   │
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
| Order Execution        | Synthetic DB trigger Orders + Jupiter Ultra sponsored swaps: user signs the taker slot, Jupiter `/execute` relays    |
| Price Data             | Pyth Hermes (live) + Pyth Benchmarks (historical candles)                                                            |
| Chart Rendering        | Lightweight Charts (TradingView open-source)                                                                         |
| On-chain Data          | Solana RPC (@solana/web3.js)                                                                                         |
| Realtime Communication | Socket.IO (server) + Shared Worker + BroadcastChannel (client)                                                       |
| Signal Engine LLM      | Gemini via `@google/genai`                                                                                           |
| Technical Indicators   | technicalindicators library                                                                                          |
| Database               | PostgreSQL 15 (self-managed, in Docker on the prod VM)                                                               |
| ORM                    | Prisma                                                                                                               |
| Schema Validation      | Zod                                                                                                                  |
| Asset Universe         | Static TypeScript whitelist (`packages/shared/src/assets.ts`) with derived signal eligibility and mandate matching   |
| PWA                    | manifest.json + Service Worker (offline fallback page only; all trading, pricing, and auth features require network) |

---

## Infrastructure (GCP)

| Component                      | Deployment              | Notes                                                                       |
| ------------------------------ | ----------------------- | --------------------------------------------------------------------------- |
| Frontend (apps/web)            | GCP VM + Docker         | Next.js container                                                           |
| Signal Engine (apps/ws-server) | GCP VM + Docker         | Long-running Node.js process with WebSocket connections                     |
| Database                       | PostgreSQL 15 in Docker | Single instance on the prod VM; apps connect via the docker-compose network |
| DNS                            | External A records      | Public app and websocket domains route to the reverse proxy                 |

Both apps/web and ws-server are packaged as Docker images and deployed on the same GCP VM. Environment variables (API keys, DB credentials) are configured in `/opt/hunchit/.env` on the VM.

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

1. **signal-engine.md** — Signal pipeline, ProposalCreation seam, Trigger Monitor, Back-Evaluator
2. **data-model.md** — Prisma schema, enums, JSON field interfaces
3. **api-contract.md** — WebSocket events, order state transitions
4. **adr/0002-canonical-asset-signal-data.md** — Asset id and signal freshness rules

For frontend implementation, read alongside:

1. **screens-and-flows.md** — Screen specs, user flows, error states
2. **api-contract.md** — REST endpoints with request/response contracts
3. **data-model.md** — Data model, Asset Universe and ProposalCreation structure
4. **narrative.md** — Canonical public narrative wording

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

**Dev Tools**: Set `ENABLE_DEV_TOOLS=true` locally and open `/dev-tools` to create real `[DEV_TOOLS]` proposals through the same ProposalCreation Module used by live signal generation, persist real DB orders, force owned synthetic triggers, and execute the same Jupiter Ultra swap path used by production. The in-browser log is intentionally content-rich and is the source of truth for swap diagnostics; client diagnostic events stay in the browser. Deployed production runtimes block this surface.
