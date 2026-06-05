# Deployment Guide

The stack splits cleanly:

```
Vercel (Next.js frontend)  ──HTTPS──▶  Railway / Zeabur (FastAPI + Playwright)  ──▶  Supabase (Postgres + Storage)
```

Vercel can't run Playwright (no long-running container runtime), so we host
the frontend there and the backend on a container platform. Supabase carries
the Postgres ledger and artifact storage.

## 1. Supabase (database + artifact storage)

1. Create a project at https://supabase.com.
2. **Database** → Settings → Database → copy the *URI* connection string
   (Pool mode). Prepend `postgresql+asyncpg://` to match SQLAlchemy's scheme.
3. **Storage** → New bucket → name it `artifacts` (or whatever you'll set in
   `SUPABASE_STORAGE_BUCKET`). Leave it private.
4. **Project settings** → API → copy `URL` and `service_role` key (not the
   anon key — uploads need elevated permissions).

You'll use these four values in §3.

## 2. Backend — Railway (recommended) or Zeabur

Both configs are in [`infra/`](../infra/) — [`railway.json`](../infra/railway.json) and [`zeabur.json`](../infra/zeabur.json) — and both point at the same [`Dockerfile`](../infra/Dockerfile).

### Railway

```bash
# From repo root:
railway login
railway init
railway link  # or `railway up` to create a new service
# Set environment variables (see infra/.env.production.example for the list)
railway variables set GEMINI_API_KEY=...
railway variables set DATABASE_URL='postgresql+asyncpg://postgres:...@db.xxx.supabase.co:5432/postgres'
railway variables set ARTIFACT_BACKEND=supabase
railway variables set SUPABASE_URL=https://xxx.supabase.co
railway variables set SUPABASE_SERVICE_KEY=eyJ...
railway variables set SUPABASE_STORAGE_BUCKET=artifacts
railway variables set CORS_ORIGINS=https://your-frontend.vercel.app
railway up
```

Railway picks up [`infra/railway.json`](../infra/railway.json) automatically,
builds via Dockerfile, exposes `/task1/health` as the healthcheck. The first
build downloads the Playwright Chromium binary (~100 MB) — give it ~3 minutes.

### Zeabur

```bash
# Push the repo to GitHub, then in Zeabur dashboard:
# - New Project → Deploy from GitHub
# - Pick the repo, Zeabur reads infra/zeabur.json
# - Environment Variables → paste from infra/.env.production.example
# - Deploy
```

### Other platforms

- **Fly.io**: `fly launch` with the Dockerfile; same env vars.
- **Render**: connect repo, select Dockerfile, paste env vars.
- The [Procfile](../infra/Procfile) covers any Heroku-style buildpack platform.

## 3. Frontend — Vercel

```bash
cd web
vercel login
vercel link
vercel env add NEXT_PUBLIC_API_URL
# Paste your Railway / Zeabur backend URL, e.g. https://whaleforce.up.railway.app
vercel --prod
```

[`web/vercel.json`](../web/vercel.json) configures the Next.js framework
preset + `npm install --legacy-peer-deps` (needed for the Next 15.0.3 +
React 19 peer-dep mismatch).

Set `NEXT_PUBLIC_API_URL` in Vercel's project settings to the backend URL
**before** the first build — it's baked into the static bundle.

## 4. Verifying the deploy

After both are up:

```bash
# Backend health
curl https://your-backend.up.railway.app/task1/health
# → {"status":"ok","llm_backend":"gemini"}

# Capabilities
curl https://your-backend.up.railway.app/task1/capabilities | jq .

# Dashboard data
curl https://your-backend.up.railway.app/task1/dashboard/cost-summary | jq '.total_cost_usd'
```

Then load:
- `https://your-frontend.vercel.app/` — landing
- `https://your-frontend.vercel.app/task1` — submit a browser task
- `https://your-frontend.vercel.app/task2` — submit a 10-K URL
- `https://your-frontend.vercel.app/dashboard` — eval + cost summary
- `https://your-frontend.vercel.app/jobs/<job_id>` — failure inspector

## 5. CORS

The backend's CORS list is controlled by `CORS_ORIGINS`. Set it to the
exact Vercel URL (or a comma-separated list including the preview URL
pattern). Avoid `*`; the API serves SSE which interacts with CORS in
particular ways across browsers.

## 6. Cost & rate-limit considerations

- **Gemini free tier** handles the dev eval cost ($0.60 across hundreds of
  calls). The interview demo cost is bounded by the per-task budget
  (`TASK1_BUDGET_USD`, default $0.20) and the global daily cap
  (`GLOBAL_DAILY_BUDGET_USD`, default $10).
- **SEC EDGAR** publishes a 10-req/sec rate limit for unauthenticated
  clients; our ingest sends a compliant User-Agent. Parallel eval at
  concurrency=4 stays well under.
- **Playwright Chromium memory** is ~150 MB / context. Railway's free tier
  (512 MB) handles one task at a time; bump the plan or set
  `TASK1_MAX_RECOVERY_ATTEMPTS=1` if you see OOMs.

## 7. Logs & observability

- `LOG_FORMAT=json` (the default) emits structured logs Railway's UI parses
  inline. Filter by `purpose=task1.locator` etc. to slice by stage.
- Cost ledger is a Postgres table (`cost_ledger`). Query in Supabase SQL
  editor for per-purpose / per-model / per-day breakdowns:

  ```sql
  SELECT purpose, COUNT(*), SUM(cost_usd)
  FROM cost_ledger
  WHERE occurred_at >= NOW() - INTERVAL '1 day'
  GROUP BY purpose ORDER BY SUM(cost_usd) DESC;
  ```

- `OTEL_ENABLED=true` + `OTEL_EXPORTER_OTLP_ENDPOINT` ships OpenTelemetry
  traces. Wire to Honeycomb / Grafana / etc. when you want span-level data.
