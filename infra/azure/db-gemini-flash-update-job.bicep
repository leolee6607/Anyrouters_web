@description('Existing Container Apps managed environment.')
param containerAppsEnvironmentName string = 'cae-anyrouters-prod'

@description('Existing Azure Container Registry.')
param containerRegistryName string = 'acranyroutersprod'

@description('Existing workload identity used for ACR and Key Vault access.')
param workloadIdentityName string = 'id-anyrouters-prod'

@description('Existing Key Vault containing the database administrator secrets.')
param keyVaultName string

param mysqlHost string = 'anyroutersprodmysql.mysql.database.azure.com'
param vertexChannelId int = 2
@description('Expected GCP Vertex project ID. Supply this explicitly to prevent accidental cross-project updates.')
param expectedVertexProjectId string

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

resource updateJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'job-gemini-flash-update'
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
          name: 'mysql-gemini-flash-updater'
          image: '${registry.properties.loginServer}/tools/mysql:8.0'
          command: [
            'sh'
            '-c'
          ]
          args: [
            '''
set -eu

mysql_query() {
  mysql --batch --raw --skip-column-names --ssl-mode=REQUIRED --protocol=TCP \
    -h "$MYSQL_HOST" -u "$MYSQL_USER" --password="$MYSQL_PASSWORD" newapi -e "$1"
}

channel_count="$(mysql_query "SELECT COUNT(*) FROM channels WHERE id = $VERTEX_CHANNEL_ID AND type = 41 AND status = 1;")"
if [ "$channel_count" != '1' ]; then
  echo "Refusing update: expected one enabled Vertex channel, found $channel_count" >&2
  exit 1
fi

project_id="$(mysql_query "SELECT JSON_UNQUOTE(JSON_EXTRACT(\`key\`, '$.project_id')) FROM channels WHERE id = $VERTEX_CHANNEL_ID AND type = 41;")"
if [ "$project_id" != "$EXPECTED_VERTEX_PROJECT_ID" ]; then
  echo 'Refusing update: the production Vertex channel points to an unexpected project' >&2
  exit 1
fi

baseline_count="$(mysql_query "SELECT COUNT(*) FROM options WHERE (\`key\`='ModelRatio' AND JSON_EXTRACT(value, '$.\"gemini-3.5-flash\"')=0.75) OR (\`key\`='CompletionRatio' AND JSON_EXTRACT(value, '$.\"gemini-3.5-flash\"')=6) OR (\`key\`='CacheRatio' AND JSON_EXTRACT(value, '$.\"gemini-3.5-flash\"')=0.1) OR (\`key\`='GroupModelRatio' AND JSON_EXTRACT(value, '$.\"default\".\"gemini-3.5-flash\"')=0.5 AND JSON_EXTRACT(value, '$.\"btob\".\"gemini-3.5-flash\"')=0.5);" )"
if [ "$baseline_count" != '4' ]; then
  echo "Refusing update: Gemini 3.5 production pricing baseline changed (matched $baseline_count/4)" >&2
  exit 1
fi

mysql --batch --raw --skip-column-names --ssl-mode=REQUIRED --protocol=TCP \
  -h "$MYSQL_HOST" -u "$MYSQL_USER" --password="$MYSQL_PASSWORD" newapi <<'SQL'
START TRANSACTION;

UPDATE channels
   SET models = TRIM(BOTH ',' FROM CONCAT(
         IFNULL(models, ''),
         IF(FIND_IN_SET('gemini-3.6-flash', IFNULL(models, '')) = 0, ',gemini-3.6-flash', ''),
         IF(FIND_IN_SET('gemini-3.7-flash', IFNULL(models, '')) = 0, ',gemini-3.7-flash', '')
       )),
       other = JSON_SET(
         COALESCE(NULLIF(other, ''), JSON_OBJECT()),
         '$."gemini-3.6-flash"', 'global',
         '$."gemini-3.7-flash"', 'global'
       )
 WHERE id = 2 AND type = 41 AND status = 1;

UPDATE options
   SET value = JSON_SET(
         COALESCE(NULLIF(value, ''), JSON_OBJECT()),
         '$."gemini-3.6-flash"', 0.375,
         '$."gemini-3.7-flash"', 0.375
       )
 WHERE `key` = 'ModelRatio';

UPDATE options
   SET value = JSON_SET(
         COALESCE(NULLIF(value, ''), JSON_OBJECT()),
         '$."gemini-3.6-flash"', 5,
         '$."gemini-3.7-flash"', 5
       )
 WHERE `key` = 'CompletionRatio';

UPDATE options
   SET value = JSON_SET(
         COALESCE(NULLIF(value, ''), JSON_OBJECT()),
         '$."gemini-3.6-flash"', 0.1,
         '$."gemini-3.7-flash"', 0.1
       )
 WHERE `key` = 'CacheRatio';

UPDATE options
   SET value = JSON_SET(
         COALESCE(NULLIF(value, ''), JSON_OBJECT()),
         '$."default"."gemini-3.6-flash"', 0.5,
         '$."default"."gemini-3.7-flash"', 0.5,
         '$."btob"."gemini-3.6-flash"', COALESCE(
           JSON_EXTRACT(value, '$."btob"."gemini-3.6-flash"'),
           JSON_EXTRACT(value, '$."btob"."gemini-3.5-flash"'),
           0.5
         ),
         '$."btob"."gemini-3.7-flash"', COALESCE(
           JSON_EXTRACT(value, '$."btob"."gemini-3.7-flash"'),
           JSON_EXTRACT(value, '$."btob"."gemini-3.5-flash"'),
           0.5
         ),
         '$."b2b_16"."gemini-3.6-flash"', COALESCE(
           JSON_EXTRACT(value, '$."b2b_16"."gemini-3.6-flash"'),
           JSON_EXTRACT(value, '$."b2b_16"."gemini-3.5-flash"'),
           JSON_EXTRACT(value, '$."btob"."gemini-3.5-flash"'),
           0.5
         ),
         '$."b2b_16"."gemini-3.7-flash"', COALESCE(
           JSON_EXTRACT(value, '$."b2b_16"."gemini-3.7-flash"'),
           JSON_EXTRACT(value, '$."b2b_16"."gemini-3.5-flash"'),
           JSON_EXTRACT(value, '$."btob"."gemini-3.5-flash"'),
           0.5
         )
       )
 WHERE `key` = 'GroupModelRatio';

-- The model catalogue is backed by abilities, not only channels.models.
-- Clone the serving metadata from the verified Gemini 3.5 baseline so the
-- new models are visible and routable for every existing customer group.
INSERT INTO abilities (`group`, model, channel_id, enabled, priority, weight, tag)
SELECT `group`, 'gemini-3.6-flash', channel_id, enabled, priority, weight, tag
  FROM abilities
 WHERE channel_id = 2 AND model = 'gemini-3.5-flash'
ON DUPLICATE KEY UPDATE
  enabled = VALUES(enabled),
  priority = VALUES(priority),
  weight = VALUES(weight),
  tag = VALUES(tag);

INSERT INTO abilities (`group`, model, channel_id, enabled, priority, weight, tag)
SELECT `group`, 'gemini-3.7-flash', channel_id, enabled, priority, weight, tag
  FROM abilities
 WHERE channel_id = 2 AND model = 'gemini-3.5-flash'
ON DUPLICATE KEY UPDATE
  enabled = VALUES(enabled),
  priority = VALUES(priority),
  weight = VALUES(weight),
  tag = VALUES(tag);

COMMIT;

SELECT 'channel', id, name,
       FIND_IN_SET('gemini-3.6-flash', models) > 0 AS has_36,
       FIND_IN_SET('gemini-3.7-flash', models) > 0 AS has_37,
       JSON_UNQUOTE(JSON_EXTRACT(other, '$."gemini-3.6-flash"')) AS location_36,
       JSON_UNQUOTE(JSON_EXTRACT(other, '$."gemini-3.7-flash"')) AS location_37
  FROM channels
 WHERE id = 2 AND type = 41;

SELECT `key`,
       JSON_EXTRACT(value, '$."gemini-3.6-flash"') AS model_36,
       JSON_EXTRACT(value, '$."gemini-3.7-flash"') AS model_37
  FROM options
 WHERE `key` IN ('ModelRatio', 'CompletionRatio', 'CacheRatio')
 ORDER BY `key`;

SELECT 'GroupModelRatio',
       JSON_EXTRACT(value, '$."default"."gemini-3.6-flash"') AS default_36,
       JSON_EXTRACT(value, '$."default"."gemini-3.7-flash"') AS default_37,
       JSON_EXTRACT(value, '$."btob"."gemini-3.6-flash"') AS btob_36,
       JSON_EXTRACT(value, '$."btob"."gemini-3.7-flash"') AS btob_37,
       JSON_EXTRACT(value, '$."b2b_16"."gemini-3.6-flash"') AS b2b16_36,
       JSON_EXTRACT(value, '$."b2b_16"."gemini-3.7-flash"') AS b2b16_37
  FROM options
 WHERE `key` = 'GroupModelRatio';

SELECT 'ability_counts', model, COUNT(*) AS ability_count
  FROM abilities
 WHERE channel_id = 2
   AND model IN ('gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash')
 GROUP BY model
 ORDER BY model;
SQL
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
    environment: 'production'
    component: 'database-gemini-flash-update'
    managedBy: 'bicep'
  }
}

output jobName string = updateJob.name
