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
  "frontend/tests/catalog-workspace.test.tsx"
  "frontend/tests/operator-dashboard.test.tsx"
  "backend/app/api/routes/catalog.py"
)

for path in "${required_files[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing required file: $path" >&2
    exit 1
  fi
done

TEMP_ENV_CREATED=0
if [[ ! -f .env ]]; then
  cp .env.example .env
  TEMP_ENV_CREATED=1
fi

COOKIE_JAR=""
LOGIN_HEADERS=""
LOGIN_BODY=""
USERS_BODY=""
TEAMS_BODY=""
ROLES_BODY=""
APPS_BODY=""
PROJECTS_BODY=""
ENVIRONMENTS_BODY=""
RESOURCES_BODY=""
TEAM_CREATE_HEADERS=""
TEAM_CREATE_BODY=""
ROLE_CREATE_HEADERS=""
ROLE_CREATE_BODY=""
MEMBERSHIP_CREATE_HEADERS=""
MEMBERSHIP_CREATE_BODY=""
ASSIGNMENT_CREATE_HEADERS=""
ASSIGNMENT_CREATE_BODY=""
APP_CREATE_HEADERS=""
APP_CREATE_BODY=""
PROJECT_CREATE_HEADERS=""
PROJECT_CREATE_BODY=""
ENVIRONMENT_CREATE_HEADERS=""
ENVIRONMENT_CREATE_BODY=""
RESOURCE_CREATE_HEADERS=""
RESOURCE_CREATE_BODY=""
RELATIONSHIP_HEADERS=""
RELATIONSHIP_BODY=""
NOT_FOUND_HEADERS=""
NOT_FOUND_BODY=""
UNAUTH_HEADERS=""
UNAUTH_BODY=""

cleanup() {
  rm -f \
    "$COOKIE_JAR" \
    "$LOGIN_HEADERS" \
    "$LOGIN_BODY" \
    "$USERS_BODY" \
    "$TEAMS_BODY" \
    "$ROLES_BODY" \
    "$APPS_BODY" \
    "$PROJECTS_BODY" \
    "$ENVIRONMENTS_BODY" \
    "$RESOURCES_BODY" \
    "$TEAM_CREATE_HEADERS" \
    "$TEAM_CREATE_BODY" \
    "$ROLE_CREATE_HEADERS" \
    "$ROLE_CREATE_BODY" \
    "$MEMBERSHIP_CREATE_HEADERS" \
    "$MEMBERSHIP_CREATE_BODY" \
    "$ASSIGNMENT_CREATE_HEADERS" \
    "$ASSIGNMENT_CREATE_BODY" \
    "$APP_CREATE_HEADERS" \
    "$APP_CREATE_BODY" \
    "$PROJECT_CREATE_HEADERS" \
    "$PROJECT_CREATE_BODY" \
    "$ENVIRONMENT_CREATE_HEADERS" \
    "$ENVIRONMENT_CREATE_BODY" \
    "$RESOURCE_CREATE_HEADERS" \
    "$RESOURCE_CREATE_BODY" \
    "$RELATIONSHIP_HEADERS" \
    "$RELATIONSHIP_BODY" \
    "$NOT_FOUND_HEADERS" \
    "$NOT_FOUND_BODY" \
    "$UNAUTH_HEADERS" \
    "$UNAUTH_BODY"
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
TEAMS_BODY="$(mktemp)"
ROLES_BODY="$(mktemp)"
APPS_BODY="$(mktemp)"
PROJECTS_BODY="$(mktemp)"
ENVIRONMENTS_BODY="$(mktemp)"
RESOURCES_BODY="$(mktemp)"
TEAM_CREATE_HEADERS="$(mktemp)"
TEAM_CREATE_BODY="$(mktemp)"
ROLE_CREATE_HEADERS="$(mktemp)"
ROLE_CREATE_BODY="$(mktemp)"
MEMBERSHIP_CREATE_HEADERS="$(mktemp)"
MEMBERSHIP_CREATE_BODY="$(mktemp)"
ASSIGNMENT_CREATE_HEADERS="$(mktemp)"
ASSIGNMENT_CREATE_BODY="$(mktemp)"
APP_CREATE_HEADERS="$(mktemp)"
APP_CREATE_BODY="$(mktemp)"
PROJECT_CREATE_HEADERS="$(mktemp)"
PROJECT_CREATE_BODY="$(mktemp)"
ENVIRONMENT_CREATE_HEADERS="$(mktemp)"
ENVIRONMENT_CREATE_BODY="$(mktemp)"
RESOURCE_CREATE_HEADERS="$(mktemp)"
RESOURCE_CREATE_BODY="$(mktemp)"
RELATIONSHIP_HEADERS="$(mktemp)"
RELATIONSHIP_BODY="$(mktemp)"
NOT_FOUND_HEADERS="$(mktemp)"
NOT_FOUND_BODY="$(mktemp)"
UNAUTH_HEADERS="$(mktemp)"
UNAUTH_BODY="$(mktemp)"
CORRELATION_ID="verify-s04-$(date +%s)"
TEAM_NAME="Relationship Team ${CORRELATION_ID}"
ROLE_NAME="Relationship Role ${CORRELATION_ID}"
APP_NAME="Relationship App ${CORRELATION_ID}"
PROJECT_NAME="Relationship Project ${CORRELATION_ID}"
ENVIRONMENT_NAME="Relationship Env ${CORRELATION_ID}"
RESOURCE_NAME="Relationship Queue ${CORRELATION_ID}"

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

echo "==> Listing existing catalog users"
curl --fail --silent --show-error --cookie "$COOKIE_JAR" "${backend_url}/catalog/users" > "$USERS_BODY"
CATALOG_USER_ID="$(python3 - "$USERS_BODY" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
items = payload.get("items", [])
if not items:
    raise SystemExit("No catalog users exist; create one via the operator workspace before running verify-s04.")
print(items[0]["id"])
PY
)"
ORGANIZATION_ID="$(python3 - "$USERS_BODY" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
items = payload.get("items", [])
if not items:
    raise SystemExit("No catalog users exist; create one via the operator workspace before running verify-s04.")
