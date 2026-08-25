@description('Existing Container Apps managed environment.')
param containerAppsEnvironmentName string = 'cae-anyrouters-prod'

@description('Existing Azure Container Registry.')
param containerRegistryName string = 'acranyroutersprod'

@description('Existing workload identity used for ACR and Key Vault access.')
param workloadIdentityName string = 'id-anyrouters-prod'

@description('Existing Key Vault containing database credentials and the short-lived dump URL.')
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

resource dbImportJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'job-anyrouters-db-import'
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
      replicaTimeout: 1800
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
          name: 'dump-sas-url'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/dump-sas-url'
          identity: identityId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'mysql-importer'
          image: '${registry.properties.loginServer}/tools/mysql-migrate:8.0'
          command: [
            '/bin/bash'
            '-o'
            'pipefail'
            '-c'
          ]
          args: [
            'curl --fail --location --silent --show-error "$DUMP_URL" | gzip -dc | mysql --ssl-mode=REQUIRED --protocol=TCP -h "$MYSQL_HOST" -u "$MYSQL_USER" --password="$MYSQL_PASSWORD" newapi'
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
              name: 'DUMP_URL'
              secretRef: 'dump-sas-url'
            }
          ]
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
        }
      ]
    }
  }
  tags: {
    application: 'anyrouters'
    environment: 'migration'
    component: 'database-import'
    managedBy: 'bicep'
  }
}

output jobName string = dbImportJob.name
