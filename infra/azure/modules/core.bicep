@description('Azure region used by the AN production stack.')
param location string

param mysqlAdministratorLogin string

@secure()
param mysqlAdministratorPassword string

param deploymentOperatorObjectId string

@allowed([
  'Enabled'
  'Disabled'
])
param acrPublicNetworkAccess string = 'Enabled'

var suffix = uniqueString(subscription().id, resourceGroup().id)
var vnetName = 'vnet-anyrouters-prod'
var logAnalyticsName = 'log-anyrouters-prod'
var containerAppsEnvironmentName = 'cae-anyrouters-prod'
var containerRegistryName = 'acranyroutersprod'
var keyVaultName = 'kv-anyrouters-${take(suffix, 8)}'
var mysqlServerName = 'anyroutersprodmysql'
var redisLegacyName = 'anyrouters-prod-redis'
var redisName = 'anyrouters-prod-redis-app'

resource virtualNetwork 'Microsoft.Network/virtualNetworks@2024-07-01' = {
  name: vnetName
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.42.0.0/16'
      ]
    }
    subnets: [
      {
        name: 'snet-container-apps'
        properties: {
          addressPrefix: '10.42.0.0/23'
          delegations: [
            {
              name: 'Microsoft.App.environments'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: 'snet-mysql'
        properties: {
          addressPrefix: '10.42.2.0/24'
          delegations: [
            {
              name: 'Microsoft.DBforMySQL.flexibleServers'
              properties: {
                serviceName: 'Microsoft.DBforMySQL/flexibleServers'
              }
            }
          ]
        }
      }
      {
        name: 'snet-private-endpoints'
        properties: {
          addressPrefix: '10.42.3.0/24'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
  tags: {
    application: 'anyrouters'
    environment: 'production'
  }
}

resource containerAppsSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-07-01' existing = {
  name: 'snet-container-apps'
  parent: virtualNetwork
}

resource mysqlSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-07-01' existing = {
  name: 'snet-mysql'
  parent: virtualNetwork
}

resource privateEndpointSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-07-01' existing = {
  name: 'snet-private-endpoints'
  parent: virtualNetwork
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
  tags: {
    application: 'anyrouters'
    environment: 'production'
  }
}

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: containerRegistryName
  location: location
  sku: {
    name: 'Premium'
  }
  properties: {
    adminUserEnabled: false
    dataEndpointEnabled: false
    publicNetworkAccess: acrPublicNetworkAccess
    networkRuleBypassOptions: 'AzureServices'
    policies: {
      quarantinePolicy: {
        status: 'disabled'
      }
      retentionPolicy: {
        days: 7
        status: 'enabled'
      }
      trustPolicy: {
        status: 'disabled'
        type: 'Notary'
      }
    }
  }
  tags: {
    application: 'anyrouters'
    environment: 'production'
  }
}

resource workloadIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-anyrouters-prod'
  location: location
  tags: {
    application: 'anyrouters'
    environment: 'production'
  }
}

resource acrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(containerRegistry.id, workloadIdentity.id, 'acrpull')
  scope: containerRegistry
  properties: {
    principalId: workloadIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enablePurgeProtection: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
  tags: {
    application: 'anyrouters'
    environment: 'production'
  }
}

resource keyVaultSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, workloadIdentity.id, 'key-vault-secrets-user')
  scope: keyVault
  properties: {
    principalId: workloadIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
  }
}

resource keyVaultOperatorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, deploymentOperatorObjectId, 'key-vault-secrets-officer')
  scope: keyVault
  properties: {
    principalId: deploymentOperatorObjectId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7')
  }
}

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2025-07-01' = {
  name: containerAppsEnvironmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: containerAppsSubnet.id
      internal: false
    }
    zoneRedundant: true
  }
  tags: {
    application: 'anyrouters'
    environment: 'production'
  }
}

resource mysqlPrivateDnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'private.mysql.database.azure.com'
  location: 'global'
}

resource mysqlPrivateDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  name: 'link-${vnetName}'
  parent: mysqlPrivateDnsZone
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: virtualNetwork.id
    }
  }
}

resource mysqlServer 'Microsoft.DBforMySQL/flexibleServers@2024-12-30' = {
  name: mysqlServerName
  location: location
  sku: {
    name: 'Standard_D2ds_v4'
    tier: 'GeneralPurpose'
  }
  properties: {
    administratorLogin: mysqlAdministratorLogin
    administratorLoginPassword: mysqlAdministratorPassword
    version: '8.0.21'
    availabilityZone: '1'
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'ZoneRedundant'
      standbyAvailabilityZone: '2'
    }
    network: {
      delegatedSubnetResourceId: mysqlSubnet.id
      privateDnsZoneResourceId: mysqlPrivateDnsZone.id
    }
    storage: {
      autoGrow: 'Enabled'
      storageSizeGB: 32
    }
  }
  tags: {
    application: 'anyrouters'
    environment: 'production'
  }
  dependsOn: [
    mysqlPrivateDnsLink
  ]
}

