@description('Existing Container Apps managed environment.')
param containerAppsEnvironmentName string = 'cae-anyrouters-prod'

@description('Existing Azure Container Registry.')
param containerRegistryName string = 'acranyroutersprod'

@description('Existing workload identity used for ACR and Key Vault access.')
param workloadIdentityName string = 'id-anyrouters-prod'

@description('Existing Key Vault containing the database administrator secrets.')
param keyVaultName string

param mysqlHost string = 'anyroutersprodmysql.mysql.database.azure.com'

@description('Drop and recreate the newapi database before a controlled import. Keep false for normal initialization.')
param resetDatabase bool = false

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
var databaseStatement = resetDatabase
  ? 'DROP DATABASE IF EXISTS newapi; CREATE DATABASE newapi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;'
  : 'CREATE DATABASE IF NOT EXISTS newapi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;'

resource dbInitJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'job-anyrouters-db-init'
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
      replicaRetryLimit: 1
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
          name: 'mysql-client'
          image: '${registry.properties.loginServer}/tools/mysql:8.0'
          command: [
            'sh'
            '-c'
          ]
          args: [
            'mysql --ssl-mode=REQUIRED --protocol=TCP -h "$MYSQL_HOST" -u "$MYSQL_USER" --password="$MYSQL_PASSWORD" -e "${databaseStatement}"'
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
    environment: 'production'
    component: 'migration'
    managedBy: 'bicep'
  }
}

output jobName string = dbInitJob.name