print(items[0]["organization_id"])
PY
)"

echo "==> Creating team/role/membership/assignment/resource fixtures for the selected user"
team_payload="$(python3 - <<PY
import json
print(json.dumps({
    "name": ${TEAM_NAME@Q},
    "description": "Verification team created by verify-s04",
}))
PY
)"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$TEAM_CREATE_BODY" \
  --dump-header "$TEAM_CREATE_HEADERS" \
  --header 'Content-Type: application/json' \
  --data "$team_payload" \
  "${backend_url}/catalog/teams"
team_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$TEAM_CREATE_HEADERS")"
if [[ "$team_status" != "201" ]]; then
  echo "Expected team create to succeed; got ${team_status:-unknown}." >&2
  cat "$TEAM_CREATE_HEADERS" >&2
  cat "$TEAM_CREATE_BODY" >&2
  print_service_logs
  exit 1
fi
TEAM_ID="$(python3 - "$TEAM_CREATE_BODY" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
print(payload["team"]["id"])
PY
)"

role_payload="$(python3 - <<PY
import json
print(json.dumps({
    "name": ${ROLE_NAME@Q},
    "description": "Verification scoped role created by verify-s04",
    "scope_type": "team",
    "scope_id": ${TEAM_ID@Q},
}))
PY
)"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$ROLE_CREATE_BODY" \
  --dump-header "$ROLE_CREATE_HEADERS" \
  --header 'Content-Type: application/json' \
  --data "$role_payload" \
  "${backend_url}/catalog/roles"
role_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$ROLE_CREATE_HEADERS")"
if [[ "$role_status" != "201" ]]; then
  echo "Expected scoped role create to succeed; got ${role_status:-unknown}." >&2
  cat "$ROLE_CREATE_HEADERS" >&2
  cat "$ROLE_CREATE_BODY" >&2
  print_service_logs
  exit 1
fi
ROLE_ID="$(python3 - "$ROLE_CREATE_BODY" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
print(payload["scoped_role"]["id"])
PY
)"

membership_payload="$(python3 - <<PY
import json
print(json.dumps({
    "team_id": ${TEAM_ID@Q},
    "catalog_user_id": ${CATALOG_USER_ID@Q},
}))
PY
)"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$MEMBERSHIP_CREATE_BODY" \
  --dump-header "$MEMBERSHIP_CREATE_HEADERS" \
  --header 'Content-Type: application/json' \
  --data "$membership_payload" \
  "${backend_url}/catalog/memberships"
membership_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$MEMBERSHIP_CREATE_HEADERS")"
if [[ "$membership_status" != "201" ]]; then
  echo "Expected membership create to succeed; got ${membership_status:-unknown}." >&2
  cat "$MEMBERSHIP_CREATE_HEADERS" >&2
  cat "$MEMBERSHIP_CREATE_BODY" >&2
  print_service_logs
  exit 1
fi

assignment_payload="$(python3 - <<PY
import json
print(json.dumps({
    "scoped_role_id": ${ROLE_ID@Q},
    "catalog_user_id": ${CATALOG_USER_ID@Q},
}))
PY
)"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$ASSIGNMENT_CREATE_BODY" \
  --dump-header "$ASSIGNMENT_CREATE_HEADERS" \
  --header 'Content-Type: application/json' \
  --data "$assignment_payload" \
  "${backend_url}/catalog/assignments"
