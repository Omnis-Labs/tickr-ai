# syntax=docker/dockerfile:1.7
#
# ws-server image. Three stages:
#   1. base   — pnpm + corepack on Alpine
#   2. deps   — install the FULL pnpm workspace so workspace:* packages
#               (@hunch-it/db, @hunch-it/shared) link correctly. Trying to
#               install only ws-server breaks because pnpm rejects unknown
#               workspace protocol entries.
#   3. runner — strip dev tooling, run with tsx so we keep using the .ts
#               sources of the workspace packages directly (their package.json
#               main fields point at ./src/index.ts; there is no tsc dist).
#
# Build context MUST be the monorepo root (`docker build -f apps/ws-server/Dockerfile .`)
# so we can copy the workspace manifest + every package.json before installing.

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

# ─── Stage 3: runner ────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV WS_SERVER_PORT=4000

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/ws-server/node_modules ./apps/ws-server/node_modules
COPY --from=deps /repo/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/ws-server ./apps/ws-server
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared

# Generate Prisma client into packages/db/node_modules/.prisma — required at
# runtime by @hunch-it/db.
RUN pnpm --filter @hunch-it/db exec prisma generate

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://localhost:4000/healthz || exit 1

WORKDIR /repo/apps/ws-server
# tsx (already a devDependency) reads the .ts source directly. We don't
# build to dist because the workspace packages' package.json main fields
# point at .ts files; using a transpile-on-load runner keeps imports
# resolvable without a separate compile step.
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
