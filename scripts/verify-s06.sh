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

if ! grep -q "verify-s06" README.md; then
  echo "README.md must document verify-s06 workflow." >&2
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
ORG_BODY=""
USERS_BODY=""
USER_CREATE_HEADERS=""
USER_CREATE_BODY=""
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
AUDIT_ROWS_BODY=""

cleanup() {
  rm -f \
    "$COOKIE_JAR" \
    "$LOGIN_HEADERS" \
    "$LOGIN_BODY" \
    "$ORG_BODY" \
    "$USERS_BODY" \
    "$USER_CREATE_HEADERS" \
    "$USER_CREATE_BODY" \
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
    "$AUDIT_ROWS_BODY"
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
ORG_BODY="$(mktemp)"
USERS_BODY="$(mktemp)"
USER_CREATE_HEADERS="$(mktemp)"
USER_CREATE_BODY="$(mktemp)"
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
AUDIT_ROWS_BODY="$(mktemp)"

CORRELATION_FAMILY="verify-s06-$(date +%s)"
USER_EMAIL="${CORRELATION_FAMILY}@passark.local"
USER_FULL_NAME="S06 Verifier ${CORRELATION_FAMILY}"
TEAM_NAME="S06 Team ${CORRELATION_FAMILY}"
ROLE_NAME="S06 Role ${CORRELATION_FAMILY}"
APP_NAME="S06 App ${CORRELATION_FAMILY}"
PROJECT_NAME="S06 Project ${CORRELATION_FAMILY}"
ENVIRONMENT_NAME="S06 Environment ${CORRELATION_FAMILY}"
RESOURCE_NAME="S06 Resource ${CORRELATION_FAMILY}"

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

echo "==> Reading organization root"
curl --fail --silent --show-error --cookie "$COOKIE_JAR" "${backend_url}/catalog/organization" > "$ORG_BODY"
ORGANIZATION_ID="$(python3 - "$ORG_BODY" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
print(payload["id"])
PY
)"

echo "==> Creating dedicated catalog user for the assembly proof"
user_payload="$(python3 - <<PY
import json
print(json.dumps({
    "email": ${USER_EMAIL@Q},
    "full_name": ${USER_FULL_NAME@Q},
    "job_title": "Assembly verifier",
    "is_active": True,
}))
PY
)"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$USER_CREATE_BODY" \
  --dump-header "$USER_CREATE_HEADERS" \
  --header 'Content-Type: application/json' \
  --data "$user_payload" \
  "${backend_url}/catalog/users"
user_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$USER_CREATE_HEADERS")"
if [[ "$user_status" != "201" ]]; then
  echo "Expected catalog user create to succeed; got ${user_status:-unknown}." >&2
  cat "$USER_CREATE_HEADERS" >&2
  cat "$USER_CREATE_BODY" >&2
  print_service_logs
  exit 1
fi
CATALOG_USER_ID="$(python3 - "$USER_CREATE_BODY" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
print(payload["catalog_user"]["id"])
PY
)"

echo "==> Creating audited team mutation"
TEAM_CORRELATION_ID="${CORRELATION_FAMILY}-team"
team_payload="$(python3 - <<PY
import json
print(json.dumps({
    "name": ${TEAM_NAME@Q},
    "description": "Verification team created by verify-s06",
}))
PY
)"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$TEAM_CREATE_BODY" \
  --dump-header "$TEAM_CREATE_HEADERS" \
  --header 'Content-Type: application/json' \
  --header "x-correlation-id: ${TEAM_CORRELATION_ID}" \
  --header "x-request-id: ${TEAM_CORRELATION_ID}-request" \
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
TEAM_ID="$(python3 - "$TEAM_CREATE_BODY" "$TEAM_CORRELATION_ID" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
assert payload["audit_event_id"] > 0, payload
assert payload["correlation_id"] == sys.argv[2], payload
print(payload["team"]["id"])
PY
)"

