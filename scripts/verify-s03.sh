#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

required_files=(
  "README.md"
  ".env.example"
  "compose.yaml"
  "Makefile"
  "frontend/lib/catalog.ts"
  "frontend/app/auth-shell.tsx"
  "backend/app/api/routes/catalog.py"
)

for path in "${required_files[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing required file: $path" >&2
    exit 1
  fi
done

if ! grep -q "verify-s03" README.md; then
  echo "README.md must document verify-s03 workflow." >&2
  exit 1
fi

TEMP_ENV_CREATED=0
if [[ ! -f .env ]]; then
  cp .env.example .env
  TEMP_ENV_CREATED=1
fi

COOKIE_JAR=""
LOGIN_HEADERS=""
LOGIN_BODY=""
USERS_BODY=""
APPS_BODY=""
PROJECTS_BODY=""
ENVIRONMENTS_BODY=""
RESOURCES_BODY=""
APP_CREATE_HEADERS=""
APP_CREATE_BODY=""
PROJECT_CREATE_HEADERS=""
PROJECT_CREATE_BODY=""
ENVIRONMENT_CREATE_HEADERS=""
ENVIRONMENT_CREATE_BODY=""
RESOURCE_CREATE_HEADERS=""
RESOURCE_CREATE_BODY=""
MISSING_PROJECT_HEADERS=""
MISSING_PROJECT_BODY=""
SCOPE_MISMATCH_HEADERS=""
SCOPE_MISMATCH_BODY=""
SECRET_FORBIDDEN_HEADERS=""
SECRET_FORBIDDEN_BODY=""

cleanup() {
  rm -f \
    "$COOKIE_JAR" \
    "$LOGIN_HEADERS" \
    "$LOGIN_BODY" \
    "$USERS_BODY" \
    "$APPS_BODY" \
    "$PROJECTS_BODY" \
    "$ENVIRONMENTS_BODY" \
    "$RESOURCES_BODY" \
    "$APP_CREATE_HEADERS" \
    "$APP_CREATE_BODY" \
    "$PROJECT_CREATE_HEADERS" \
    "$PROJECT_CREATE_BODY" \
    "$ENVIRONMENT_CREATE_HEADERS" \
    "$ENVIRONMENT_CREATE_BODY" \
    "$RESOURCE_CREATE_HEADERS" \
    "$RESOURCE_CREATE_BODY" \
    "$MISSING_PROJECT_HEADERS" \
    "$MISSING_PROJECT_BODY" \
    "$SCOPE_MISMATCH_HEADERS" \
    "$SCOPE_MISMATCH_BODY" \
    "$SECRET_FORBIDDEN_HEADERS" \
    "$SECRET_FORBIDDEN_BODY"
  if [[ "$TEMP_ENV_CREATED" -eq 1 ]]; then
    rm -f .env
  fi
}
trap cleanup EXIT

print_infra_failure() {
  local message="$1"
  echo "$message" >&2
  echo "Infrastructure gating diagnostic follows." >&2
  docker compose ps >&2 || true
  docker compose logs --tail=50 postgres backend frontend >&2 || true
}

print_service_logs() {
  echo "Recent backend logs:" >&2
  docker compose logs --tail=50 backend >&2 || true
  echo "Recent frontend logs:" >&2
  docker compose logs --tail=50 frontend >&2 || true
  echo "Recent postgres logs:" >&2
  docker compose logs --tail=50 postgres >&2 || true
}

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not installed; cannot run compose-backed verification." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "docker daemon unavailable; start Docker before running compose-backed verification. This is infrastructure gating, not a product failure." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for catalog verification." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required for catalog verification." >&2
  exit 1
fi

echo "==> Rendering compose configuration"
docker compose config >/dev/null

echo "==> Inspecting service state"
docker compose ps

wait_for_service_health() {
  local service="$1"
  local timeout_seconds="${2:-120}"
  local start_ts
  start_ts="$(date +%s)"

  while true; do
    service_json="$(docker compose ps --format json "$service" 2>/dev/null || true)"
    if [[ -z "$service_json" ]]; then
      print_infra_failure "$service service is not running under docker compose."
      return 1
    fi

    service_health="$(printf '%s\n' "$service_json" | python3 -c 'import json,sys
rows=[json.loads(line) for line in sys.stdin if line.strip()]
if not rows:
    raise SystemExit(1)
print(rows[0].get("Health", ""))')"
    if [[ "$service_health" == "healthy" ]]; then
      return 0
    fi

    if (( $(date +%s) - start_ts >= timeout_seconds )); then
      print_infra_failure "$service service is not healthy (status: ${service_health:-unknown})."
      return 1
    fi

    sleep 2
  done
}

