# Hunch It

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

Gen Z already invests by vibe. Hunch It turns each vibe trade into a disciplined proposal.

Hunch It helps Gen Z investors turn trade ideas from friends, creators, social feeds, or market moves into disciplined trade proposals using AI analysts they choose for their style.

> Hunch It is experimental software and not financial advice. Use small real-fund test amounts only if you understand the risks.

## Product Narrative

Hunch It works in two ways:

1. Users can bring trade ideas from friends, creators, or social feeds and have them vetted by AI analysts they choose.
2. Users can choose AI analysts that watch the market and send new proposals.

Both paths end in one disciplined proposal the user controls.

## What It Does

- Lets users choose an AI Trading Team of up to six AI Analysts
- Vets user-supplied trade ideas in Grill and can turn them into one BUY proposal
- Watches supported markets for new BUY proposals when the signal loop is enabled
- Explains each proposal with thesis, timing, entry/trigger, sizing, TP/SL, and invalidation
- Lets users adjust size, trigger price, take-profit, and stop-loss before placing an order
- Tracks BUY orders, active positions, open TP/SL orders, and portfolio state
- Uses automatic TP/SL placement after entry, with one-cancels-other behavior when an exit fills
- Offers optional Auto-execute triggers through Privy wallet v2 signer access, which remains non-custodial and revocable from Settings

## Current Status

Hunch It is an alpha PWA. The signed-in app currently has Home, Grill, Team, Portfolio, Position Detail, Proposal Detail, Settings, Withdraw, and a password-gated `/dev-tools` surface.

The current product has two proposal sources:

- **Grill proposals:** users bring a supported asset and a trade idea from a friend, creator, social feed, or market move. The selected AI Trading Team returns visible Analyst Opinions, then Hunch It can create one disciplined BUY proposal from the completed review.
- **Market-watch proposals:** `apps/ws-server` can scan supported assets, build Base Market Analysis, and fan out BUY proposals to users. This path is opt-in through `ENABLE_SIGNAL_LOOP=true`; trigger monitoring stays on by default.

Mandate setup is still required before the signed-in app is ready. In the current implementation, the Mandate provides sizing, max drawdown, holding-period, and market-focus constraints; the AI Trading Team lives alongside it as a user preference.

## Execution Model

The execution model is **synthetic-trigger first**. Approving a BUY proposal writes DB-only synthetic Orders; `apps/ws-server` watches Pyth as a wake-up band, then confirms triggerability with a fresh Jupiter Ultra executable quote. If the user's Privy wallet is delegated, ws-server executes the same Jupiter Ultra swap and emits `trade:filled` (ADR-0003). Otherwise it emits `trigger:hit` and the user signs after tapping Execute (ADR-0001). No external trigger API is part of the runtime.

```text
Login → Mandate setup → Team selection or default team → Desk / Grill
  → Review BUY proposal → Approve (DB-only Order)
  → ws-server detects executable trigger
    → delegated path: Auto-execute triggers fills through Jupiter Ultra → trade:filled
    → fallback path: toast → tap Execute (Jupiter Ultra swap)
  → Position ACTIVE + TP/SL Orders armed atomically
  → Either auto-execute/tap TP/SL, or tap Close to exit; sibling exit Order
    cancelled in the same transaction; realized P&L recorded.
```

The app is built around proposals, not a manual trading terminal. All trade-state transitions go through `packages/db/src/lifecycle/position-lifecycle.ts` so race conditions and partial fills can't leak. See `docs/adr/0001-frozen-synthetic-trigger-architecture.md`, `docs/adr/0003-opt-in-delegated-execution.md`, and `docs/manual-test-core.md` for the execution model and click-through DoD.

## Current Scope

- **Base currency:** USDC on Solana
- **Supported proposal assets:** `AAPLx`, `NVDAx`, `TSLAx`, `SPYx`, `QQQx`, `GOOGLx`, `METAx`, `wBTC`, `ETH`, `BNB`, `wXRP`, `TRX`, and `HYPE`; `SOL` is treated as wallet fee balance, not a proposal asset
- **Wallet:** Privy auth with embedded Solana wallet support
- **Execution:** synthetic-trigger Orders (DB-only) + Jupiter Ultra swap. Trigger fills are client-signed when the user taps Execute, or server-signed through opt-in Privy wallet v2 signer access when Auto-execute triggers is enabled. The shared `@hunch-it/execution` package owns delegated trigger execution; the server-side `PositionLifecycle` settles every fill atomically and uses `Order.txSignature @unique` for idempotent replay.
- **Data:** Pyth live prices (ws-server poll loop) + Pyth historical bars, PostgreSQL via Prisma
- **AI Analysts:** Team selection currently persists in browser local storage; Grill uses the selected analysts and falls back to the default team when none is provided.
- **Signal engine:** standalone `ws-server` process. Default runtime starts the required `trigger-monitor`; `ENABLE_SIGNAL_LOOP`, `ENABLE_BACK_EVAL`, and `ENABLE_THESIS_MONITOR` are opt-in.

See [docs/product-overview.md](docs/product-overview.md) for the full product scope and [docs/narrative.md](docs/narrative.md) for the canonical public narrative.

## Quick Start

### Prerequisites

