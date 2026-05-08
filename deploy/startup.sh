#!/bin/bash
# GCE VM startup script — runs on first boot AND every subsequent boot.
# Idempotent. Sets up Docker, pulls the deploy bundle from the repo,
# hydrates a .env from Secret Manager, and brings docker-compose up.
#
# Required VM metadata (set on the VM, not in this file):
#   GCP_PROJECT_ID            e.g. "hunch-it"
#   GCP_SQL_CONNECTION_NAME   e.g. "hunch-it:<gcp-region>:hunchit-pg"
#   REGISTRY                  e.g. "<gcp-region>-docker.pkg.dev/hunch-it/hunchit"
#   DOMAIN_WEB                e.g. "<app-domain>"
#   DOMAIN_WS                 e.g. "<websocket-domain>"
#   LETSENCRYPT_EMAIL         e.g. "you@example.com"
#   GIT_REPO_URL              e.g. "https://github.com/Omnis-Labs/hunch-it.git"
#   GIT_BRANCH                e.g. "main"
#
# Startup script logs land in /var/log/syslog and are streamed to
# Cloud Logging under `serial-port-1` — `gcloud compute instances tail-serial-port-output`
# is the fastest way to debug.

set -euo pipefail
exec > >(tee -a /var/log/hunchit-startup.log) 2>&1
echo "[startup] $(date -Iseconds) BEGIN"

# ──────────────────────────────────────────────────────────────────────
# 1. Read VM metadata into env so the rest of the script can reference it.
#    Cloud SQL connection name etc. live in metadata so we can rotate
#    without re-creating the VM.
# ──────────────────────────────────────────────────────────────────────
META="http://metadata.google.internal/computeMetadata/v1/instance/attributes"
curl_meta() { curl -sf -H "Metadata-Flavor: Google" "$META/$1" || true; }

export GCP_PROJECT_ID=$(curl_meta GCP_PROJECT_ID)
export GCP_SQL_CONNECTION_NAME=$(curl_meta GCP_SQL_CONNECTION_NAME)
export REGISTRY=$(curl_meta REGISTRY)
export DOMAIN_WEB=$(curl_meta DOMAIN_WEB)
export DOMAIN_WS=$(curl_meta DOMAIN_WS)
export LETSENCRYPT_EMAIL=$(curl_meta LETSENCRYPT_EMAIL)
export GIT_REPO_URL=$(curl_meta GIT_REPO_URL)
export GIT_BRANCH=$(curl_meta GIT_BRANCH || echo "main")

if [ -z "$GCP_SQL_CONNECTION_NAME" ] || [ -z "$REGISTRY" ] || [ -z "$DOMAIN_WEB" ]; then
  echo "[startup] FATAL: missing VM metadata (set GCP_SQL_CONNECTION_NAME, REGISTRY, DOMAIN_WEB at create time)"
  exit 1
fi

# ──────────────────────────────────────────────────────────────────────
# 2. Install Docker + Compose plugin + git (idempotent).
# ──────────────────────────────────────────────────────────────────────
if ! command -v docker &> /dev/null; then
  echo "[startup] installing docker"
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

if ! command -v git &> /dev/null; then
  apt-get update -qq && apt-get install -y -qq git
fi

# ──────────────────────────────────────────────────────────────────────
# 3. Authenticate Docker with Artifact Registry via the VM's attached
#    service account. gcloud picks up GCE metadata creds automatically.
# ──────────────────────────────────────────────────────────────────────
gcloud auth configure-docker <gcp-region>-docker.pkg.dev --quiet

# ──────────────────────────────────────────────────────────────────────
# 4. Pull deploy bundle from the repo. We only need deploy/ + the
#    images come from Artifact Registry.
# ──────────────────────────────────────────────────────────────────────
mkdir -p /opt/hunchit
cd /opt/hunchit