echo "==> Creating direct scoped role for assignment readback"
role_payload="$(python3 - <<PY
import json
print(json.dumps({
    "name": ${ROLE_NAME@Q},
    "description": "Verification scoped role created by verify-s06",
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

echo "==> Creating audited membership mutation"
MEMBERSHIP_CORRELATION_ID="${CORRELATION_FAMILY}-membership"
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
  --header "x-correlation-id: ${MEMBERSHIP_CORRELATION_ID}" \
  --header "x-request-id: ${MEMBERSHIP_CORRELATION_ID}-request" \
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
MEMBERSHIP_ID="$(python3 - "$MEMBERSHIP_CREATE_BODY" "$MEMBERSHIP_CORRELATION_ID" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
assert payload["audit_event_id"] > 0, payload
assert payload["correlation_id"] == sys.argv[2], payload
print(payload["membership"]["id"])
PY
)"

echo "==> Creating direct role assignment after membership exists"
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
ASSIGNMENT_ID="$(python3 - "$ASSIGNMENT_CREATE_BODY" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
print(payload["assignment"]["id"])
PY
)"

echo "==> Creating app, project, and environment hierarchy"
app_payload="$(python3 - <<PY
import json
print(json.dumps({
    "name": ${APP_NAME@Q},
    "description": "Verification app created by verify-s06",
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
    "description": "Verification project created by verify-s06",
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
    "description": "Verification environment created by verify-s06",
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

echo "==> Creating audited resource mutation scoped to the assembled team"
RESOURCE_CORRELATION_ID="${CORRELATION_FAMILY}-resource"
resource_payload="$(python3 - <<PY
import json
print(json.dumps({
    "name": ${RESOURCE_NAME@Q},
    "resource_type": "queue",
    "container_type": "environment",
    "container_id": ${ENVIRONMENT_ID@Q},
    "scope_type": "team",
    "scope_id": ${TEAM_ID@Q},
    "description": "Verification resource created by verify-s06",
    "metadata": {
        "owner": "platform",
        "rotation": "manual",
        "verifier": "s06"
    }
}))
PY
)"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$RESOURCE_CREATE_BODY" \
  --dump-header "$RESOURCE_CREATE_HEADERS" \
  --header 'Content-Type: application/json' \
  --header "x-correlation-id: ${RESOURCE_CORRELATION_ID}" \
  --header "x-request-id: ${RESOURCE_CORRELATION_ID}-request" \
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
RESOURCE_ID="$(python3 - "$RESOURCE_CREATE_BODY" "$RESOURCE_CORRELATION_ID" "$APP_ID" "$PROJECT_ID" "$ENVIRONMENT_ID" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
resource = payload["resource"]
assert payload["audit_event_id"] > 0, payload
assert payload["correlation_id"] == sys.argv[2], payload
assert resource["app_id"] == sys.argv[3], payload
assert resource["project_id"] == sys.argv[4], payload
assert resource["environment_id"] == sys.argv[5], payload
assert resource["scope_type"] == "team", payload
assert resource["metadata"] == {"owner": "platform", "rotation": "manual", "verifier": "s06"}, payload
print(resource["id"])
PY
)"

echo "==> Reading protected selected-user relationship aggregate"
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

python3 - "$RELATIONSHIP_BODY" "$CATALOG_USER_ID" "$TEAM_ID" "$MEMBERSHIP_ID" "$ROLE_ID" "$ASSIGNMENT_ID" "$RESOURCE_ID" "$APP_ID" "$PROJECT_ID" "$ENVIRONMENT_ID" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text())["item"]
(
    catalog_user_id,
    team_id,
    membership_id,
    role_id,
    assignment_id,
    resource_id,
    app_id,
    project_id,
    environment_id,
) = sys.argv[2:11]

assert payload["catalog_user"]["id"] == catalog_user_id, payload
assert any(
    item["membership"]["id"] == membership_id and item["team"]["id"] == team_id
    for item in payload["memberships"]
), payload["memberships"]
assert any(
    item["assignment"]["id"] == assignment_id and item["scoped_role"]["id"] == role_id
    for item in payload["assignments"]
), payload["assignments"]
assert any(
    item["resource"]["id"] == resource_id
    and item["resource"]["scope_type"] == "team"
    and item["resource"]["scope_id"] == team_id
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

echo "==> Inspecting durable audit rows in postgres by correlation family"
if ! docker compose exec -T postgres psql -U "${POSTGRES_USER:-passark}" -d "${POSTGRES_DB:-passark}" \
  -F $'\t' -A \
  -c "SELECT operation, outcome, reason_code, COALESCE(correlation_id,''), COALESCE(request_id,''), metadata_json::text FROM audit_events WHERE correlation_id IN ('${TEAM_CORRELATION_ID}', '${MEMBERSHIP_CORRELATION_ID}', '${RESOURCE_CORRELATION_ID}') ORDER BY id;" >"$AUDIT_ROWS_BODY"; then
  echo "Failed to inspect audit_events rows for correlation family ${CORRELATION_FAMILY}." >&2
  print_service_logs
  exit 1
fi

python3 - "$AUDIT_ROWS_BODY" "$TEAM_CORRELATION_ID" "$MEMBERSHIP_CORRELATION_ID" "$RESOURCE_CORRELATION_ID" "$TEAM_ID" "$CATALOG_USER_ID" "$RESOURCE_ID" <<'PY'
import json
import sys
from pathlib import Path

lines = [line.strip() for line in Path(sys.argv[1]).read_text().splitlines() if line.strip()]
if len(lines) < 3:
    raise SystemExit(f"Expected at least three audit rows for S06 correlation family, got: {lines!r}")

expected = {
    "catalog_team_mutation": sys.argv[2],
    "catalog_membership_mutation": sys.argv[3],
    "catalog_resource_mutation": sys.argv[4],
}
team_id = sys.argv[5]
catalog_user_id = sys.argv[6]
resource_id = sys.argv[7]
seen = {}

for line in lines:
    parts = line.split('\t')
    if len(parts) != 6:
        raise SystemExit(f"Unexpected audit row shape: {line!r}")
    operation, outcome, reason_code, correlation_id, request_id, metadata_text = parts
    metadata = json.loads(metadata_text)
    if operation in expected:
        assert correlation_id == expected[operation], (operation, correlation_id, expected[operation])
        assert outcome == "sensitive_operation_allowed", (operation, outcome)
        assert reason_code == "sensitive_operation_allowed", (operation, reason_code)
        assert request_id, (operation, request_id)
        seen[operation] = metadata

missing = sorted(set(expected) - set(seen))
if missing:
    raise SystemExit(f"Missing expected audit operations: {missing}")

team_meta = seen["catalog_team_mutation"]
membership_meta = seen["catalog_membership_mutation"]
resource_meta = seen["catalog_resource_mutation"]
assert team_meta.get("team_id") == team_id, team_meta
assert membership_meta.get("team_id") == team_id, membership_meta
assert membership_meta.get("catalog_user_id") == catalog_user_id, membership_meta
assert resource_meta.get("resource_id") == resource_id, resource_meta
PY

echo "S06 assembly verification passed: dedicated user creation, membership, assignment, team-scoped resource visibility, protected relationship readback, and durable audited mutation rows all succeeded through the real compose-backed seam."