for service in postgres backend frontend; do
  wait_for_service_health "$service"
done

backend_url="http://127.0.0.1:${BACKEND_PORT:-8000}/api/v1"
COOKIE_JAR="$(mktemp)"
LOGIN_HEADERS="$(mktemp)"
LOGIN_BODY="$(mktemp)"
USERS_BODY="$(mktemp)"
APPS_BODY="$(mktemp)"
PROJECTS_BODY="$(mktemp)"
ENVIRONMENTS_BODY="$(mktemp)"
RESOURCES_BODY="$(mktemp)"
APP_CREATE_HEADERS="$(mktemp)"
APP_CREATE_BODY="$(mktemp)"
PROJECT_CREATE_HEADERS="$(mktemp)"
PROJECT_CREATE_BODY="$(mktemp)"
ENVIRONMENT_CREATE_HEADERS="$(mktemp)"
ENVIRONMENT_CREATE_BODY="$(mktemp)"
RESOURCE_CREATE_HEADERS="$(mktemp)"
RESOURCE_CREATE_BODY="$(mktemp)"
MISSING_PROJECT_HEADERS="$(mktemp)"
MISSING_PROJECT_BODY="$(mktemp)"
SCOPE_MISMATCH_HEADERS="$(mktemp)"
SCOPE_MISMATCH_BODY="$(mktemp)"
SECRET_FORBIDDEN_HEADERS="$(mktemp)"
SECRET_FORBIDDEN_BODY="$(mktemp)"
CORRELATION_ID="verify-s03-$(date +%s)"
APP_NAME="Billing ${CORRELATION_ID}"
PROJECT_NAME="Payments ${CORRELATION_ID}"
ENVIRONMENT_NAME="Staging ${CORRELATION_ID}"
RESOURCE_NAME="Queue ${CORRELATION_ID}"

echo "==> Logging in with bootstrap operator"
login_payload="$(python3 - <<'PY'
import json
import os
print(json.dumps({
    "email": os.environ.get("AUTH_BOOTSTRAP_ADMIN_EMAIL", "admin@passark.local"),
    "password": os.environ.get("AUTH_BOOTSTRAP_ADMIN_PASSWORD", "change-me-now"),
}))
PY
)"
curl --silent --show-error \
  --cookie-jar "$COOKIE_JAR" \
  --output "$LOGIN_BODY" \
  --dump-header "$LOGIN_HEADERS" \
  --header 'Content-Type: application/json' \
  --data "$login_payload" \
  "${backend_url}/auth/login"
login_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$LOGIN_HEADERS")"
if [[ "$login_status" != "200" ]]; then
  echo "Expected login to succeed; got ${login_status:-unknown}." >&2
  cat "$LOGIN_HEADERS" >&2
  cat "$LOGIN_BODY" >&2
  print_service_logs
  exit 1
fi

echo "==> Listing catalog users for downstream scope checks"
curl --fail --silent --show-error --cookie "$COOKIE_JAR" "${backend_url}/catalog/users" > "$USERS_BODY"
CATALOG_USER_ID="$(python3 - "$USERS_BODY" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
items = payload.get("items", [])
if not items:
    raise SystemExit("No catalog users exist; create one via the operator workspace before running verify-s03.")
print(items[0]["id"])
PY
)"

echo "==> Creating an application"
app_payload="$(python3 - <<PY
import json
print(json.dumps({
    "name": ${APP_NAME@Q},
    "description": "Verification application created by verify-s03",
}))
PY
)"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$APP_CREATE_BODY" \
  --dump-header "$APP_CREATE_HEADERS" \
  --header 'Content-Type: application/json' \
  --data "$app_payload" \
  "${backend_url}/catalog/apps"
app_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$APP_CREATE_HEADERS")"
if [[ "$app_status" != "201" ]]; then
  echo "Expected application create to succeed; got ${app_status:-unknown}." >&2
  cat "$APP_CREATE_HEADERS" >&2
  cat "$APP_CREATE_BODY" >&2
  print_service_logs
  exit 1
fi
APP_ID="$(python3 - "$APP_CREATE_BODY" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
print(payload["app"]["id"])
PY
)"

