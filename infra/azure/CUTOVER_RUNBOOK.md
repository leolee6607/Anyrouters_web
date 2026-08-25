# AN production cutover: GCP us-east4 to Azure

> Status: completed on 2026-08-26 (Asia/Shanghai). Azure is authoritative; the GCP source is retired but its database backups, final dump and image are retained.

This runbook covers AN only. AL retirement and OAI-B must not be mixed into this migration.

## Fixed scope

- Source project/region/service: `anyrouters-prod` / `us-east4` / `newapi-failover`
- Source revision: `newapi-failover-claudefix-0819`
- Source commit: `3110d83faa1f722a6a1dc716fdec93ae1b73d32a`
- Source image digest: `sha256:221d978a191139d4b37ebc3a43ce3dd37ecb7bf4accdaf9e6d660cc8a16223a7`
- Former GCP load balancer IP: `8.232.55.181`
- Azure resource group/region: `rg-anyrouters-prod` / `westus2`
- Azure Container App/environment: `ca-anyrouters-web` / `cae-anyrouters-prod`
- Azure ingress IP: `20.115.249.109`
- Azure production revision: `ca-anyrouters-web--redisfix-20260826`
- Production hostnames: `anyrouters.com`, `www.anyrouters.com`, `console.anyrouters.com`, `api.anyrouters.com`

Never use the obsolete GCP `us-east1` resources as a migration source.

## Safety invariants

1. There is exactly one writable production database.
2. A final, checksummed database dump is retained before source retirement.
3. AWS Claude and Azure GPT channels are preserved; only Gemini/Vertex moves to Kongshiai GCP.
4. Redis is cache/session infrastructure, not a source of truth.
5. No secret value is written to documentation, logs, screenshots or Git.
6. Provider/catalog, public ingress, accounting and data checks must pass before source cleanup.

## Completed migration sequence

1. Imported the locked image into ACR and deployed isolated Azure infrastructure.
2. Pre-staged public certificates and all four custom domains.
3. Stopped source writes and created the final GCP SQL dump.
4. Imported and verified the dump in Azure MySQL.
5. Updated the Vertex channel to Kongshiai while preserving AWS and Azure channels.
6. Switched Cloudflare records from `8.232.55.181` to `20.115.249.109`.
7. Corrected Redis compatibility by switching production to a private TLS `NoCluster` database.
8. Ran catalog, chat, image, video, accounting, page, HTTPS and health checks.
9. Retired the GCP source: internal Cloud Run at max 1/min 0, stopped Cloud SQL and deleted cache-only Memorystore.

## Final snapshot and validation IDs

- Dump: `gs://anyrouters-prod-db-migration-20260825/anyrouters-newapi-final-20260825-163521.sql.gz`
- Size/SHA-256: `2,451,863` / `780e286ebaa970749b03ef9dff3b0254eea41f21de99c7bae93dafb658ce6473`
- Import: `job-anyrouters-db-import-1twi03a` — Succeeded
- Database verification: `job-anyrouters-db-verify-mmaxjq1` — Succeeded
- Channel audit: `job-anyrouters-db-channel-audit-51alczc` — Succeeded
- Redis compatibility: `job-redis-compat-verify-nnwph9n` — Succeeded
- Production catalog/provider smoke: `job-anyrouters-api-smoke-lu8maiu` — Succeeded
- Usage/accounting audit: `job-anyrouters-db-usage-audit-t1dznyy` — Succeeded

See `CUTOVER_EVIDENCE_20260826.md` for counts and individual workflow results.

## Current production verification

- `anyrouters.com`, `www`, `console` and `api/status` return 200 over HTTPS.
- HTTP redirects to HTTPS.
- Active Azure revision is healthy, running and receives 100% traffic.
- The enabled catalog contains 25 unique model IDs.
- Vertex text/image/video, AWS Claude and Azure GPT production requests pass.
- Production logs have no Redis cluster transaction errors after the final revision.

## Recovery procedure

The retained GCP service is not a hot standby. For recovery:

1. Declare maintenance and stop Azure writes.
2. Restore the retained final dump or an accepted backup to GCP Cloud SQL.
3. Provision a compatible Redis and update the source service secret/configuration.
4. Restore Cloud Run database connectivity, ingress and invoker policy.
5. Verify login, key use, accounting, recharge callback, chat, image and video workflows.
6. Restore the four DNS records to `8.232.55.181` only after GCP is authoritative.
7. Preserve Azure data/logs for reconciliation; do not merge two writable databases blindly.

## Retention and later deletion

Retain the final GCS dump, successful Cloud SQL backup, Artifact Registry image and this evidence until the business owner accepts the retention window. Future deletion of those recovery assets or the GCP project requires a separate, explicit destructive-action decision.
