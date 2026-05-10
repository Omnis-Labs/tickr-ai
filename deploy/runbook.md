# Bootstrap runbook — `hunch-it` GCP project, `hunch.it.com` domain

Copy-paste each block in order. Estimated 60-75 minutes; the slow part is
Cloud SQL provisioning (~10 min) and the first image build/push (~10 min).

Replace **only** the values inside `<>` brackets when prompted. Everything
else can be pasted verbatim.

---

## 0. Variables you'll reuse below

```bash
export PROJECT_ID=hunch-it
export REGION=us-central1
export ZONE=us-central1-a
export VM_NAME=hunchit-vm
export SQL_INSTANCE=hunchit-pg
export DB_NAME=hunchit
export DB_USER=hunch
export AR_REPO=hunchit
export REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}"
export DOMAIN_WEB=hunch.it.com
export DOMAIN_WS=ws.hunch.it.com
export LETSENCRYPT_EMAIL=<your-email-for-LE-renewal-warnings>
export GIT_REPO_URL=https://github.com/Omnis-Labs/hunch-it.git
export GIT_BRANCH=main
export PRIVY_WALLET_AUTHORIZATION_SIGNER_ID=<paste-Privy-wallet-v2-signer-id>
export PRIVY_WALLET_AUTHORIZATION_POLICY_IDS=
```

```bash
gcloud config set project "$PROJECT_ID"
gcloud config set compute/region "$REGION"
gcloud config set compute/zone "$ZONE"
```

## 1. Enable APIs (~2 min)

```bash
gcloud services enable \
  compute.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  servicenetworking.googleapis.com \
  cloudresourcemanager.googleapis.com \
  iam.googleapis.com
```

## 2. Cloud SQL Postgres (~10 min)

```bash
# Generate a strong password and remember it. We'll use it twice.
export DB_PASSWORD=$(openssl rand -base64 32 | tr -d '+/=' | cut -c1-24)
echo "DB_PASSWORD=$DB_PASSWORD  # ← write this down"

gcloud sql instances create "$SQL_INSTANCE" \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region="$REGION" \
  --storage-size=10GB \
  --storage-type=HDD \
  --backup --backup-start-time=06:00 \
  --root-password="$DB_PASSWORD"

# Wait for it to come up. This polls every 10s and exits when RUNNABLE.
until [ "$(gcloud sql instances describe $SQL_INSTANCE --format='value(state)')" = "RUNNABLE" ]; do
  echo "  still provisioning..."; sleep 10
done

gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE"
gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASSWORD"

export SQL_CONNECTION_NAME=$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')
echo "SQL_CONNECTION_NAME=$SQL_CONNECTION_NAME  # ← write this down"
```

## 3. Run Prisma migrations from your laptop (~5 min)

```bash
brew install cloud-sql-proxy 2>/dev/null || true

# Start the proxy in the background
cloud-sql-proxy "$SQL_CONNECTION_NAME" &
PROXY_PID=$!
sleep 4

cd /Users/chenchisheng/Desktop/solana_hackthon/signaldesk
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}" \
  pnpm --filter @hunch-it/db exec prisma migrate deploy

kill $PROXY_PID
```

Expected: `All migrations have been successfully applied.` Confirm tables landed:

```bash
cloud-sql-proxy "$SQL_CONNECTION_NAME" &
PROXY_PID=$!; sleep 3
PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -c '\dt'
kill $PROXY_PID
```

You should see `User`, `Position`, `Order`, `Trade`, `Mandate`, `Proposal`, etc.

## 4. Artifact Registry (~2 min)

```bash
gcloud artifacts repositories create "$AR_REPO" \
  --repository-format=docker \
  --location="$REGION"

gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
```

## 5. Build + push images (~10-15 min)

Mac with Apple Silicon needs `--platform linux/amd64` so the image runs on
the GCE x86 VM. Docker Desktop / Colima both support buildx.

