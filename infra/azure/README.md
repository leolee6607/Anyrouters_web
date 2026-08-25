# AN Azure production infrastructure

This directory contains the reproducible Azure infrastructure for migrating the current AN production workload from GCP `us-east4` to Azure. It intentionally does not reuse Foundry or OAI-B resource groups.

## Locked production baseline

- Source revision: `newapi-failover-claudefix-0819`
- Source commit: `3110d83faa1f722a6a1dc716fdec93ae1b73d32a`
- Source region: GCP `us-east4`
- Source database: `anyrouters-mysql-e4`
- Retired source cache: `anyrouters-redis-prod-e4` (deleted after cutover; cache only)
- Target subscription: `Azure subscription 1`
- Target region: `westus2`
- Target resource group: `rg-anyrouters-prod`

## Safety gates

1. Deploy and validate the Azure stack while GCP remains production.
2. Build the exact locked commit and deploy main and sandbox as separate Container Apps.
3. Import a first database snapshot; perform a final delta import only during the cutover window.
4. Redis is cache/session infrastructure and is not treated as the source of truth. Start with a clean target cache unless a verified migration requirement is recorded.
5. Change the Gemini channel only in the Azure staging database, then test AWS, Azure, Gemini, billing, login, Stripe webhook and sandbox flows.
6. DNS cutover and source retirement are recorded in `CUTOVER_EVIDENCE_20260826.md`.

## Application deployment

- `main.bicep` and `modules/core.bicep` create the isolated production foundation.
- `apps.bicep` deploys the main API/web app and the sandbox as separate Container Apps.
- `db-init-job.bicep` creates the target `newapi` database through the private network before the first application deployment.
- `migration-storage.bicep` creates a temporary private blob container with seven-day retention.
- `db-import-job.bicep` imports a controlled Cloud SQL dump from inside the private Container Apps environment.
- `db-verify-job.bicep` reports aggregate row counts for the imported database without printing records or credentials.
- `migration/Dockerfile` pins the MySQL migration client and its transfer utilities.
- The sandbox remains internal to the Container Apps environment.
- The migration is complete: the main app now serves the four production hostnames through the Azure ingress recorded in `CUTOVER_EVIDENCE_20260826.md`.
- `modules/core.bicep` provisions the production application cache as Redis Enterprise `NoCluster`, which is required for the application's transactional `MULTI`/`EXEC` operations. The original Azure OSS-cluster cache remains labelled as legacy and is not referenced by the production secret.

## Deploy the core stack

Never put passwords in a parameter file or the repository.

```bash
read -s "MYSQL_PASSWORD?MySQL administrator password: "
az deployment sub validate \
  --location westus2 \
  --template-file infra/azure/main.bicep \
  --parameters \
    mysqlAdministratorLogin=anadmin \
    mysqlAdministratorPassword="$MYSQL_PASSWORD" \
    deploymentOperatorObjectId="$(az ad signed-in-user show --query id -o tsv)"

az deployment sub create \
  --location westus2 \
  --name anyrouters-core-$(date +%Y%m%d%H%M%S) \
  --template-file infra/azure/main.bicep \
  --parameters \
    mysqlAdministratorLogin=anadmin \
    mysqlAdministratorPassword="$MYSQL_PASSWORD" \
    deploymentOperatorObjectId="$(az ad signed-in-user show --query id -o tsv)"
unset MYSQL_PASSWORD
```

ACR public access is temporarily enabled only for the first image staging step. After image pull from the private network is verified, redeploy with `acrPublicNetworkAccess=Disabled`.

## Recovery

After source retirement, recovery requires stopping Azure writes, restoring the retained final dump to GCP Cloud SQL, provisioning a compatible Redis and validating the source service before restoring DNS. Never run writes against both databases without an explicit replication design. See `CUTOVER_RUNBOOK.md`.
