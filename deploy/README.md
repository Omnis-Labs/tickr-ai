# Deploy — single-VM GCE + Cloud SQL

End-to-end deploy of `web` + `ws-server` to one Compute Engine VM,
fronted by Caddy (auto Let's Encrypt), backed by a Cloud SQL Postgres
through the Auth Proxy. Image pulls from Artifact Registry, secrets
from Secret Manager.

Topology:

```
internet ───► Caddy (80/443) ─┬─► web:3000
                              └─► ws-server:4000
                                       │
                                       └─► db (cloud-sql-proxy:5432)
                                              │
                                              └─► Cloud SQL (private)
```

Predicted cost at idle: ~$22/mo (e2-small VM $13 + db-f1-micro $9).

## What's in this dir

- `docker-compose.prod.yml` — the 4 services (db proxy, ws-server, web, caddy)
- `Caddyfile` — reverse proxy + LE cert config
- `startup.sh` — runs on every VM boot; hydrates `.env` from Secret Manager and `docker compose up -d`
- `runbook.md` — step-by-step gcloud commands to bootstrap the whole stack from scratch

## One-time setup

Follow `runbook.md` top to bottom. Total time ~60-75 min, mostly waiting for Cloud SQL to provision.

## Deploying a new code version

1. Local: rebuild and push images
   ```bash
   ./deploy/build-and-push.sh
   ```
2. SSH to VM and restart compose:
   ```bash
   gcloud compute ssh <vm-name> --zone=<gcp-zone> --command \
     "cd /opt/hunchit/repo/deploy && \
      docker compose -f docker-compose.prod.yml --env-file /opt/hunchit/.env pull && \
      docker compose -f docker-compose.prod.yml --env-file /opt/hunchit/.env up -d"
   ```

Or just reboot the VM — startup.sh re-runs and pulls latest.

## Rotating a secret

```bash
echo -n "new-value" | gcloud secrets versions add <secret-name> --data-file=-
gcloud compute instances reset <vm-name> --zone=<gcp-zone>
```

The reboot picks up new versions (startup.sh always reads `latest`).

## Tailing logs

```bash
# Startup script + system logs
gcloud compute instances tail-serial-port-output <vm-name> --zone=<gcp-zone>

# Docker compose logs (need SSH)
gcloud compute ssh <vm-name> --zone=<gcp-zone> --command \
  "docker compose -f /opt/hunchit/repo/deploy/docker-compose.prod.yml \
   --env-file /opt/hunchit/.env logs -f --tail 100"
```

Or open Cloud Logging → resource type "GCE VM Instance" → instance "<vm-name>".

## Why this shape

- **Single VM, not Cloud Run + GKE**: ws-server needs long-lived Socket.IO
  connections. Cloud Run caps requests at 60min and bills per request, which
  makes "30s polling task" awkward and expensive. GKE is overkill for one
  binary. e2-small + docker compose ships in 60 min.
- **Cloud SQL Auth Proxy in compose, not VPC private IP**: avoids needing a
  Serverless VPC connector or VPC peering. Service account auth is enough.
- **Caddy not Nginx**: auto-LE means no manual cert renewal.
- **Pull images from Artifact Registry, not build on VM**: e2-small can't
  comfortably build the Next.js standalone bundle without OOM.
