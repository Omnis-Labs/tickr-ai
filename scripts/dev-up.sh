#!/usr/bin/env bash
# scripts/dev-up.sh
#
# Local-dev preflight: ensure docker postgres is up and the Prisma client is
# generated before `pnpm dev` boots web + ws-server.
#
# Behaviour:
#   1. If Docker daemon is unreachable, try to start a container runtime.
#      On macOS we prefer OrbStack (`orb start`, lighter & faster than Docker
#      Desktop) and fall back to Docker Desktop only if OrbStack isn't
#      installed. On other platforms we just expect `docker` to be reachable.
#   2. If `hunch-postgres` is missing → `docker compose up -d postgres`.
#   3. Wait until the container reports `healthy` (max 60s).
#   4. Run `prisma generate` so the client matches schema.prisma. Idempotent
#      and cheap (~1s on a warm cache).
#
# Exit codes:
#   0 — postgres healthy, prisma client ready
#   1 — Docker unreachable / unrecoverable error
#   2 — postgres failed to become healthy in time

set -euo pipefail

GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RED=$'\033[31m'
DIM=$'\033[2m'
RESET=$'\033[0m'

log()  { printf '%s[dev-up]%s %s\n' "$DIM" "$RESET" "$*"; }
ok()   { printf '%s[dev-up]%s %s%s%s\n' "$DIM" "$RESET" "$GREEN" "$*" "$RESET"; }
warn() { printf '%s[dev-up]%s %s%s%s\n' "$DIM" "$RESET" "$YELLOW" "$*" "$RESET"; }
fail() { printf '%s[dev-up]%s %s%s%s\n' "$DIM" "$RESET" "$RED" "$*" "$RESET" >&2; }

CONTAINER=hunch-postgres

# ── 1. Docker reachable? ────────────────────────────────────────────────────
if ! docker info >/dev/null 2>&1; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    if command -v orb >/dev/null 2>&1; then
      warn "Docker daemon not reachable — starting OrbStack..."
      orb start >/dev/null 2>&1 || true
    elif [[ -d "/Applications/Docker.app" ]]; then
      warn "Docker daemon not reachable — launching Docker Desktop..."
      open -a Docker || true
    fi
    for i in $(seq 1 60); do
      if docker info >/dev/null 2>&1; then
        ok "Docker daemon up after ${i}s"
        break
      fi
      sleep 1
    done
  fi
  if ! docker info >/dev/null 2>&1; then
    fail "Docker daemon is not reachable. Install OrbStack (\`brew install orbstack\`) or Docker Desktop, start it, then re-run pnpm dev."
    exit 1
  fi
fi

# ── 2. Bring postgres up if needed ──────────────────────────────────────────
state="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo missing)"
case "$state" in
  healthy)
    ok "postgres already healthy ($CONTAINER)"
    ;;
  starting)
    log "postgres is starting..."
    ;;
  *)
    log "starting postgres via docker compose..."
    docker compose up -d postgres >/dev/null
    ;;
esac

# ── 3. Wait healthy (max 60s) ───────────────────────────────────────────────
if [[ "$state" != "healthy" ]]; then
  printf '%s[dev-up]%s waiting for postgres healthy' "$DIM" "$RESET"
  for i in $(seq 1 60); do
    state="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo missing)"
    if [[ "$state" == "healthy" ]]; then
      printf ' %s✓ (%ss)%s\n' "$GREEN" "$i" "$RESET"
      break
    fi
    printf '.'
    sleep 1
  done
  if [[ "$state" != "healthy" ]]; then
    printf '\n'
    fail "postgres did not become healthy within 60s (state=$state). Inspect with: docker compose logs postgres"
    exit 2
  fi
fi

# ── 4. Prisma client (idempotent) ───────────────────────────────────────────
log "generating prisma client..."
pnpm --filter @hunch-it/db exec prisma generate >/dev/null
ok "ready — handing off to dev servers"