- **Node.js ≥ 20** and **pnpm ≥ 9** (`corepack enable` recommended)
- A container runtime — **[OrbStack](https://orbstack.dev) is recommended on macOS** (lighter, faster boot than Docker Desktop). Docker Desktop, Colima, or any Docker-compatible engine also works.
  ```bash
  brew install orbstack   # one-line install on macOS
  ```

### Setup (once)

```bash
git clone https://github.com/Omnis-Labs/hunch-it.git
cd hunch-it
corepack enable
pnpm install
cp .env.example .env
pnpm db:push      # push the Prisma schema to the (still empty) docker postgres volume
```

Edit only the root `.env`; `pnpm dev` and `pnpm start` sync it into `apps/web/.env` and `apps/ws-server/.env` before booting.

> **Need deterministic local testing?** Set `ENABLE_DEV_TOOLS=true`, run web + ws-server, then open `/dev-tools`. The page is password-gated, creates real `[DEV_TOOLS]` proposals, persists real DB orders, can force synthetic trigger behavior for owned dev orders, and includes delegated Ultra swap diagnostics.

### Run — pick one

**A. Full Docker** — runs web + ws-server + postgres as containers. Best for an end-to-end smoke test. Slow first build (~10 min cold), fast after that.

```bash
docker compose up --build -d
docker compose down            # to stop
```

**B. `pnpm dev` with hot reload** _(recommended for coding)_ — postgres runs in Docker, apps run on the host with hot reload. `pnpm dev` boots your container runtime, brings postgres up, and runs `prisma generate` for you.

```bash
pnpm dev                       # syncs .env → auto-starts OrbStack/Docker → postgres → prisma generate → web + ws-server
# Stop: Ctrl+C, then `pnpm db:down` if you also want to stop postgres
```

`pnpm dev` prefers OrbStack (`orb start`) on macOS and falls back to Docker Desktop if OrbStack isn't installed. On Linux it expects the docker daemon to already be running.

### Open

- Web UI: http://localhost:3000
- ws-server: http://localhost:4000 (`/healthz` for a liveness check)

For the full env reference, live trading setup, and `/dev-tools` testing flow, see [docs/getting-started.md](docs/getting-started.md). If something breaks, see [docs/troubleshooting.md](docs/troubleshooting.md).

## Repo Structure

```text
hunch-it/
├── apps/
│   ├── web/           # Next.js 15 PWA frontend + REST API routes
│   └── ws-server/     # Signal Engine, Socket.IO, synthetic order monitoring
└── packages/
    ├── shared/        # Zod schemas, asset registry, shared types
    └── config/        # Shared TypeScript config
```

## Scripts

| Command                  | Description                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `pnpm dev`               | Sync root `.env`, auto-start docker postgres, generate Prisma client, run web + ws-server  |
| `pnpm dev:no-db`         | Same as `pnpm dev` but skip the postgres preflight (manage db yourself)                    |
| `pnpm dev:web`           | Run the Next.js app only                                                                   |
| `pnpm dev:ws`            | Run the ws-server only                                                                     |
| `pnpm build`             | Build all workspaces                                                                       |
| `pnpm typecheck`         | Type-check all workspaces                                                                  |
| `pnpm db:up`             | Sync local env files, then run the postgres preflight only (start container, wait healthy) |
| `pnpm db:down`           | `docker compose down` — stop postgres (and any compose services up)                        |
| `pnpm db:generate`       | Generate the Prisma client                                                                 |
| `pnpm db:push`           | Push the Prisma schema to the database                                                     |
| `pnpm db:migrate`        | `prisma migrate dev` (interactive, creates a new migration)                                |
| `pnpm db:migrate:deploy` | `prisma migrate deploy` (apply existing migrations, for prod-like flows)                   |
| `pnpm db:studio`         | Open Prisma Studio                                                                         |

## Documentation

| Doc                                                                | What it covers                                                              |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [ADR-0001](docs/adr/0001-frozen-synthetic-trigger-architecture.md) | Architecture freeze: synthetic-trigger / tap-to-execute fallback model      |
| [ADR-0002](docs/adr/0002-canonical-asset-signal-data.md)           | Canonical asset ids, xStock/crypto signal data, freshness rule              |
| [ADR-0003](docs/adr/0003-opt-in-delegated-execution.md)            | Opt-in Auto-execute triggers through Privy wallet v2 signer access          |
| [CONTEXT.md](CONTEXT.md)                                           | Domain glossary used by reviews + future ADRs                               |
| [Manual test core](docs/manual-test-core.md)                       | 10-step click-through that defines "the system works"                       |
| [Narrative](docs/narrative.md)                                     | Canonical public product narrative                                          |
| [Product Overview](docs/product-overview.md)                       | Product promise, scope, supported assets                                    |
| [Getting Started](docs/getting-started.md)                         | Local setup, `/dev-tools`, live setup, development commands                 |
| [Architecture](docs/architecture.md)                               | Monorepo layout, infrastructure, realtime design                            |
| [Screens & Flows](docs/screens-and-flows.md)                       | Main screens, user flows, state and error handling                          |
| [Signal Engine](docs/signal-engine.md)                             | Base market analysis, proposal fan-out, trigger monitoring, back-evaluation |
| [API Contract](docs/api-contract.md)                               | REST endpoints, WebSocket events, Jupiter Ultra swap flows                  |
| [Data Model](docs/data-model.md)                                   | Prisma models, enums, JSON fields, asset registry                           |
| [Troubleshooting](docs/troubleshooting.md)                         | Common local setup and runtime issues                                       |

## Contributing

This is an early project, so contributions are intentionally lightweight: keep changes focused, match the existing style, and update docs when behavior changes.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the basics.

## License

[AGPL-3.0](LICENSE)