```bash
cd /Users/chenchisheng/Desktop/solana_hackthon/signaldesk

# Web bundle — NEXT_PUBLIC_* are inlined at build time, must pass as build args.
docker buildx build \
  --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_PRIVY_APP_ID=cmomi3v35011a0dlan386qmhw \
  --build-arg NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_SIGNER_ID="${PRIVY_WALLET_AUTHORIZATION_SIGNER_ID}" \
  --build-arg NEXT_PUBLIC_PRIVY_WALLET_AUTHORIZATION_POLICY_IDS="${PRIVY_WALLET_AUTHORIZATION_POLICY_IDS}" \
  --build-arg NEXT_PUBLIC_APP_URL=https://${DOMAIN_WEB} \
  --build-arg NEXT_PUBLIC_WS_URL=https://${DOMAIN_WS} \
  --build-arg "NEXT_PUBLIC_SOLANA_RPC_URLS=https://mainnet.helius-rpc.com/?api-key=9e45d8e2-dc53-4212-bfe9-6d48040649b7,https://solana-rpc.publicnode.com/" \
  --build-arg NEXT_PUBLIC_DEFAULT_TRADE_USD=5 \
  --build-arg NEXT_PUBLIC_JUPITER_API_BASE=https://lite-api.jup.ag \
  -t "$REGISTRY/web:latest" \
  -f apps/web/Dockerfile \
  --push \
  .

# ws-server — env is read at runtime, no build args needed.
docker buildx build \
  --platform linux/amd64 \
  -t "$REGISTRY/ws-server:latest" \
  -f apps/ws-server/Dockerfile \
  --push \
  .
```

## 6. Secret Manager (~3 min)

```bash
# DATABASE_URL — uses Cloud SQL Auth Proxy as a TCP service in compose.
echo -n "postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}" | \
  gcloud secrets create database-url --data-file=-

# Helius RPC URLs (your existing key)
echo -n "https://mainnet.helius-rpc.com/?api-key=9e45d8e2-dc53-4212-bfe9-6d48040649b7,https://solana-rpc.publicnode.com/" | \
  gcloud secrets create solana-rpc-urls --data-file=-

# Privy app secret (from your local .env.local)
echo -n "<paste-PRIVY_APP_SECRET-from-.env.local>" | \
  gcloud secrets create privy-app-secret --data-file=-

# Privy wallet v2 delegated signer private key + signer ID.
echo -n "<paste-PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY>" | \
  gcloud secrets create privy-wallet-authorization-private-key --data-file=-

echo -n "${PRIVY_WALLET_AUTHORIZATION_SIGNER_ID}" | \
  gcloud secrets create privy-wallet-authorization-signer-id --data-file=-

# Optional comma-separated Privy policy IDs. Skip this secret if unused;
# startup.sh treats it as optional.
if [ -n "${PRIVY_WALLET_AUTHORIZATION_POLICY_IDS}" ]; then
  echo -n "${PRIVY_WALLET_AUTHORIZATION_POLICY_IDS}" | \
    gcloud secrets create privy-wallet-authorization-policy-ids --data-file=-
fi

# Gemini key (from your local .env.local)
echo -n "<paste-GEMINI_API_KEY-from-.env.local>" | \
  gcloud secrets create gemini-key --data-file=-

```

Verify the required secrets are there:

```bash
gcloud secrets list
```

## 7. VM service account + IAM (~2 min)

```bash
gcloud iam service-accounts create hunchit-vm \
  --display-name="Hunch It VM"

export VM_SA="hunchit-vm@${PROJECT_ID}.iam.gserviceaccount.com"

for role in \
  roles/secretmanager.secretAccessor \
  roles/cloudsql.client \
  roles/artifactregistry.reader \
  roles/logging.logWriter \
  roles/monitoring.metricWriter; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:${VM_SA}" \
      --role="$role" \
      --condition=None
done
```

## 8. Create the GCE VM (~3 min)

```bash
gcloud compute instances create "$VM_NAME" \
  --machine-type=e2-small \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=20GB \
  --service-account="$VM_SA" \
  --scopes=https://www.googleapis.com/auth/cloud-platform \
  --metadata-from-file=startup-script=deploy/startup.sh \
  --metadata="GCP_PROJECT_ID=${PROJECT_ID},GCP_SQL_CONNECTION_NAME=${SQL_CONNECTION_NAME},REGISTRY=${REGISTRY},DOMAIN_WEB=${DOMAIN_WEB},DOMAIN_WS=${DOMAIN_WS},LETSENCRYPT_EMAIL=${LETSENCRYPT_EMAIL},GIT_REPO_URL=${GIT_REPO_URL},GIT_BRANCH=${GIT_BRANCH}" \
  --tags=http-server,https-server

gcloud compute firewall-rules create allow-http \
  --allow=tcp:80 --target-tags=http-server 2>/dev/null || true
gcloud compute firewall-rules create allow-https \
  --allow=tcp:443 --target-tags=https-server 2>/dev/null || true

export VM_IP=$(gcloud compute instances describe "$VM_NAME" --format='value(networkInterfaces[0].accessConfigs[0].natIP)')
echo "VM_IP=$VM_IP  # ← point your DNS at this"
```

