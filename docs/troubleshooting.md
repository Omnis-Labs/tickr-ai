# Troubleshooting

Common issues when running Hunch It locally.

## Quick Reference

| Symptom                                                                          | Likely Cause                                                                                                   | Fix                                                                                                                                                                                   |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev` exits with `Docker daemon is not reachable`                           | No container runtime running (or none installed)                                                               | Install OrbStack (`brew install orbstack`, recommended) or Docker Desktop. On macOS the preflight tries `orb start` first, then `open -a Docker`, and waits up to 60s for the daemon. |
| `pnpm dev` says `postgres did not become healthy within 60s`                     | First-time pull of `postgres:16-alpine` ran long, or a previous container is wedged                            | Run `docker compose logs postgres`, then `docker compose down` and `pnpm dev` again. If a port collision is the cause, see the next row.                                              |
| `bind: address already in use` for port 5432, 3000, or 4000                      | Another Postgres / Next / Node is already on that port                                                         | Stop the conflicting process (`lsof -i :5432` to find it). For Postgres specifically, you can either stop the host service or change the host port mapping in `docker-compose.yml`.   |
| `docker compose up --build` fails with `input/output error` while copying layers | BuildKit cache corruption (often after low-disk events)                                                        | `docker builder prune -af`, free disk if you're under ~10 GiB free, then retry `docker compose up --build -d`.                                                                        |
| `next build` fails with `Cannot read file '/repo/tsconfig.base.json'`            | A custom Dockerfile is missing the repo-root tsconfig                                                          | Both shipped Dockerfiles already copy it. If you wrote a new one, add `tsconfig.base.json` to the `COPY` list in the build stage.                                                     |
| App cannot connect to ws-server                                                  | `apps/ws-server` is not running or `NEXT_PUBLIC_WS_URL` is wrong                                               | Run `pnpm dev` or `pnpm dev:ws`; check `NEXT_PUBLIC_WS_URL=http://localhost:4000`                                                                                                     |
| No proposals appear                                                              | No mandate, no USDC, signal data is stale, market scanner has not produced a BUY, or ws-server is disconnected | Create a mandate, add USDC in live mode, check ws-server logs, and refresh the Home screen                                                                                            |
| Deposit section never goes away                                                  | Portfolio sync has not seen the wallet balance yet                                                             | Confirm USDC is on Solana, then reload or trigger portfolio sync                                                                                                                      |
| Order placement says insufficient USDC                                           | Wallet USDC is lower than the proposal size; synthetic Orders do not lock funds before execution               | Fund the wallet or reduce size before accepting/executing                                                                                                                             |
| Proposal disappeared after editing mandate                                       | Active proposals are invalidated when the mandate changes                                                      | This is expected; wait for new proposals based on the updated mandate                                                                                                                 |
| BUY order is open but no position is active                                      | Synthetic trigger has not reached an executable Ultra quote yet, or execution has not completed                 | Wait for/force an executable trigger check. With Auto-execute triggers off, tap Execute when `trigger:hit` appears; with it on, check for `trade:filled`, quote-waiting logs, or delegated execution errors. |
| Position is stuck in `ENTERING` or `CLOSING`                                     | A trigger execution claim is still pending after signing/submission                                            | Check `/dev-tools` logs and retry/reconcile; claims release only for pre-signature failures                                                                                           |
| TP/SL edit fails                                                                 | The order or position is not editable                                                                          | Only active TP/SL orders for an `ACTIVE` position can be edited                                                                                                                       |
| Close Position fails before swap                                                 | One of the exit-order cancellations failed                                                                     | The app should retry cancellation before attempting the market sell                                                                                                                   |
| Price chart unavailable                                                          | Pyth Benchmarks or Hermes is unreachable                                                                       | Retry later; trading state can still be inspected without chart data                                                                                                                  |
| `gemini call failed` in logs                                                     | Missing, invalid, or unfunded Gemini key                                                                       | Check `GEMINI_API_KEY`; the signal loop falls back to rules when LLM is unavailable                                                                                                   |
| Prisma cannot connect                                                            | `DATABASE_URL` is missing or database is unreachable                                                           | Verify the connection string and run `pnpm db:generate` / `pnpm db:push`                                                                                                              |

## Dev Tools Checklist

If `/dev-tools` does not unlock or emit triggers:

1. Confirm `ENABLE_DEV_TOOLS=true` in both web and ws-server env files.
2. Confirm `DEV_TOOLS_PASSWORD` matches on web and ws-server.
3. Restart `pnpm dev` or `docker compose up --build -d` after changing env vars.
4. Check `/dev-tools` structured logs first. Client diagnostics stay in the browser log so local terminals do not fill with copied swap payloads.

## Browser Notifications

Hunch uses browser notifications only while the app has an active tab or Shared Worker. It does not rely on remote mobile push notifications.

If notifications do not appear:

| Check                    | How to Verify                                                                    |
| ------------------------ | -------------------------------------------------------------------------------- |
| Browser permission       | Browser site settings should allow notifications for localhost or the app domain |
| Tab still open           | Do not close the Hunch tab; background tabs are fine                             |
| ws-server connected      | Check ws-server logs and browser console                                         |
| macOS / OS notifications | System Settings should allow notifications from your browser                     |
| Focus / Do Not Disturb   | Turn off OS-level focus modes while testing                                      |

Notifications are helpful, but the Home feed is the source of truth for proposals and order state.

## Docker / Local DB

The bundled `docker-compose.yml` runs a `hunch-postgres` container that both run modes ([Getting Started](./getting-started.md)) connect to. A few common issues:

- **Switching between Method A (full Docker) and Method B (`pnpm dev`)**: within a single container runtime, both modes share the same `hunch-pgdata` volume, so your data survives the switch. You only need to be careful that you're not running them simultaneously, since they would both try to bind `:3000`, `:4000`, and `:5432`.
- **Switching between OrbStack and Docker Desktop**: each runtime keeps its own volume store, so the `hunch-pgdata` volume from one is invisible to the other. After switching runtimes, run `pnpm db:push` once to recreate the schema in the new volume.
- **Resetting the database**: `docker compose down -v` removes the named volume, wiping all rows. Re-run `pnpm db:push` (or your migration of choice) afterwards.
- **Slow first build for Method A**: cold image build runs `pnpm install --frozen-lockfile`, `prisma generate`, and `next build` from scratch (~10–15 min, dominated by `next build`). Once images are built, `docker compose up -d` starts everything in seconds. Don't `docker system prune -a` between runs unless you want to redo the long path.
- **`pnpm dev:no-db`**: skip the postgres preflight if you have your own Postgres (a managed Postgres proxy, an existing local instance, etc.). You're then responsible for making sure `DATABASE_URL` resolves before the apps start.
