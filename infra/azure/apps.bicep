@description('Azure region used by the AN production stack.')
param location string = resourceGroup().location

@description('Existing Container Apps managed environment.')
param containerAppsEnvironmentName string = 'cae-anyrouters-prod'

@description('Existing Azure Container Registry.')
param containerRegistryName string = 'acranyroutersprod'

@description('Existing workload identity used for ACR and Key Vault access.')
param workloadIdentityName string = 'id-anyrouters-prod'

@description('Existing Key Vault containing the migrated application secrets.')
param keyVaultName string

@description('Immutable AN main application image tag deployed to Azure production.')
param mainImageTag string = 'gemini-36-37-5114489-20260826'

@description('Immutable sandbox sidecar image tag imported from the latest GCP production revision.')
param sandboxImageTag string = 'e4-0729'

@description('Revision suffix used for the staging deployment.')
param revisionSuffix string = 'azure-staging-20260825'

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
var commonTags = {
  application: 'anyrouters'
  environment: 'production'
  migrationSource: 'gcp-us-east4'
  managedBy: 'bicep'
}

resource sandbox 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-anyrouters-sandbox'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [
        {
          server: registry.properties.loginServer
          identity: identityId
        }
      ]
      secrets: [
        {
          name: 'e2b-api-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/e2b-api-key'
          identity: identityId
        }
        {
          name: 'sandbox-internal-secret'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/sandbox-internal-secret'
          identity: identityId
        }
      ]
      ingress: {
        external: false
        targetPort: 8080
        transport: 'http'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
    }
    template: {
      revisionSuffix: revisionSuffix
      containers: [
        {
          name: 'sandbox-sidecar'
          image: '${registry.properties.loginServer}/sandbox-sidecar:${sandboxImageTag}'
          env: [
            {
              name: 'E2B_API_KEY'
              secretRef: 'e2b-api-key'
            }
            {
              name: 'INTERNAL_SECRET'
              secretRef: 'sandbox-internal-secret'
            }
          ]
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          probes: [
            {
              type: 'Startup'
              tcpSocket: {
                port: 8080
              }
              initialDelaySeconds: 1
              periodSeconds: 5
              timeoutSeconds: 3
              failureThreshold: 24
            }
            {
              type: 'Liveness'
              tcpSocket: {
                port: 8080
              }
              initialDelaySeconds: 10
              periodSeconds: 10
              timeoutSeconds: 3
              failureThreshold: 6
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 100
        rules: [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: '80'
              }
            }
          }
        ]
      }
    }
  }
  tags: union(commonTags, {
    component: 'sandbox'
  })
}

resource mainApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-anyrouters-web'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [
        {
          server: registry.properties.loginServer
          identity: identityId
        }
      ]
      secrets: [
        {
          name: 'sql-dsn'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/sql-dsn'
          identity: identityId
        }
        {
          name: 'redis-conn-string'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/redis-conn-string'
          identity: identityId
        }
        {
          name: 'session-secret'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/session-secret'
          identity: identityId
        }
        {
          name: 'crypto-secret'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/crypto-secret'
          identity: identityId
        }
        {
          name: 'sandbox-internal-secret'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/sandbox-internal-secret'
          identity: identityId
        }
        {
          name: 'tavily-api-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/tavily-api-key'
          identity: identityId
        }
        {
          name: 'api-key-pepper'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/api-key-pepper'
          identity: identityId
        }
        {
          name: 'stripe-secret-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/stripe-secret-key'
          identity: identityId
        }
        {
          name: 'stripe-webhook-secret'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/stripe-webhook-secret'
          identity: identityId
        }
      ]
      ingress: {
        external: true
        targetPort: 3000
        transport: 'http2'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
    }
    template: {
      revisionSuffix: revisionSuffix
      containers: [
        {
          name: 'new-api'
          image: '${registry.properties.loginServer}/new-api:${mainImageTag}'
          env: [
            {
              name: 'SQL_DSN'
              secretRef: 'sql-dsn'
            }
            {
              name: 'REDIS_CONN_STRING'
              secretRef: 'redis-conn-string'
            }
            {
              name: 'SESSION_SECRET'
              secretRef: 'session-secret'
            }
            {
              name: 'CRYPTO_SECRET'
              secretRef: 'crypto-secret'
            }
            {
              name: 'SANDBOX_INTERNAL_SECRET'
              secretRef: 'sandbox-internal-secret'
            }
            {
              name: 'TAVILY_API_KEY'
              secretRef: 'tavily-api-key'
            }
            {
              name: 'API_KEY_PEPPER'
              secretRef: 'api-key-pepper'
            }
            {
              name: 'STRIPE_SECRET_KEY'
              secretRef: 'stripe-secret-key'
            }
            {
              name: 'STRIPE_WEBHOOK_SECRET'
              secretRef: 'stripe-webhook-secret'
            }
            {
              name: 'SANDBOX_SIDECAR_URL'
              value: 'https://${sandbox.properties.configuration.ingress.fqdn}'
            }
            {
              name: 'TZ'
              value: 'Asia/Shanghai'
            }
            {
              name: 'APP_ENV'
              value: 'production'
            }
            {
              name: 'DEBUG'
              value: 'false'
            }
            {
              name: 'STRIPE_MODE'
              value: 'live'
            }
            {
              name: 'TEMPORARILY_UNAVAILABLE_MODELS'
              value: 'claude-opus-4-8'
            }
            {
              name: 'RESTART_TS'
              value: '20260615-2028'
            }
            {
              name: 'REDIS_MIGRATION_TS'
              value: '20260715-2217'
            }
            {
              name: 'SQL_MIGRATION_TS'
              value: '20260715-2230'
            }
          ]
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          probes: [
            {
              type: 'Startup'
              tcpSocket: {
                port: 3000
              }
              initialDelaySeconds: 1
              periodSeconds: 5
              timeoutSeconds: 3
              failureThreshold: 24
            }
            {
              type: 'Liveness'
              tcpSocket: {
                port: 3000
              }
              initialDelaySeconds: 15
              periodSeconds: 10
              timeoutSeconds: 3
              failureThreshold: 6
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 20
        rules: [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: '80'
              }
            }
          }
        ]
      }
    }
  }
  tags: union(commonTags, {
    component: 'web'
  })
}

output mainAppName string = mainApp.name
output mainAppUrl string = 'https://${mainApp.properties.configuration.ingress.fqdn}'
output sandboxAppName string = sandbox.name
output sandboxAppFqdn string = sandbox.properties.configuration.ingress.fqdn
