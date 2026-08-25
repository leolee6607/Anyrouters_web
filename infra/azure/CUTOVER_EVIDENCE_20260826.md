# AN production cutover evidence — 2026-08-26

This document records non-secret evidence for the AN migration from Jiaxuan GCP to Jiaxuan Azure. AL retirement and OAI-B are separate workstreams.

## Final production state

- Production ingress IP: `20.115.249.109`.
- Azure resource group: `rg-anyrouters-prod` in `westus2`.
- Azure Container App: `ca-anyrouters-web`.
- Active revision: `ca-anyrouters-web--redisfix-20260826`, `Healthy`, `Running`, 100% traffic.
- Azure MySQL is the only writable production database.
- Application Redis is `anyrouters-prod-redis-app`, Redis 7.4, `Balanced_B1`, `NoCluster`, private endpoint `10.42.3.5` and TLS.
- The earlier Azure OSS-cluster cache is retained as a labelled legacy resource and is not used by production.

## Final data synchronization

- Final dump: `gs://anyrouters-prod-db-migration-20260825/anyrouters-newapi-final-20260825-163521.sql.gz`
- Size: `2,451,863` bytes
- SHA-256: `780e286ebaa970749b03ef9dff3b0254eea41f21de99c7bae93dafb658ce6473`
- Azure import: `job-anyrouters-db-import-1twi03a` — Succeeded
- Verification: `job-anyrouters-db-verify-mmaxjq1` — Succeeded

Verified counts:

| Item | Count |
| --- | ---: |
| Tables | 40 |
| Users | 30 |
| Tokens | 54 |
| Channels | 5 |
| Enabled channels | 4 |
| Model mappings | 31 |
| Top-ups | 75 |
| Stripe orders | 0 |
| Tickets | 2 |
| Ticket messages | 6 |
| Redemptions | 53 |
| Options | 49 |
| Schema migrations | 6 |

## DNS, HTTPS and pages

Cloudflare record content is `20.115.249.109` for `anyrouters.com`, `www`, `console` and `api`. Root, www and console preserve proxying; API remains DNS-only with TTL 300.

| Check | Result |
| --- | --- |
| `https://anyrouters.com/` | 200 |
| `https://www.anyrouters.com/` | 200 |
| `https://console.anyrouters.com/` | 200 |
| `https://api.anyrouters.com/api/status` | 200 |
| HTTP for all four hostnames | 301 to the corresponding HTTPS URL |
| Unauthenticated `/v1/models` | 401 JSON, expected |

The direct old GCP load balancer no longer serves the production route.

## Redis compatibility correction

The application's transactional Redis usage (`MULTI`/`EXEC`) was incompatible with the first Azure OSS-cluster deployment. A dedicated `NoCluster` Redis Enterprise database was therefore provisioned and production switched to it through Key Vault.

- Compatibility execution: `job-redis-compat-verify-nnwph9n` — Succeeded.
- Verified operations: `PING`, `SET`, `GET`, `MULTI`, `EXEC`.
- Post-cutover logs contain no `MOVED`, `EXECABORT`, quota or Redis connection errors.

## Provider and model coverage

- Latest channel audit: `job-anyrouters-db-channel-audit-51alczc` — Succeeded.
- Enabled catalog: 25 unique model IDs across four enabled channels.
- Kongshiai Vertex: 12 IDs covering Gemini text/multimodal, Gemini image, Imagen 4 and Veo 3/3.1 families.
- Azure eastus: 8 GPT IDs.
- Azure eastus2: `gpt-image-2` and `gpt-5.4-pro`.
- AWS AN: Claude Sonnet 4.6, Opus 4.6 and Haiku 4.5.
- The old AWS global channel remains disabled by design.

Production-domain smoke execution `job-anyrouters-api-smoke-lu8maiu` — Succeeded:

1. `/v1/models` returned all 25 expected enabled IDs.
2. Vertex text completion returned 200.
3. Vertex Flash image generation returned 200.
4. Vertex Pro image generation returned 200.
5. Vertex Veo submission returned 200, completed on poll 4, and ranged content download returned 206.
6. AWS Claude completion returned 200.
7. Azure GPT Responses returned 200.

Usage/accounting audit `job-anyrouters-db-usage-audit-t1dznyy` — Succeeded. The smoke proves the active families and catalog exposure; it does not claim a paid sample was generated for every alias individually.

## GCP source retirement

The source was retired only after production and provider checks passed:

- Cloud Run `newapi-failover` remains internal, labelled `migration-status=retired-azure-20260826`, with service-level maximum instances set to 1 and no minimum instances.
- Cloud SQL `anyrouters-mysql-e4` is `STOPPED` with activation policy `NEVER`; the obsolete `anyrouters-mysql` is also stopped.
- Memorystore `anyrouters-redis-prod-e4` was deleted. It contained cache/session state only and is not a system of record.
- The final SQL dump, successful Cloud SQL backups, Artifact Registry image and Cloud Run configuration are retained for recovery/audit.
- The GCP project was not deleted.

## Rollback boundary

Because the GCP database is stopped and DNS points to Azure, rollback is not a DNS-only operation. Stop Azure writes, restore the retained final database into an authoritative GCP database, provision a new compatible Redis, restore Cloud Run connectivity/ingress and invoker policy, verify all workflows, and only then restore DNS to `8.232.55.181`. Never run both databases writable or merge them blindly.