if [ ! -d /opt/hunchit/repo ]; then
  echo "[startup] cloning repo"
  git clone --depth 1 --branch "$GIT_BRANCH" "$GIT_REPO_URL" repo
else
  echo "[startup] updating repo"
  cd /opt/hunchit/repo && git fetch origin "$GIT_BRANCH" && git reset --hard "origin/$GIT_BRANCH"
fi

# ──────────────────────────────────────────────────────────────────────
# 5. Hydrate /opt/hunchit/.env from Secret Manager. Re-runs each boot so
#    a `gcloud secrets versions add` rotates without re-creating VM —
#    just `sudo systemctl restart google-startup-scripts` (or reboot)
#    and docker compose picks up the new values.
# ──────────────────────────────────────────────────────────────────────
fetch_secret() { gcloud secrets versions access latest --secret="$1"; }

DATABASE_URL=$(fetch_secret database-url)
SOLANA_RPC_URLS=$(fetch_secret solana-rpc-urls)
PRIVY_APP_SECRET_VAL=$(fetch_secret privy-app-secret)
GEMINI_KEY=$(fetch_secret gemini-key)

cat > /opt/hunchit/.env <<EOF
# Hydrated by startup.sh from Secret Manager + VM metadata. Do not edit
# manually — changes will be overwritten on next boot.

# Pulled from VM metadata
REGISTRY=${REGISTRY}
GCP_SQL_CONNECTION_NAME=${GCP_SQL_CONNECTION_NAME}
DOMAIN_WEB=${DOMAIN_WEB}
DOMAIN_WS=${DOMAIN_WS}
LETSENCRYPT_EMAIL=${LETSENCRYPT_EMAIL}

# Pulled from Secret Manager
DATABASE_URL=${DATABASE_URL}
NEXT_PUBLIC_SOLANA_RPC_URLS=${SOLANA_RPC_URLS}
PRIVY_APP_SECRET=${PRIVY_APP_SECRET_VAL}
GEMINI_API_KEY=${GEMINI_KEY}

# Static / public — also embedded in the web image at build time, but
# server-side handlers + ws-server need them at runtime too.
PRIVY_APP_ID=<privy-app-id>
NEXT_PUBLIC_PRIVY_APP_ID=<privy-app-id>
NEXT_PUBLIC_APP_URL=https://${DOMAIN_WEB}
NEXT_PUBLIC_WS_URL=https://${DOMAIN_WS}
NEXT_PUBLIC_DEFAULT_TRADE_USD=5
ENABLE_DEV_TOOLS=false
NEXT_PUBLIC_JUPITER_API_BASE=https://lite-api.jup.ag

# LLM signal engine
LLM_ENABLED=true
LLM_DAILY_USD_CAP=20
SIGNAL_INTERVAL_SECONDS=60
TICKER_STAGGER_SECONDS=2
BASE_ANALYSIS_BAR_CLOSE_SECONDS=300
BASE_ANALYSIS_MATERIAL_MOVE_PCT=0.3
BASE_ANALYSIS_FORCE_REFRESH_SECONDS=900

# Pyth price feeds
PYTH_HERMES_URL=https://hermes.pyth.network
PYTH_BENCHMARKS_URL=https://benchmarks.pyth.network
EOF

chmod 600 /opt/hunchit/.env
echo "[startup] .env written ($(wc -l < /opt/hunchit/.env) lines)"

# ──────────────────────────────────────────────────────────────────────
# 6. Bring docker-compose up. --pull=always so a `gcloud build` push
#    reflects after the next boot (or `systemctl restart docker` +
#    re-running this script).
# ──────────────────────────────────────────────────────────────────────
cd /opt/hunchit/repo/deploy
docker compose -f docker-compose.prod.yml --env-file /opt/hunchit/.env pull
docker compose -f docker-compose.prod.yml --env-file /opt/hunchit/.env up -d --remove-orphans

echo "[startup] $(date -Iseconds) DONE"
