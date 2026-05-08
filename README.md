# Hunch It

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

Mandate-driven AI trading proposals for tokenized stocks & crypto on Solana.

Users define a simple investment mandate, receive AI-assisted BUY proposals for xStocks, tokenized ETFs, and crypto assets, and **tap to execute** when the price reaches the trigger. The server-side `PositionLifecycle` module owns every state transition, automatically arms take-profit and stop-loss orders after entry, and runs the OCO close + sibling cancellation when an exit fires.

> The execution model is **synthetic-trigger / tap-to-execute** (ADR-0001). xStocks (Backed Finance Token-2022 mints) are not on Jupiter Trigger Order v2's allowlist, so triggers are tracked as DB rows watched by `apps/ws-server` against Pyth, and the user signs a Jupiter Ultra swap via Privy at fire time. Trigger Order v2 is **not** used.

> Hunch It is experimental software and not financial advice. Use small real-fund test amounts only if you understand the risks.

## What It Does

- Turns market movement into clear BUY proposals tailored to a user's mandate and portfolio
- Explains each proposal with: what changed, why this trade, and why it fits the mandate
- Lets users adjust size, trigger price, take-profit, and stop-loss before placing an order
- Tracks BUY orders, active positions, open TP/SL orders, and portfolio state
- Uses automatic TP/SL placement after entry, with one-cancels-other behavior when an exit fills

## How It Works

```text
Login → Mandate setup → Desk → Review BUY proposal → Approve (DB-only Order)
  → ws-server detects price hit → toast → tap Execute (Jupiter Ultra swap)
  → Position ACTIVE + TP/SL Orders armed atomically
  → Either tap to fire TP/SL, or tap Close to exit; sibling exit Order
    cancelled in the same transaction; realized P&L recorded.
```

The app is built around proposals, not a manual trading terminal. All trade-state transitions go through `packages/db/src/lifecycle/position-lifecycle.ts` so race conditions and partial fills can't leak. See `docs/adr/0001-frozen-synthetic-trigger-architecture.md` and `docs/manual-test-core.md` for the architecture freeze and the 10-step click-through DoD.

## Current Scope

- **Base currency:** USDC on Solana
- **Supported assets:** Jupiter-listed xStocks/tokenized ETFs plus `wBTC`, `ETH`, `BNB`, `wXRP`, `TRX`, and `HYPE`; `SOL` is treated as wallet fee balance, not a proposal asset
- **Wallet:** Privy auth with embedded Solana wallet support
- **Execution:** synthetic-trigger Orders (DB-only) + Jupiter Ultra swap signed client-side via Privy when the user taps Execute. The server-side `PositionLifecycle` settles every fill atomically and uses `Order.txSignature @unique` for idempotent replay.
- **Data:** Pyth live prices (ws-server poll loop) + Pyth historical bars, PostgreSQL via Prisma
- **Signal engine:** standalone `ws-server` process. Default runtime starts only the `trigger-monitor` task; `ENABLE_BACK_EVAL`, `ENABLE_JUPITER_ORDER_TRACKER`, `ENABLE_THESIS_MONITOR`, `ENABLE_SIGNAL_LOOP` are opt-in.

See [docs/product-overview.md](docs/product-overview.md) for the full product scope.

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

> **Need deterministic local testing?** Set `ENABLE_DEV_TOOLS=true`, run web + ws-server, then open `/dev-tools`. The page is password-gated, creates real `[DEV_TOOLS]` proposals, persists real DB orders, and can force synthetic `trigger:hit` events for owned dev orders.

### Run — pick one

**A. Full Docker** — runs web + ws-server + postgres as containers. Best for an end-to-end smoke test. Slow first build (~10 min cold), fast after that.

```bash
docker compose up --build -d
docker compose down            # to stop
```

**B. `pnpm dev` with hot reload** *(recommended for coding)* — postgres runs in Docker, apps run on the host with hot reload. `pnpm dev` boots your container runtime, brings postgres up, and runs `prisma generate` for you.

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
│   └── ws-server/     # Signal Engine, Socket.IO, order tracking, auto TP/SL
└── packages/
    ├── shared/        # Zod schemas, asset registry, shared types
    └── config/        # Shared TypeScript config
```

## Scripts

| Command                  | Description                                                              |
| ------------------------ | ------------------------------------------------------------------------ |
| `pnpm dev`               | Sync root `.env`, auto-start docker postgres, generate Prisma client, run web + ws-server |
| `pnpm dev:no-db`         | Same as `pnpm dev` but skip the postgres preflight (manage db yourself)  |
| `pnpm dev:web`           | Run the Next.js app only                                                 |
| `pnpm dev:ws`            | Run the ws-server only                                                   |
| `pnpm build`             | Build all workspaces                                                     |
| `pnpm typecheck`         | Type-check all workspaces                                                |
| `pnpm db:up`             | Run the postgres preflight only (start container, wait healthy)          |
| `pnpm db:down`           | `docker compose down` — stop postgres (and any compose services up)      |
| `pnpm db:generate`       | Generate the Prisma client                                               |
| `pnpm db:push`           | Push the Prisma schema to the database                                   |
| `pnpm db:migrate`        | `prisma migrate dev` (interactive, creates a new migration)              |
| `pnpm db:migrate:deploy` | `prisma migrate deploy` (apply existing migrations, for prod-like flows) |
| `pnpm db:studio`         | Open Prisma Studio                                                       |

## Documentation

| Doc                                          | What it covers                                                       |
| -------------------------------------------- | -------------------------------------------------------------------- |
| [ADR-0001](docs/adr/0001-frozen-synthetic-trigger-architecture.md) | Architecture freeze: synthetic-trigger / tap-to-execute model        |
| [CONTEXT.md](CONTEXT.md)                     | Domain glossary used by reviews + future ADRs                        |
| [Manual test core](docs/manual-test-core.md) | 10-step click-through that defines "the system works"                |
| [Product Overview](docs/product-overview.md) | Product promise, scope, supported assets (pre-freeze; see ADR-0001)  |
| [Getting Started](docs/getting-started.md)   | Local setup, `/dev-tools`, live setup, development commands          |
| [Architecture](docs/architecture.md)         | Monorepo layout, infrastructure, realtime design                     |
| [Screens & Flows](docs/screens-and-flows.md) | Main screens, user flows, state and error handling                   |
| [Signal Engine](docs/signal-engine.md)       | Market scanner, proposal generation, order tracking, back-evaluation |
| [API Contract](docs/api-contract.md)         | REST endpoints, WebSocket events, Jupiter order flows                |
| [Data Model](docs/data-model.md)             | Prisma models, enums, JSON fields, asset registry                    |
| [Troubleshooting](docs/troubleshooting.md)   | Common local setup and runtime issues                                |

## Contributing

This is an early project, so contributions are intentionally lightweight: keep changes focused, match the existing style, and update docs when behavior changes.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the basics.

## License

[AGPL-3.0](LICENSE)
