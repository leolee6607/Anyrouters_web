@description('Existing Container Apps managed environment.')
param containerAppsEnvironmentName string = 'cae-anyrouters-prod'

@description('Existing Azure Container Registry.')
param containerRegistryName string = 'acranyroutersprod'

@description('Existing workload identity used for ACR and Key Vault access.')
param workloadIdentityName string = 'id-anyrouters-prod'

@description('Existing Key Vault containing the database administrator secrets.')
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

resource dbChannelAuditJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'job-anyrouters-db-channel-audit'
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
          name: 'mysql-channel-auditor'
          image: '${registry.properties.loginServer}/tools/mysql:8.0'
          command: [
            'sh'
            '-c'
          ]
          args: [
            'mysql --batch --ssl-mode=REQUIRED --protocol=TCP -h "$MYSQL_HOST" -u "$MYSQL_USER" --password="$MYSQL_PASSWORD" newapi -e "SELECT c.id,c.name,c.type,c.status,c.models,c.group AS channel_group,COALESCE(c.base_url,\'\') AS base_url,c.other,CASE WHEN JSON_VALID(c.settings) THEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(c.settings,\'$.vertex_key_type\')),\'\') ELSE \'\' END AS vertex_key_type,c.used_quota FROM channels AS c ORDER BY c.id;"'
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
    component: 'database-channel-audit'
    managedBy: 'bicep'
  }
}

output jobName string = dbChannelAuditJob.name
