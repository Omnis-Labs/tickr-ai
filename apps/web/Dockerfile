# syntax=docker/dockerfile:1.7
#
# web image. Same multi-stage shape as ws-server, but the runner ships the
# Next standalone bundle (.next/standalone/server.js + .next/static + public)
# so the runtime image is small and the build dependencies (typescript,
# Prisma CLI, etc.) don't ship to prod.
#
# Build context MUST be the monorepo root.
#
# NEXT_PUBLIC_* values are baked into the JS bundle at build time, so they
# need to be passed as build args. Server-only env (DATABASE_URL,
# WS_URL_INTERNAL, PRIVY_APP_SECRET, …) is read at runtime — leave those
# for `docker run -e`.

ARG NODE_VERSION=20-alpine

# ─── Stage 1: pnpm base ─────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS base
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

# ─── Stage 2: deps ──────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/ws-server/package.json apps/ws-server/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ─── Stage 3: build ─────────────────────────────────────────────────────────
FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1

# Public env baked into the bundle. Defaults work for local docker compose;
# override per environment when `docker build --build-arg`.
ARG NEXT_PUBLIC_WS_URL=http://localhost:4000
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_PRIVY_APP_ID=
ARG NEXT_PUBLIC_SOLANA_RPC_URLS=https://api.mainnet-beta.solana.com
ARG NEXT_PUBLIC_JUPITER_API_BASE=https://lite-api.jup.ag
ARG NEXT_PUBLIC_DEMO_MODE=false
ARG NEXT_PUBLIC_DEFAULT_TRADE_USD=500
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID
ENV NEXT_PUBLIC_SOLANA_RPC_URLS=$NEXT_PUBLIC_SOLANA_RPC_URLS
ENV NEXT_PUBLIC_JUPITER_API_BASE=$NEXT_PUBLIC_JUPITER_API_BASE
ENV NEXT_PUBLIC_DEMO_MODE=$NEXT_PUBLIC_DEMO_MODE
ENV NEXT_PUBLIC_DEFAULT_TRADE_USD=$NEXT_PUBLIC_DEFAULT_TRADE_USD

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared

# Prisma client is imported by Next route handlers (e.g. /api/portfolio).
RUN pnpm --filter @hunch-it/db exec prisma generate
RUN pnpm --filter @hunch-it/web exec next build

# ─── Stage 4: runner ────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone bundle layout:
#   apps/web/.next/standalone/         <- server.js + minimal node_modules
#   apps/web/.next/standalone/apps/web/ <- the app entry (since trace root is repo)
#   apps/web/.next/static/             <- needs to be copied to standalone/.next/static
#   apps/web/public/                   <- ditto, to standalone/apps/web/public
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

EXPOSE 3000
# 127.0.0.1 explicitly — alpine wget would otherwise resolve `localhost`
# via getaddrinfo, prefer AAAA, hit [::1]:3000 and fail on the IPv6 leg.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/ || exit 1

# server.js is emitted at the trace root (repo root), pointing at the web app.
CMD ["node", "apps/web/server.js"]
