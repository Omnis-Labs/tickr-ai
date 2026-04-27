# Hunch It

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

AI trading signals with one-tap execution for tokenized stocks & crypto on Solana.

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

The app is built around proposals, not a manual trading terminal. In v1, trades start from BUY proposals; exits happen through take-profit, stop-loss, or user-initiated full close.

## Current Scope

- **Base currency:** USDC on Solana
- **Supported assets:** Jupiter-listed xStocks, tokenized ETFs, SOL, BTC, and ETH representations on Solana
- **Wallet:** Privy auth with embedded Solana wallet support
- **Execution:** Jupiter Trigger Order API v2 for BUY / TP / SL, Jupiter Swap API for full position close
- **Data:** Pyth live and historical prices, PostgreSQL via Prisma
- **Signal engine:** standalone `ws-server` process using indicators plus an LLM for base market analysis

See [docs/product-overview.md](docs/product-overview.md) for the product scope and MWP checklist.

## Quick Start (Demo)

Demo mode is the easiest way to try the local experience before wiring external services.

```bash
git clone https://github.com/Omnis-Labs/hunch-it.git
cd hunch-it
pnpm install
cp .env.example .env
```

Edit `.env` and set:

```bash
DEMO_MODE=true
NEXT_PUBLIC_DEMO_MODE=true
```

Then run:

```bash
cp .env apps/web/.env.local
cp .env apps/ws-server/.env
pnpm db:generate
pnpm dev
```

Open http://localhost:3000, complete mandate setup, and use the demo proposal flow. Demo mode does not place real trades.

For live setup, see [docs/getting-started.md](docs/getting-started.md).

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

| Command            | Description                            |
| ------------------ | -------------------------------------- |
| `pnpm dev`         | Run web + ws-server concurrently       |
| `pnpm dev:web`     | Run the Next.js app only               |
| `pnpm dev:ws`      | Run the ws-server only                 |
| `pnpm build`       | Build all workspaces                   |
| `pnpm typecheck`   | Type-check all workspaces              |
| `pnpm db:generate` | Generate the Prisma client             |
| `pnpm db:push`     | Push the Prisma schema to the database |
| `pnpm db:studio`   | Open Prisma Studio                     |

## Documentation

| Doc                                          | What it covers                                                       |
| -------------------------------------------- | -------------------------------------------------------------------- |
| [Product Overview](docs/product-overview.md) | Product promise, scope, supported assets, MWP checklist              |
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
