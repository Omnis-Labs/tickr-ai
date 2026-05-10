# syntax=docker/dockerfile:1.7
#
# Build context MUST be the monorepo root.
#
# The runtime image runs compiled JS with production dependencies only. The
# `build` stage intentionally keeps dev tooling so compose can use it as the
# one-off migration image.

ARG NODE_VERSION=20-alpine

FROM node:${NODE_VERSION} AS base
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/ws-server/package.json apps/ws-server/
COPY packages/db/package.json packages/db/
COPY packages/execution/package.json packages/execution/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
ENV NODE_ENV=production
COPY tsconfig.base.json ./
COPY apps/ws-server ./apps/ws-server
COPY packages/db ./packages/db
COPY packages/execution ./packages/execution
COPY packages/shared ./packages/shared

RUN pnpm --filter @hunch-it/shared build
RUN pnpm --filter @hunch-it/db build
RUN pnpm --filter @hunch-it/execution build
RUN pnpm --filter @hunch-it/ws-server build
RUN pnpm --filter @hunch-it/ws-server deploy --prod /out

FROM node:${NODE_VERSION} AS runner
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NODE_ENV=production
ENV WS_SERVER_PORT=4000

COPY --from=build /out ./

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1

CMD ["node", "dist/index.js"]