echo "==> Creating a project under the new application"
project_payload="$(python3 - <<PY
import json
print(json.dumps({
    "app_id": ${APP_ID@Q},
    "name": ${PROJECT_NAME@Q},
    "description": "Verification project created by verify-s03",
}))
PY
)"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$PROJECT_CREATE_BODY" \
  --dump-header "$PROJECT_CREATE_HEADERS" \
  --header 'Content-Type: application/json' \
  --data "$project_payload" \
  "${backend_url}/catalog/projects"
project_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$PROJECT_CREATE_HEADERS")"
if [[ "$project_status" != "201" ]]; then
  echo "Expected project create to succeed; got ${project_status:-unknown}." >&2
  cat "$PROJECT_CREATE_HEADERS" >&2
  cat "$PROJECT_CREATE_BODY" >&2
  print_service_logs
  exit 1
fi
PROJECT_ID="$(python3 - "$PROJECT_CREATE_BODY" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
print(payload["project"]["id"])
PY
)"

echo "==> Creating an environment under the new project"
environment_payload="$(python3 - <<PY
import json
print(json.dumps({
    "project_id": ${PROJECT_ID@Q},
    "name": ${ENVIRONMENT_NAME@Q},
    "description": "Verification environment created by verify-s03",
}))
PY
)"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$ENVIRONMENT_CREATE_BODY" \
  --dump-header "$ENVIRONMENT_CREATE_HEADERS" \
  --header 'Content-Type: application/json' \
  --data "$environment_payload" \
  "${backend_url}/catalog/environments"
environment_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$ENVIRONMENT_CREATE_HEADERS")"
if [[ "$environment_status" != "201" ]]; then
  echo "Expected environment create to succeed; got ${environment_status:-unknown}." >&2
  cat "$ENVIRONMENT_CREATE_HEADERS" >&2
  cat "$ENVIRONMENT_CREATE_BODY" >&2
  print_service_logs
  exit 1
fi
ENVIRONMENT_ID="$(python3 - "$ENVIRONMENT_CREATE_BODY" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
print(payload["environment"]["id"])
PY
)"

echo "==> Creating a typed resource with descriptive metadata only"
resource_payload="$(python3 - <<PY
import json
print(json.dumps({
    "name": ${RESOURCE_NAME@Q},
    "resource_type": "queue",
    "container_type": "environment",
    "container_id": ${ENVIRONMENT_ID@Q},
    "scope_type": "organization",
    "scope_id": "org_123",
    "description": "Verification resource created by verify-s03",
    "metadata": {
        "owner": "platform",
        "rotation": "manual"
    }
}))
PY
)"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$RESOURCE_CREATE_BODY" \
  --dump-header "$RESOURCE_CREATE_HEADERS" \
  --header 'Content-Type: application/json' \
  --data "$resource_payload" \
  "${backend_url}/catalog/resources"
resource_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$RESOURCE_CREATE_HEADERS")"
if [[ "$resource_status" != "201" ]]; then
  echo "Expected resource create to succeed; got ${resource_status:-unknown}." >&2
  cat "$RESOURCE_CREATE_HEADERS" >&2
  cat "$RESOURCE_CREATE_BODY" >&2
  print_service_logs
  exit 1
fi
RESOURCE_ID="$(python3 - "$RESOURCE_CREATE_BODY" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
print(payload["resource"]["id"])
PY
)"

echo "==> Reading the hierarchy back from list endpoints"
curl --fail --silent --show-error --cookie "$COOKIE_JAR" "${backend_url}/catalog/apps" > "$APPS_BODY"
curl --fail --silent --show-error --cookie "$COOKIE_JAR" "${backend_url}/catalog/projects" > "$PROJECTS_BODY"
curl --fail --silent --show-error --cookie "$COOKIE_JAR" "${backend_url}/catalog/environments" > "$ENVIRONMENTS_BODY"
curl --fail --silent --show-error --cookie "$COOKIE_JAR" "${backend_url}/catalog/resources" > "$RESOURCES_BODY"

python3 - "$APPS_BODY" "$PROJECTS_BODY" "$ENVIRONMENTS_BODY" "$RESOURCES_BODY" "$APP_ID" "$PROJECT_ID" "$ENVIRONMENT_ID" "$RESOURCE_ID" <<'PY'
import json
import sys
from pathlib import Path

apps = json.loads(Path(sys.argv[1]).read_text())["items"]
projects = json.loads(Path(sys.argv[2]).read_text())["items"]
environments = json.loads(Path(sys.argv[3]).read_text())["items"]
resources = json.loads(Path(sys.argv[4]).read_text())["items"]
app_id, project_id, environment_id, resource_id = sys.argv[5:9]