assignment_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$ASSIGNMENT_CREATE_HEADERS")"
if [[ "$assignment_status" != "201" ]]; then
  echo "Expected assignment create to succeed; got ${assignment_status:-unknown}." >&2
  cat "$ASSIGNMENT_CREATE_HEADERS" >&2
  cat "$ASSIGNMENT_CREATE_BODY" >&2
  print_service_logs
  exit 1
fi

app_payload="$(python3 - <<PY
import json
print(json.dumps({
    "name": ${APP_NAME@Q},
    "description": "Verification app created by verify-s04",
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
  echo "Expected app create to succeed; got ${app_status:-unknown}." >&2
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

project_payload="$(python3 - <<PY
import json
print(json.dumps({
    "app_id": ${APP_ID@Q},
    "name": ${PROJECT_NAME@Q},
    "description": "Verification project created by verify-s04",
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

environment_payload="$(python3 - <<PY
import json
print(json.dumps({
    "project_id": ${PROJECT_ID@Q},
    "name": ${ENVIRONMENT_NAME@Q},
    "description": "Verification environment created by verify-s04",
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

resource_payload="$(python3 - <<PY
import json
print(json.dumps({
    "name": ${RESOURCE_NAME@Q},
    "resource_type": "queue",
    "container_type": "environment",
    "container_id": ${ENVIRONMENT_ID@Q},
    "scope_type": "team",
    "scope_id": ${TEAM_ID@Q},
    "description": "Verification resource created by verify-s04",
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

echo "==> Reading the selected-user relationship aggregate"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$RELATIONSHIP_BODY" \
  --dump-header "$RELATIONSHIP_HEADERS" \
  "${backend_url}/catalog/users/${CATALOG_USER_ID}/relationship"
relationship_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$RELATIONSHIP_HEADERS")"
if [[ "$relationship_status" != "200" ]]; then
  echo "Expected relationship read to succeed; got ${relationship_status:-unknown}." >&2
  cat "$RELATIONSHIP_HEADERS" >&2
  cat "$RELATIONSHIP_BODY" >&2
  print_service_logs
  exit 1
fi

python3 - "$RELATIONSHIP_BODY" "$CATALOG_USER_ID" "$TEAM_ID" "$ROLE_ID" "$RESOURCE_ID" "$APP_ID" "$PROJECT_ID" "$ENVIRONMENT_ID" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text())["item"]
catalog_user_id, team_id, role_id, resource_id, app_id, project_id, environment_id = sys.argv[2:9]

assert payload["catalog_user"]["id"] == catalog_user_id, payload
assert any(item["team"]["id"] == team_id for item in payload["memberships"]), payload["memberships"]
assert any(item["scoped_role"]["id"] == role_id for item in payload["assignments"]), payload["assignments"]
assert any(
    item["resource"]["id"] == resource_id
    and item["app"]["id"] == app_id
    and item["project"]["id"] == project_id
    and item["environment"]["id"] == environment_id
    for item in payload["resources"]
), payload["resources"]

print(json.dumps({
    "catalog_user_id": payload["catalog_user"]["id"],
    "membership_count": len(payload["memberships"]),
    "assignment_count": len(payload["assignments"]),
    "resource_count": len(payload["resources"]),
}, indent=2))
PY

echo "==> Verifying selected-user not-found stays machine-readable"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$NOT_FOUND_BODY" \
  --dump-header "$NOT_FOUND_HEADERS" \
  "${backend_url}/catalog/users/cu_missing/relationship"
not_found_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$NOT_FOUND_HEADERS")"
if [[ "$not_found_status" != "404" ]]; then
  echo "Expected missing selected-user relationship read to return 404; got ${not_found_status:-unknown}." >&2
  cat "$NOT_FOUND_HEADERS" >&2
  cat "$NOT_FOUND_BODY" >&2
  print_service_logs
  exit 1
fi
printf '%s' "$(cat "$NOT_FOUND_BODY")" | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert payload["detail"]["code"] == "catalog_user_not_found"'

echo "==> Verifying unauthenticated relationship reads stay machine-readable"
curl --silent --show-error \
  --output "$UNAUTH_BODY" \
  --dump-header "$UNAUTH_HEADERS" \
  "${backend_url}/catalog/users/${CATALOG_USER_ID}/relationship"
unauth_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$UNAUTH_HEADERS")"
if [[ "$unauth_status" != "401" ]]; then
  echo "Expected unauthenticated relationship read to return 401; got ${unauth_status:-unknown}." >&2
  cat "$UNAUTH_HEADERS" >&2
  cat "$UNAUTH_BODY" >&2
  print_service_logs
  exit 1
fi
printf '%s' "$(cat "$UNAUTH_BODY")" | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert payload["detail"]["code"] == "auth_unauthenticated"'

echo "S04 relationship verification passed: selected-user relationship readback succeeded through the protected API seam, and not-found/auth failure codes stayed machine-readable."
