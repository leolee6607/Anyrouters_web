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

resource dbVerifyJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'job-anyrouters-db-verify'
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
          name: 'mysql-verifier'
          image: '${registry.properties.loginServer}/tools/mysql:8.0'
          command: [
            'sh'
            '-c'
          ]
          args: [
            'mysql --batch --skip-column-names --ssl-mode=REQUIRED --protocol=TCP -h "$MYSQL_HOST" -u "$MYSQL_USER" --password="$MYSQL_PASSWORD" newapi -e "SELECT CONCAT(\'tables=\', COUNT(*)) FROM information_schema.tables WHERE table_schema=\'newapi\'; SELECT CONCAT(\'users=\', COUNT(*)) FROM users; SELECT CONCAT(\'tokens=\', COUNT(*)) FROM tokens; SELECT CONCAT(\'channels=\', COUNT(*)) FROM channels; SELECT CONCAT(\'enabled_channels=\', COUNT(*)) FROM channels WHERE status=1; SELECT CONCAT(\'models=\', COUNT(*)) FROM models; SELECT CONCAT(\'top_ups=\', COUNT(*)) FROM top_ups; SELECT CONCAT(\'stripe_orders=\', COUNT(*)) FROM stripe_payment_orders; SELECT CONCAT(\'tickets=\', COUNT(*)) FROM tickets; SELECT CONCAT(\'ticket_messages=\', COUNT(*)) FROM ticket_messages; SELECT CONCAT(\'redemptions=\', COUNT(*)) FROM redemptions; SELECT CONCAT(\'options=\', COUNT(*)) FROM options; SELECT CONCAT(\'schema_migrations=\', COUNT(*)) FROM schema_migrations;"'
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
    component: 'database-verification'
    managedBy: 'bicep'
  }
}

output jobName string = dbVerifyJob.name