## 9. DNS records (~5-10 min for propagation)

Go to your `it.com` domain control panel (or wherever you registered
`hunch.it.com`) and add two A records:

| Type | Name | Value    | TTL |
| ---- | ---- | -------- | --- |
| A    | @    | `$VM_IP` | 300 |
| A    | ws   | `$VM_IP` | 300 |

If using Cloudflare, set both to **DNS only (grey cloud)** — the orange
proxy mode interferes with Caddy's own ACME challenge and adds latency to
WebSocket upgrades.

Verify:

```bash
dig +short hunch.it.com
dig +short ws.hunch.it.com
# Both should return $VM_IP within ~5 min.
```

## 10. Watch startup.sh run (~3-5 min)

```bash
gcloud compute instances tail-serial-port-output "$VM_NAME" --zone="$ZONE" 2>&1 \
  | grep -E "\[startup\]|caddy|web|ws-server"
```

You should see in order:

1. `[startup] BEGIN`
2. `installing docker`
3. `cloning repo`
4. `.env written (~34 lines)`
5. Docker pulls all 4 images
6. Caddy logs `serving https://hunch.it.com on :443`
7. `[startup] DONE`

If Caddy fails to get certs, it usually means DNS hasn't propagated yet —
`gcloud compute instances reset $VM_NAME` after `dig` confirms.

## 11. Privy dashboard (~3 min)

Open https://dashboard.privy.io → app `cmomi3v35011a0dlan386qmhw` →

- **App Settings → Domain Configuration → Allowed origins** add:
  - `https://hunch.it.com`
  - `https://ws.hunch.it.com`
- **Login Methods** confirm Email is on
- **Embedded Wallets → Solana → Auto-create on login** confirm enabled

## 12. Smoke test (~5 min)

```
1. Open https://hunch.it.com
2. Get Started → enter a fresh email → verification code → /desk
3. Wait for ws-server to emit a BUY proposal (~60s if signal engine fires)
4. Approve a small one (size $2-5) with trigger near current price
5. Wait ≤30s for trigger-monitor to emit trigger:hit
6. Tap Execute on the toast
7. Confirm: toast → "BUY MSFTx confirmed", DB Order=FILLED
```

Verify on-chain:

```bash
# Get the latest tx signature on your wallet
curl -s -X POST "https://mainnet.helius-rpc.com/?api-key=9e45d8e2-dc53-4212-bfe9-6d48040649b7" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getSignaturesForAddress","params":["<your-wallet>",{"limit":1}]}' \
  | python3 -m json.tool
```

`err: null` means clean fill.

## Troubleshooting

| Symptom                                     | Likely cause                                      | Fix                                                                               |
| ------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `caddy` keeps restarting, no cert           | DNS not propagated, or A records on wrong domain  | `dig +short hunch.it.com` should match `$VM_IP`; reset VM after fix               |
| `web` exits with `prisma client init` error | DATABASE_URL secret malformed                     | re-add the secret with the exact format `postgresql://hunch:<pw>@db:5432/hunchit` |
| `ws-server` can't reach Pyth                | egress firewall (rare on default VPC)             | check VPC firewall outbound rules                                                 |
| Privy modal says "invalid origin"           | dashboard origin not added                        | revisit step 11, save, hard reload page                                           |
| `Total Value $0` in /desk                   | Helius RPC rate-limited or key wrong              | hit `https://mainnet.helius-rpc.com/?api-key=<key>` directly with `getHealth`     |
| Image pull `permission denied`              | service account missing `artifactregistry.reader` | re-run step 7 IAM bindings                                                        |

## Teardown (in case you need to nuke)

```bash
gcloud compute instances delete "$VM_NAME" --zone="$ZONE" --quiet
gcloud sql instances delete "$SQL_INSTANCE" --quiet
gcloud artifacts repositories delete "$AR_REPO" --location="$REGION" --quiet
for s in database-url solana-rpc-urls privy-app-secret gemini-key; do
  gcloud secrets delete "$s" --quiet
done
```
