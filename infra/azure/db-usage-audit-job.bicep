@description('Existing Container Apps managed environment.')
param containerAppsEnvironmentName string = 'cae-anyrouters-prod'

@description('Existing Azure Container Registry.')
param containerRegistryName string = 'acranyroutersprod'

@description('Existing workload identity used for ACR and Key Vault access.')
param workloadIdentityName string = 'id-anyrouters-prod'

@description('Existing Key Vault containing database credentials.')
param keyVaultName string

param mysqlHost string = 'anyroutersprodmysql.mysql.database.azure.com'

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

resource dbUsageAuditJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'job-anyrouters-db-usage-audit'
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
      ]
    }
    template: {
      containers: [
        {
          name: 'mysql-usage-auditor'
          image: '${registry.properties.loginServer}/tools/mysql:8.0'
          command: [
            'sh'
            '-c'
          ]
          args: [
            '''
set -eu

echo '=== Vertex channel 2 usage by model ==='
mysql --batch --ssl-mode=REQUIRED --protocol=TCP -h "$MYSQL_HOST" -u "$MYSQL_USER" --password="$MYSQL_PASSWORD" newapi -e "SELECT model_name,type,COUNT(*) AS request_count,FROM_UNIXTIME(MIN(created_at)) AS first_seen,FROM_UNIXTIME(MAX(created_at)) AS last_seen,SUM(quota) AS quota,SUM(prompt_tokens) AS prompt_tokens,SUM(completion_tokens) AS completion_tokens FROM logs WHERE channel_id=2 GROUP BY model_name,type ORDER BY model_name,type;"

echo '=== Imagen usage across all channels ==='
mysql --batch --ssl-mode=REQUIRED --protocol=TCP -h "$MYSQL_HOST" -u "$MYSQL_USER" --password="$MYSQL_PASSWORD" newapi -e "SELECT channel_id,model_name,type,COUNT(*) AS request_count,FROM_UNIXTIME(MIN(created_at)) AS first_seen,FROM_UNIXTIME(MAX(created_at)) AS last_seen,SUM(quota) AS quota FROM logs WHERE model_name LIKE 'imagen-%' GROUP BY channel_id,model_name,type ORDER BY channel_id,model_name,type;"
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
    component: 'database-usage-audit'
    managedBy: 'bicep'
  }
}

output jobName string = dbUsageAuditJob.name
