# Getting Started with Hunch It

This guide walks you from a fresh clone to a running local instance. If you only want to see the product flow without wiring real services, follow [Demo Mode](#demo-mode); when you're ready to use real wallets and live data, switch to [Live Mode](#live-mode).

---

## Prerequisites

- **Node.js ≥ 20** (`corepack enable` recommended so pnpm matches the lockfile)
- **pnpm ≥ 9**
- **A container runtime** with the `docker` CLI and `docker compose` plugin, used by the bundled PostgreSQL container.
  - **macOS (recommended): [OrbStack](https://orbstack.dev)** — `brew install orbstack`. Boots in ~1s, much smaller footprint than Docker Desktop, ships docker + compose out of the box.
  - **Docker Desktop, Colima, Podman (with `docker` alias), Linux native docker engine** — all work the same way.
- Git

`pnpm dev` will start the daemon for you on macOS — `orb start` if OrbStack is installed, otherwise `open -a Docker`. On Linux it expects the docker daemon to already be running. If neither is reachable, it prints a hint and exits.

For live trading flows you also need a Solana RPC URL, Privy app, Anthropic key, and enough USDC/SOL to test safely. The local PostgreSQL is provided by `docker-compose.yml`; you do not have to install Postgres on the host.

---

## Setup (do this once)

```bash
git clone https://github.com/Omnis-Labs/hunch-it.git
cd hunch-it
corepack enable          # so pnpm resolves to the version pinned in package.json
pnpm install
cp .env.example .env
cp .env apps/web/.env.local
cp .env apps/ws-server/.env
pnpm db:push             # push the Prisma schema to the (still-empty) postgres volume
```

`pnpm db:push` brings up the docker postgres on demand, so this is also the moment your container runtime needs to be installed and reachable. After this, your repo is wired and you can pick how you want to run the apps.

---

## Two Ways to Run It

| Mode                                       | When to use                                            | Hot reload | First start |
| ------------------------------------------ | ------------------------------------------------------ | ---------- | ----------- |
| **A. Full Docker** (`docker compose up`)   | Smoke test the whole stack end-to-end                  | No         | Slow (image build, ~10–15 min cold) |
| **B. Hybrid** (`pnpm dev`)                 | Day-to-day coding                                      | Yes        | Fast (~30s + Next cold compile) |

Both modes use the same `docker-compose.yml`, so the `hunch-pgdata` volume is shared — switching does not wipe your data.

### A. Full Docker (one command)

Builds web + ws-server images and runs all three services as containers.

```bash
docker compose up --build -d           # build images, start postgres + ws-server + web
docker compose logs -f web ws-server   # tail logs (optional)
docker compose down                    # stop everything (volumes kept)
```

The first build pulls Node 20 alpine, installs the workspace, runs `prisma generate`, then `next build` — expect ~10–15 minutes on a cold machine, dominated by `next build`. Subsequent runs reuse the BuildKit cache and start in seconds.

### B. Hybrid: postgres in Docker, apps via `pnpm dev` (recommended)

```bash
pnpm dev
# Stop: Ctrl+C, then if you also want to stop postgres:
pnpm db:down
```

`pnpm dev` runs `scripts/dev-up.sh` first, which:

1. Verifies the docker daemon is reachable. If it isn't, on macOS it tries `orb start` (OrbStack) first and falls back to launching Docker Desktop.
2. Starts the `hunch-postgres` container if it isn't already running.
3. Waits for the container's healthcheck to report `healthy` (max 60s).
4. Runs `prisma generate` so the Prisma client matches `schema.prisma`.

Then it starts web (Next.js dev) and ws-server (`tsx watch`) in parallel. The first request to `/` triggers Next's cold compile (~60–90s); after that, edits hot-reload in under a second.

If you want to manage Postgres yourself (e.g. you already have a local Postgres, or you're proxying a managed Postgres), use `pnpm dev:no-db` to skip the preflight.

> **First-run heads-up:** if you skip `pnpm db:push` (or you wipe the `hunch-pgdata` volume — `docker compose down -v` — or you switch between Docker Desktop and OrbStack which keep separate volume stores), the Prisma schema is gone. Run `pnpm db:push` before `pnpm dev`. Otherwise ws-server will log `P2021 The table public.User does not exist` on the first websocket connection.

Local URLs (both modes):

- Web UI: http://localhost:3000
- WebSocket server: http://localhost:4000 (`/healthz` returns `{"ok": true}`)

---

## Demo Mode

Demo mode lets you click through the product without external credentials or real funds. It uses fake signals, bypasses wallet auth, and never places real trades.

In `.env` (and your two copies in `apps/web/.env.local`, `apps/ws-server/.env`), set:

```bash
DEMO_MODE=true
NEXT_PUBLIC_DEMO_MODE=true
```

Restart the apps (`docker compose down && docker compose up -d` for Method A, or `Ctrl+C` then `pnpm dev` again for Method B). Open http://localhost:3000.

Walkthrough:

1. Open the app.
2. Complete or bypass login according to the current demo configuration.
3. Create an investment mandate: holding period, max drawdown, max trade size, and market focus.
4. Review a demo BUY proposal.
5. Adjust size, trigger price, TP, or SL if needed.
6. Place the demo order and inspect the resulting order / position state.

Demo mode shows the product shape (mandate setup, proposal review, portfolio state, order states, automatic TP/SL behavior). It is not evidence of live execution.

---

## Live Mode

Live mode connects the app to real services. **Use small amounts first.**

### Configure live env vars

Fill in the root `.env` file, then re-copy it to both apps (`cp .env apps/web/.env.local && cp .env apps/ws-server/.env`). The variables that matter for live mode:

| Variable                       | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| `NEXT_PUBLIC_SOLANA_RPC_URLS`  | Solana RPC endpoints (comma-separated for failover)  |
| `NEXT_PUBLIC_PRIVY_APP_ID`     | Privy app ID for auth and embedded wallet            |
| `PRIVY_APP_ID`                 | Same Privy app ID, server-side                       |
| `PRIVY_APP_SECRET`             | Privy server SDK secret (verifies tokens)            |
| `NEXT_PUBLIC_JUPITER_API_BASE` | Jupiter API base URL                                 |
| `PYTH_HERMES_URL`              | Live Pyth price endpoint                             |
| `PYTH_BENCHMARKS_URL`          | Historical candle endpoint                           |
| `ANTHROPIC_API_KEY`            | LLM analysis for the Signal Engine                   |
| `LLM_DAILY_USD_CAP`            | Daily LLM spend guardrail                            |
| `DATABASE_URL`                 | PostgreSQL connection string (defaults to the docker-compose postgres at `postgresql://hunch:hunch@localhost:5432/hunchit`) |
| `NEXT_PUBLIC_WS_URL`           | Public ws-server URL for the browser, usually `http://localhost:4000` |

Make sure `DEMO_MODE` and `NEXT_PUBLIC_DEMO_MODE` are **not** set to `true`.

### Run

```bash
pnpm dev          # or `docker compose up --build -d` if you prefer Method A
```

### Walkthrough

1. Log in with Privy.
2. Confirm the embedded Solana wallet address.
3. Create your mandate.
4. Deposit USDC and a small amount of SOL for transaction fees.
5. Wait for the Signal Engine to generate a BUY proposal.
6. Review the proposal and place a Jupiter Trigger Order.
7. When the BUY fills, verify TP/SL orders appear and the position becomes active.

---

## Useful Commands

| Command                                   | What it does                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm dev`                                | Auto-start docker postgres + run web and ws-server in parallel          |
| `pnpm dev:no-db`                          | Run web + ws-server without the postgres preflight                      |
| `pnpm dev:web`                            | Run the frontend only                                                   |
| `pnpm dev:ws`                             | Run the ws-server only                                                  |
| `pnpm build`                              | Build all workspaces                                                    |
| `pnpm typecheck`                          | Run TypeScript checks in all workspaces                                 |
| `pnpm db:up`                              | Start the docker postgres container and wait for healthy                |
| `pnpm db:down`                            | `docker compose down` — stop postgres (and any other compose services)  |
| `pnpm db:generate`                        | Generate Prisma client                                                  |
| `pnpm db:push`                            | Push Prisma schema to the database (no migration history)               |
| `pnpm db:migrate`                         | `prisma migrate dev` — interactive, creates a new migration             |
| `pnpm db:migrate:deploy`                  | `prisma migrate deploy` — apply existing migrations                     |
| `pnpm db:studio`                          | Open Prisma Studio                                                      |
| `docker compose up --build -d`            | Full Docker stack: postgres + ws-server + web                           |
| `docker compose down`                     | Stop all compose services                                               |
| `pnpm --filter @hunch-it/ws-server smoke` | Run the ws-server smoke probe                                           |

---

## Where to Read Next

- [Product Overview](./product-overview.md) — what Hunch is trying to prove
- [Screens & Flows](./screens-and-flows.md) — the user-facing product flow
- [Architecture](./architecture.md) — how the apps and services fit together
- [Troubleshooting](./troubleshooting.md) — common local setup issues
