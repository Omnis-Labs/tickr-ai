#!/usr/bin/env bash
# Keep app-level env files in sync with the root .env before local servers boot.

set -euo pipefail

ROOT_ENV=".env"
TARGETS=(
  "apps/web/.env"
  "apps/ws-server/.env"
)
STALE_TARGETS=(
  "apps/web/.env.local"
)

log() { printf '[sync-env] %s\n' "$*"; }
fail() { printf '[sync-env] %s\n' "$*" >&2; }

if [[ ! -f "$ROOT_ENV" ]]; then
  fail "root .env is missing. Run: cp .env.example .env"
  exit 1
fi

for stale_target in "${STALE_TARGETS[@]}"; do
  if [[ -e "$stale_target" ]]; then
    rm -f "$stale_target"
    log "removed stale $stale_target"
  fi
done

for target in "${TARGETS[@]}"; do
  mkdir -p "$(dirname "$target")"
  if [[ -f "$target" ]] && cmp -s "$ROOT_ENV" "$target"; then
    log "$target already current"
    continue
  fi

  cp "$ROOT_ENV" "$target"
  log "copied $ROOT_ENV -> $target"
done