assert any(item["id"] == app_id for item in apps), apps
assert any(item["id"] == project_id and item["app_id"] == app_id for item in projects), projects
assert any(item["id"] == environment_id and item["project_id"] == project_id for item in environments), environments
assert any(
    item["id"] == resource_id
    and item["environment_id"] == environment_id
    and item["project_id"] == project_id
    and item["app_id"] == app_id
    and item["metadata"] == {"owner": "platform", "rotation": "manual"}
    for item in resources
), resources
PY

echo "==> Verifying missing-parent failures stay machine-readable"
missing_project_payload='{"project_id":"proj_missing","name":"Broken","description":"Should fail"}'
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$MISSING_PROJECT_BODY" \
  --dump-header "$MISSING_PROJECT_HEADERS" \
  --header 'Content-Type: application/json' \
  --data "$missing_project_payload" \
  "${backend_url}/catalog/environments"
missing_project_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$MISSING_PROJECT_HEADERS")"
if [[ "$missing_project_status" != "404" ]]; then
  echo "Expected missing-parent environment create to return 404; got ${missing_project_status:-unknown}." >&2
  cat "$MISSING_PROJECT_HEADERS" >&2
  cat "$MISSING_PROJECT_BODY" >&2
  print_service_logs
  exit 1
fi
printf '%s' "$(cat "$MISSING_PROJECT_BODY")" | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert payload["detail"]["code"] == "project_not_found"'

echo "==> Verifying scope-mismatch failures stay machine-readable"
scope_mismatch_payload="$(python3 - <<PY
import json
print(json.dumps({
    "name": "Scope mismatch ${CORRELATION_ID}",
    "resource_type": "queue",
    "container_type": "environment",
    "container_id": ${ENVIRONMENT_ID@Q},
    "scope_type": "team",
    "scope_id": ${CATALOG_USER_ID@Q},
    "description": "Should fail",
    "metadata": {"owner": "platform"}
}))
PY
)"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$SCOPE_MISMATCH_BODY" \
  --dump-header "$SCOPE_MISMATCH_HEADERS" \
  --header 'Content-Type: application/json' \
  --data "$scope_mismatch_payload" \
  "${backend_url}/catalog/resources"
scope_mismatch_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$SCOPE_MISMATCH_HEADERS")"
if [[ "$scope_mismatch_status" != "422" ]]; then
  echo "Expected scope-mismatch resource create to return 422; got ${scope_mismatch_status:-unknown}." >&2
  cat "$SCOPE_MISMATCH_HEADERS" >&2
  cat "$SCOPE_MISMATCH_BODY" >&2
  print_service_logs
  exit 1
fi
printf '%s' "$(cat "$SCOPE_MISMATCH_BODY")" | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert payload["detail"]["code"] == "resource_scope_mismatch"'

echo "==> Verifying secret-payload rejection stays machine-readable"
secret_forbidden_payload="$(python3 - <<PY
import json
print(json.dumps({
    "name": "Forbidden secret ${CORRELATION_ID}",
    "resource_type": "queue",
    "container_type": "environment",
    "container_id": ${ENVIRONMENT_ID@Q},
    "scope_type": "organization",
    "scope_id": "org_123",
    "description": "Should fail",
    "metadata": {"password": "super-secret"}
}))
PY
)"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$SECRET_FORBIDDEN_BODY" \
  --dump-header "$SECRET_FORBIDDEN_HEADERS" \
  --header 'Content-Type: application/json' \
  --data "$secret_forbidden_payload" \
  "${backend_url}/catalog/resources"
secret_forbidden_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$SECRET_FORBIDDEN_HEADERS")"
if [[ "$secret_forbidden_status" != "422" ]]; then
  echo "Expected secret-payload resource create to return 422; got ${secret_forbidden_status:-unknown}." >&2
  cat "$SECRET_FORBIDDEN_HEADERS" >&2
  cat "$SECRET_FORBIDDEN_BODY" >&2
  print_service_logs
  exit 1
fi
printf '%s' "$(cat "$SECRET_FORBIDDEN_BODY")" | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert payload["detail"]["code"] == "resource_secret_payload_forbidden"'

echo "S03 hierarchy verification passed: app, project, environment, and typed resource creation/readback succeeded, and missing-parent/scope-mismatch/secret-payload failures stayed machine-readable through the protected API seam."
