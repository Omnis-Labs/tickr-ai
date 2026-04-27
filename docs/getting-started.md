# Getting Started with Hunch It

This guide helps you run Hunch It locally. Start with demo mode if you only want to understand the product flow; use live setup when you are ready to connect real services.

---

## Prerequisites

- Node.js >= 20
- pnpm >= 9 (`corepack enable` is recommended)
- Git

For live trading flows you also need a Solana RPC URL, Privy app, Anthropic key, PostgreSQL database, and enough USDC/SOL to test safely.

---

## Demo Mode

Demo mode is for local exploration. It should let you try the main experience without placing real trades.

### Quick Start

```bash
git clone https://github.com/Omnis-Labs/hunch-it.git
cd hunch-it
pnpm install
cp .env.example .env
```

Edit `.env`:

```bash
DEMO_MODE=true
NEXT_PUBLIC_DEMO_MODE=true
```

Then start the app:

```bash
cp .env apps/web/.env.local
cp .env apps/ws-server/.env
pnpm db:generate
pnpm dev
```

Open http://localhost:3000.

### Demo Flow

1. Open the app.
2. Complete or bypass login according to the current demo configuration.
3. Create an investment mandate: holding period, max drawdown, max trade size, and market focus.
4. Review a demo BUY proposal.
5. Adjust size, trigger price, TP, or SL if needed.
6. Place the demo order and inspect the resulting order / position state.

Demo mode is meant to show the product shape: mandate setup, proposal review, portfolio state, order states, and automatic TP/SL behavior. It should not be treated as evidence of live execution.

---

## Live Setup

Live setup connects the app to real services. Use small amounts first.

### 1. Clone and Install

```bash
git clone https://github.com/Omnis-Labs/hunch-it.git
cd hunch-it
corepack enable
pnpm install
cp .env.example .env
```

### 2. Configure Environment Variables

Fill in the root `.env` file, then copy it to both apps.

| Variable                       | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| `NEXT_PUBLIC_SOLANA_RPC_URLS`  | Solana RPC endpoints (comma-separated for failover)  |
| `NEXT_PUBLIC_PRIVY_APP_ID`     | Privy app ID for auth and embedded wallet            |
| `NEXT_PUBLIC_JUPITER_API_BASE` | Jupiter API base URL                                 |
| `PYTH_HERMES_URL`              | Live Pyth price endpoint                             |
| `PYTH_BENCHMARKS_URL`          | Historical candle endpoint                           |
| `ANTHROPIC_API_KEY`            | LLM analysis for the Signal Engine                   |
| `LLM_DAILY_USD_CAP`            | Daily LLM spend guardrail                            |
| `DATABASE_URL`                 | PostgreSQL connection string                         |
| `NEXT_PUBLIC_WS_URL`           | Local ws-server URL, usually `http://localhost:4000` |
| `WS_CRON_SECRET`               | Shared secret for protected server tasks             |

```bash
cp .env apps/web/.env.local
cp .env apps/ws-server/.env
```

The current architecture uses PostgreSQL as the durable store. Redis is not required for the v1 product scope described in [product-overview.md](./product-overview.md).

### 3. Prepare the Database

```bash
pnpm db:generate
pnpm db:push
```

Optional:

```bash
pnpm db:studio
```

### 4. Run Locally

```bash
pnpm dev
```

Local URLs:

- Web UI: http://localhost:3000
- WebSocket server: http://localhost:4000

### 5. Try the Product Flow

1. Log in with Privy.
2. Confirm the embedded Solana wallet address.
3. Create your mandate.
4. Deposit USDC and a small amount of SOL for transaction fees.
5. Wait for the Signal Engine to generate a BUY proposal.
6. Review the proposal and place a Jupiter Trigger Order.
7. When the BUY fills, verify TP/SL orders appear and the position becomes active.

---

## Useful Commands

| Command                                   | What it does                            |
| ----------------------------------------- | --------------------------------------- |
| `pnpm dev`                                | Run web and ws-server concurrently      |
| `pnpm dev:web`                            | Run the frontend only                   |
| `pnpm dev:ws`                             | Run the ws-server only                  |
| `pnpm build`                              | Build all workspaces                    |
| `pnpm typecheck`                          | Run TypeScript checks in all workspaces |
| `pnpm db:generate`                        | Generate Prisma client                  |
| `pnpm db:push`                            | Push Prisma schema to the database      |
| `pnpm db:studio`                          | Open Prisma Studio                      |
| `pnpm --filter @hunch-it/ws-server smoke` | Run the ws-server smoke probe           |

---

## Where to Read Next

- [Product Overview](./product-overview.md) — what Hunch is trying to prove
- [Screens & Flows](./screens-and-flows.md) — the user-facing product flow
- [Architecture](./architecture.md) — how the apps and services fit together
- [Troubleshooting](./troubleshooting.md) — common local setup issues
