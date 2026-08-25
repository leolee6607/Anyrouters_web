@description('Existing Container Apps managed environment.')
param containerAppsEnvironmentName string = 'cae-anyrouters-prod'

@description('Existing Azure Container Registry.')
param containerRegistryName string = 'acranyroutersprod'

@description('Existing workload identity used for ACR and Key Vault access.')
param workloadIdentityName string = 'id-anyrouters-prod'

@description('Existing Key Vault containing database credentials.')
param keyVaultName string

param mysqlHost string = 'anyroutersprodmysql.mysql.database.azure.com'
@description('Public production API base URL used by the post-cutover provider smoke test.')
param apiBaseUrl string = 'https://api.anyrouters.com'

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

resource apiSmokeJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'job-anyrouters-api-smoke'
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
      ]
    }
    template: {
      containers: [
        {
          name: 'api-smoke-tester'
          image: '${registry.properties.loginServer}/tools/mysql-migrate:8.0'
          command: [
            'sh'
            '-c'
          ]
          args: [
            '''
set -eu

TOKEN_KEY="$(mysql --batch --skip-column-names --ssl-mode=REQUIRED --protocol=TCP -h "$MYSQL_HOST" -u "$MYSQL_USER" --password="$MYSQL_PASSWORD" newapi -e "SELECT t.key FROM tokens AS t INNER JOIN users AS u ON u.id=t.user_id WHERE t.status=1 AND u.role>=100 ORDER BY t.unlimited_quota DESC,t.remain_quota DESC,t.id ASC LIMIT 1;")"
if [ -z "$TOKEN_KEY" ]; then
  echo "No enabled administrator token is available for smoke tests" >&2
  exit 1
fi

case "$TOKEN_KEY" in
  sk-*) API_TOKEN="$TOKEN_KEY" ;;
  *) API_TOKEN="sk-$TOKEN_KEY" ;;
esac

models_file='/tmp/models.json'
models_status="$(curl --connect-timeout 20 --max-time 180 --silent --show-error --output "$models_file" --write-out '%{http_code}' \
  -H "Authorization: Bearer $API_TOKEN" \
  "$API_BASE_URL/v1/models")"
case "$models_status" in
  2??) ;;
  *)
    echo "model catalog failed status=$models_status" >&2
    head -c 600 "$models_file" >&2
    echo >&2
    exit 1
    ;;
esac

expected_models='gemini-3-pro-image gemini-3.1-flash-image gemini-3.1-flash-lite gemini-3.1-flash-lite-image gemini-3.1-pro-preview gemini-3.5-flash gemini-omni-flash-preview imagen-4.0-fast-generate-001 imagen-4.0-generate-001 veo-3.0-generate-001 veo-3.1-fast-generate-001 veo-3.1-generate-001 gpt-5.4 gpt-5.5 gpt-5.3-codex gpt-5.2 gpt-5.4-mini gpt-5.6-sol gpt-5.6-terra gpt-5.6-luna gpt-image-2 gpt-5.4-pro claude-opus-4-6 claude-haiku-4-5 claude-sonnet-4-6'
model_count=0
for model in $expected_models; do
  if ! grep -Eq "\"id\"[[:space:]]*:[[:space:]]*\"$model\"" "$models_file"; then
    echo "model catalog is missing expected enabled model: $model" >&2
    exit 1
  fi
  model_count=$((model_count + 1))
done
echo "model_catalog status=$models_status expected_enabled_models=$model_count"

run_case() {
  label="$1"
  path="$2"
  payload="$3"
  response_file="/tmp/${label}.json"
  status="$(curl --connect-timeout 20 --max-time 180 --silent --show-error --output "$response_file" --write-out '%{http_code}' \
    -H "Authorization: Bearer $API_TOKEN" \
    -H 'Content-Type: application/json' \
    --data "$payload" \
    "$API_BASE_URL$path")"
  echo "$label status=$status bytes=$(wc -c < "$response_file" | tr -d ' ')"
  case "$status" in
    2??) ;;
    *)
      echo "$label failed; response excerpt follows" >&2
      head -c 600 "$response_file" >&2
      echo >&2
      return 1
      ;;
  esac
}

run_video_case() {
  label='vertex_video'
  response_file="/tmp/${label}-submit.json"
  status="$(curl --connect-timeout 20 --max-time 180 --silent --show-error --output "$response_file" --write-out '%{http_code}' \
    -H "Authorization: Bearer $API_TOKEN" \
    -H 'Content-Type: application/json' \
    --data '{"model":"veo-3.1-fast-generate-001","prompt":"A solid blue circle remains centered on a plain white background, static camera, no text.","duration":4,"size":"1280x720"}' \
    "$API_BASE_URL/v1/videos")"
  echo "$label submit_status=$status bytes=$(wc -c < "$response_file" | tr -d ' ')"
  case "$status" in
    2??) ;;
    *)
      echo "$label submit failed; response excerpt follows" >&2
      head -c 600 "$response_file" >&2
      echo >&2
      return 1
      ;;
  esac

  task_id="$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' "$response_file")"
  if [ -z "$task_id" ]; then
    task_id="$(sed -n 's/.*"task_id":"\([^"]*\)".*/\1/p' "$response_file")"
  fi
  if [ -z "$task_id" ]; then
    echo "$label response did not include a task id" >&2
    head -c 600 "$response_file" >&2
    echo >&2
    return 1
  fi

  poll_file="/tmp/${label}-poll.json"
  attempt=1
  while [ "$attempt" -le 60 ]; do
    poll_status="$(curl --connect-timeout 20 --max-time 180 --silent --show-error --output "$poll_file" --write-out '%{http_code}' \
      -H "Authorization: Bearer $API_TOKEN" \
      "$API_BASE_URL/v1/videos/$task_id")"
    case "$poll_status" in
      2??) ;;
      *)
        echo "$label poll failed status=$poll_status" >&2
        head -c 600 "$poll_file" >&2
        echo >&2
        return 1
        ;;
    esac
    if grep -q '"status":"completed"' "$poll_file"; then
      echo "$label completed attempt=$attempt"
      break
    fi
    if grep -q '"status":"failed"' "$poll_file"; then
      echo "$label generation failed" >&2
      head -c 600 "$poll_file" >&2
      echo >&2
      return 1
    fi
    if [ "$attempt" -eq 60 ]; then
      echo "$label did not complete within 10 minutes" >&2
      head -c 600 "$poll_file" >&2
      echo >&2
      return 1
    fi
    attempt=$((attempt + 1))
    sleep 10
  done

  content_file="/tmp/${label}.bin"
  content_status="$(curl --connect-timeout 20 --max-time 180 --silent --show-error --range 0-31 --output "$content_file" --write-out '%{http_code}' \
    -H "Authorization: Bearer $API_TOKEN" \
    "$API_BASE_URL/v1/videos/$task_id/content")"
  case "$content_status" in
    2??) ;;
    *)
      echo "$label content fetch failed status=$content_status" >&2
      head -c 600 "$content_file" >&2
      echo >&2
      return 1
      ;;
  esac
  if [ ! -s "$content_file" ]; then
    echo "$label content fetch returned an empty body" >&2
    return 1
  fi
  echo "$label content_status=$content_status bytes=$(wc -c < "$content_file" | tr -d ' ')"
}

run_case vertex /v1/chat/completions '{"model":"gemini-3.5-flash","messages":[{"role":"user","content":"Reply OK"}],"max_tokens":8,"stream":false}'
run_case vertex_flash_image /v1/chat/completions '{"model":"gemini-3.1-flash-image","messages":[{"role":"user","content":"Generate exactly one small blue circle centered on a plain white background."}],"stream":false,"extra_body":{"google":{"image_config":{"aspect_ratio":"1:1","image_size":"1K"}}}}'
run_case vertex_pro_image /v1/chat/completions '{"model":"gemini-3-pro-image","messages":[{"role":"user","content":"Generate exactly one small blue circle centered on a plain white background."}],"stream":false,"extra_body":{"google":{"image_config":{"aspect_ratio":"1:1","image_size":"1K"}}}}'
run_video_case
run_case claude /v1/chat/completions '{"model":"claude-haiku-4-5","messages":[{"role":"user","content":"Reply OK"}],"max_tokens":8,"stream":false}'
run_case azure /v1/responses '{"model":"gpt-5.4-mini","input":"Reply OK","max_output_tokens":16,"stream":false}'

echo "All upstream smoke tests passed"
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
              name: 'API_BASE_URL'
              value: apiBaseUrl
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
    component: 'api-smoke-test'
    managedBy: 'bicep'
  }
}

output jobName string = apiSmokeJob.name
