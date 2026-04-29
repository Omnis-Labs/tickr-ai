# Hunch It

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

Mandate-driven AI trading proposals for tokenized stocks & crypto on Solana.

Users define a simple investment mandate, receive AI-assisted BUY proposals for tokenized stocks, tokenized ETFs, and bluechip crypto, then execute those proposals through Jupiter Trigger Orders. After a BUY fills, Hunch automatically places take-profit and stop-loss orders so every position has an exit plan.

> Hunch It is experimental software and not financial advice. Use demo mode first, and only use real funds if you understand the risks.

## What It Does

- Turns market movement into clear BUY proposals tailored to a user's mandate and portfolio
- Explains each proposal with: what changed, why this trade, and why it fits the mandate
- Lets users adjust size, trigger price, take-profit, and stop-loss before placing an order
- Tracks BUY orders, active positions, open TP/SL orders, and portfolio state
- Uses automatic TP/SL placement after entry, with one-cancels-other behavior when an exit fills

## How It Works

```text
Login → Mandate setup → Home → Review BUY proposal → Place Jupiter Trigger Order
  → BUY fills → TP/SL auto-protected → Adjust TP/SL or close the position
```

The app is built around proposals, not a manual trading terminal. Trades start from BUY proposals; exits happen through take-profit, stop-loss, or user-initiated full close.

## Current Scope

- **Base currency:** USDC on Solana
- **Supported assets:** Jupiter-listed xStocks, tokenized ETFs, SOL, BTC, and ETH representations on Solana
- **Wallet:** Privy auth with embedded Solana wallet support
- **Execution:** Jupiter Trigger Order API v2 for BUY / TP / SL, Jupiter Swap API for full position close
- **Data:** Pyth live and historical prices, PostgreSQL via Prisma
- **Signal engine:** standalone `ws-server` process using indicators plus an LLM for base market analysis

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
cp .env apps/web/.env.local
cp .env apps/ws-server/.env
pnpm db:push      # push the Prisma schema to the (still empty) docker postgres volume
```

> **Want to click around without external services?** Set `DEMO_MODE=true` and `NEXT_PUBLIC_DEMO_MODE=true` in `.env` (and re-copy to the two app env files). Demo mode generates fake signals and never places real trades. See [docs/getting-started.md](docs/getting-started.md#demo-mode) for the full demo walkthrough.

### Run — pick one

**A. Full Docker** — runs web + ws-server + postgres as containers. Best for an end-to-end smoke test. Slow first build (~10 min cold), fast after that.

```bash
docker compose up --build -d
docker compose down            # to stop
```

**B. `pnpm dev` with hot reload** *(recommended for coding)* — postgres runs in Docker, apps run on the host with hot reload. `pnpm dev` boots your container runtime, brings postgres up, and runs `prisma generate` for you.

```bash
pnpm dev                       # auto-starts OrbStack/Docker → postgres → prisma generate → web + ws-server
# Stop: Ctrl+C, then `pnpm db:down` if you also want to stop postgres
```

`pnpm dev` prefers OrbStack (`orb start`) on macOS and falls back to Docker Desktop if OrbStack isn't installed. On Linux it expects the docker daemon to already be running.

### Open

- Web UI: http://localhost:3000
- ws-server: http://localhost:4000 (`/healthz` for a liveness check)

For the full env reference, live trading setup, and the demo walkthrough, see [docs/getting-started.md](docs/getting-started.md). If something breaks, see [docs/troubleshooting.md](docs/troubleshooting.md).

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
| `pnpm dev`               | Auto-start docker postgres, generate Prisma client, run web + ws-server  |
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
| [Product Overview](docs/product-overview.md) | Product promise, scope, supported assets                             |
| [Getting Started](docs/getting-started.md)   | Demo mode, live setup, local development commands                    |
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