// Retained during the rollback window. The application no longer uses this
// OSSCluster database because the current go-redis client is non-clustered.
resource redisLegacy 'Microsoft.Cache/redisEnterprise@2025-07-01' = {
  name: redisLegacyName
  location: location
  sku: {
    name: 'Balanced_B1'
  }
  properties: {
    encryption: {}
    highAvailability: 'Enabled'
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'
  }
  tags: {
    application: 'anyrouters'
    environment: 'production'
  }
}

resource redisLegacyDatabase 'Microsoft.Cache/redisEnterprise/databases@2025-07-01' = {
  name: 'default'
  parent: redisLegacy
  properties: {
    accessKeysAuthentication: 'Enabled'
    clientProtocol: 'Encrypted'
    clusteringPolicy: 'OSSCluster'
    evictionPolicy: 'AllKeysLRU'
    modules: []
    port: 10000
  }
}

// Production-compatible cache for the current new-api code path. NoCluster
// preserves Redis MULTI/TxPipeline semantics and avoids MOVED responses.
resource redis 'Microsoft.Cache/redisEnterprise@2025-07-01' = {
  name: redisName
  location: location
  sku: {
    name: 'Balanced_B1'
  }
  properties: {
    encryption: {}
    highAvailability: 'Enabled'
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'
  }
  tags: {
    application: 'anyrouters'
    environment: 'production'
    purpose: 'application-cache'
    compatibility: 'go-redis-v9'
  }
}

resource redisDatabase 'Microsoft.Cache/redisEnterprise/databases@2025-07-01' = {
  name: 'default'
  parent: redis
  properties: {
    accessKeysAuthentication: 'Enabled'
    clientProtocol: 'Encrypted'
    clusteringPolicy: 'NoCluster'
    evictionPolicy: 'AllKeysLRU'
    modules: []
    port: 10000
  }
}

resource redisPrivateDnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.redis.azure.net'
  location: 'global'
}

resource redisPrivateDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  name: 'link-${vnetName}'
  parent: redisPrivateDnsZone
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: virtualNetwork.id
    }
  }
}

resource redisLegacyPrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-07-01' = {
  name: 'pe-${redisLegacyName}'
  location: location
  properties: {
    privateLinkServiceConnections: [
      {
        name: 'redisEnterprise'
        properties: {
          privateLinkServiceId: redisLegacy.id
          groupIds: [
            'redisEnterprise'
          ]
        }
      }
    ]
    subnet: {
      id: privateEndpointSubnet.id
    }
  }
  dependsOn: [
    redisLegacyDatabase
  ]
}

resource redisLegacyPrivateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-07-01' = {
  name: 'default'
  parent: redisLegacyPrivateEndpoint
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'redis'
        properties: {
          privateDnsZoneId: redisPrivateDnsZone.id
        }
      }
    ]
  }
  dependsOn: [
    redisPrivateDnsLink
  ]
}

resource redisPrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-07-01' = {
  name: 'pe-${redisName}'
  location: location
  properties: {
    privateLinkServiceConnections: [
      {
        name: 'redisEnterprise'
        properties: {
          privateLinkServiceId: redis.id
          groupIds: [
            'redisEnterprise'
          ]
        }
      }
    ]
    subnet: {
      id: privateEndpointSubnet.id
    }
  }
  dependsOn: [
    redisDatabase
  ]
}

resource redisPrivateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-07-01' = {
  name: 'default'
  parent: redisPrivateEndpoint
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'redis'
        properties: {
          privateDnsZoneId: redisPrivateDnsZone.id
        }
      }
    ]
  }
  dependsOn: [
    redisPrivateDnsLink
  ]
}

output containerRegistryName string = containerRegistry.name
output containerAppsEnvironmentName string = containerAppsEnvironment.name
output workloadIdentityId string = workloadIdentity.id
output keyVaultName string = keyVault.name
output mysqlServerName string = mysqlServer.name
output mysqlFullyQualifiedDomainName string = mysqlServer.properties.fullyQualifiedDomainName
output redisName string = redis.name
output redisHostName string = '${redis.name}.${location}.redis.azure.net'
output redisPort int = 10000
output redisLegacyName string = redisLegacy.name
