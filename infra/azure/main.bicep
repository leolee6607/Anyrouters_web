targetScope = 'subscription'

@description('Azure region used by the AN production stack.')
param location string = 'westus2'

@description('Dedicated resource group for AN. Do not reuse Foundry or OAI-B groups.')
param resourceGroupName string = 'rg-anyrouters-prod'

@description('MySQL administrator login. The password must be supplied securely at deployment time.')
param mysqlAdministratorLogin string

@secure()
@description('MySQL administrator password. Never commit this value.')
param mysqlAdministratorPassword string

@description('Object ID of the operator allowed to seed migration secrets into the new vault.')
param deploymentOperatorObjectId string

@description('Allow public ACR data-plane access while the first production image is staged. Set false after private pull is verified.')
param acrPublicNetworkAccess string = 'Enabled'

resource resourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: {
    application: 'anyrouters'
    environment: 'production'
    migrationSource: 'gcp-us-east4'
    managedBy: 'bicep'
  }
}

module core './modules/core.bicep' = {
  name: 'anyrouters-core'
  scope: resourceGroup
  params: {
    location: location
    mysqlAdministratorLogin: mysqlAdministratorLogin
    mysqlAdministratorPassword: mysqlAdministratorPassword
    deploymentOperatorObjectId: deploymentOperatorObjectId
    acrPublicNetworkAccess: acrPublicNetworkAccess
  }
}

output resourceGroupName string = resourceGroup.name
output containerRegistryName string = core.outputs.containerRegistryName
output containerAppsEnvironmentName string = core.outputs.containerAppsEnvironmentName
output keyVaultName string = core.outputs.keyVaultName
output mysqlServerName string = core.outputs.mysqlServerName
output redisName string = core.outputs.redisName
output redisHostName string = core.outputs.redisHostName
output redisLegacyName string = core.outputs.redisLegacyName
