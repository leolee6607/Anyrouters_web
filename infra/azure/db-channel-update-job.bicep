@description('Existing Container Apps managed environment.')
param containerAppsEnvironmentName string = 'cae-anyrouters-prod'

@description('Existing Azure Container Registry.')
param containerRegistryName string = 'acranyroutersprod'

@description('Existing workload identity used for ACR and Key Vault access.')
param workloadIdentityName string = 'id-anyrouters-prod'

@description('Existing Key Vault containing database and Vertex credentials.')
param keyVaultName string

param mysqlHost string = 'anyroutersprodmysql.mysql.database.azure.com'
param vertexChannelId int = 2
param expectedVertexProjectId string = 'anyrouters-vertex-prod-2608'

resource environment 'Microsoft.App/managedEnvironments@2025-07-01' existing = {
  name: containerAppsEnvironmentName
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: containerRegistryName
}

resource workloadIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: workloadIdentityName
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

var identityId = workloadIdentity.id

resource dbChannelUpdateJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'job-anyrouters-db-channel-update'
  location: resourceGroup().location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 600
      replicaRetryLimit: 0
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: identityId
        }
      ]
      secrets: [
        {
          name: 'mysql-admin-login'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/mysql-admin-login'
          identity: identityId
        }
        {
          name: 'mysql-admin-password'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/mysql-admin-password'
          identity: identityId
        }
        {
          name: 'vertex-service-account-json'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/vertex-service-account-json'
          identity: identityId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'mysql-channel-updater'
          image: '${registry.properties.loginServer}/tools/mysql:8.0'
          command: [
            'sh'
            '-c'
          ]
          args: [
            '''
set -eu

ROW_COUNT="$(mysql --batch --skip-column-names --ssl-mode=REQUIRED --protocol=TCP -h "$MYSQL_HOST" -u "$MYSQL_USER" --password="$MYSQL_PASSWORD" newapi -e "SELECT COUNT(*) FROM channels WHERE id = ${VERTEX_CHANNEL_ID} AND type = 41;")"
if [ "$ROW_COUNT" != "1" ]; then
  echo "Refusing update: expected exactly one Vertex channel, found $ROW_COUNT" >&2
  exit 1
fi

PROJECT_ID="$(printf '%s' "$VERTEX_CREDENTIALS" | sed -n 's/.*"project_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
if [ "$PROJECT_ID" != "$EXPECTED_VERTEX_PROJECT_ID" ]; then
  echo "Refusing update: unexpected Vertex project id" >&2
  exit 1
fi

CREDENTIAL_HEX="$(printf '%s' "$VERTEX_CREDENTIALS" | od -An -tx1 | tr -d ' \n')"
IDENTIFIER_QUOTE="$(printf '\140')"
mysql --batch --ssl-mode=REQUIRED --protocol=TCP -h "$MYSQL_HOST" -u "$MYSQL_USER" --password="$MYSQL_PASSWORD" newapi -e "START TRANSACTION; UPDATE channels SET $IDENTIFIER_QUOTE"key"$IDENTIFIER_QUOTE = CONVERT(UNHEX('$CREDENTIAL_HEX') USING utf8mb4) WHERE id = ${VERTEX_CHANNEL_ID} AND type = 41; SELECT ROW_COUNT() AS updated_rows; COMMIT; SELECT id,name,type,status,JSON_UNQUOTE(JSON_EXTRACT($IDENTIFIER_QUOTE"key"$IDENTIFIER_QUOTE,'$.project_id')) AS vertex_project,CASE WHEN JSON_VALID(settings) THEN JSON_UNQUOTE(JSON_EXTRACT(settings,'$.vertex_key_type')) ELSE NULL END AS vertex_key_type FROM channels WHERE id = ${VERTEX_CHANNEL_ID};"
'''
          ]
          env: [
            {
              name: 'MYSQL_HOST'
              value: mysqlHost
            }
            {
              name: 'MYSQL_USER'
              secretRef: 'mysql-admin-login'
            }
            {
              name: 'MYSQL_PASSWORD'
              secretRef: 'mysql-admin-password'
            }
            {
              name: 'VERTEX_CREDENTIALS'
              secretRef: 'vertex-service-account-json'
            }
            {
              name: 'VERTEX_CHANNEL_ID'
              value: string(vertexChannelId)
            }
            {
              name: 'EXPECTED_VERTEX_PROJECT_ID'
              value: expectedVertexProjectId
            }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
    }
  }
  tags: {
    application: 'anyrouters'
    environment: 'migration'
    component: 'database-channel-update'
    managedBy: 'bicep'
  }
}

output jobName string = dbChannelUpdateJob.name
