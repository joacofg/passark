#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

required_files=(
  "README.md"
  ".env.example"
  "compose.yaml"
  "Makefile"
  "docs/local-development.md"
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

if ! grep -q "verify-s02" README.md; then
  echo "README.md must document verify-s02 workflow." >&2
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
TEAMS_BODY=""
ROLES_BODY=""
MEMBERSHIPS_BODY=""
ASSIGNMENTS_BODY=""
TEAM_CREATE_HEADERS=""
TEAM_CREATE_BODY=""
ROLE_CREATE_HEADERS=""
ROLE_CREATE_BODY=""
MEMBERSHIP_CREATE_HEADERS=""
MEMBERSHIP_CREATE_BODY=""
ASSIGNMENT_CREATE_HEADERS=""
ASSIGNMENT_CREATE_BODY=""
USERS_BODY=""
USER_CREATE_HEADERS=""
USER_CREATE_BODY=""

cleanup() {
  rm -f \
    "$COOKIE_JAR" \
    "$LOGIN_HEADERS" \
    "$LOGIN_BODY" \
    "$TEAMS_BODY" \
    "$ROLES_BODY" \
    "$MEMBERSHIPS_BODY" \
    "$ASSIGNMENTS_BODY" \
    "$TEAM_CREATE_HEADERS" \
    "$TEAM_CREATE_BODY" \
    "$ROLE_CREATE_HEADERS" \
    "$ROLE_CREATE_BODY" \
    "$MEMBERSHIP_CREATE_HEADERS" \
    "$MEMBERSHIP_CREATE_BODY" \
    "$ASSIGNMENT_CREATE_HEADERS" \
    "$ASSIGNMENT_CREATE_BODY" \
    "$USERS_BODY" \
    "$USER_CREATE_HEADERS" \
    "$USER_CREATE_BODY"
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
TEAMS_BODY="$(mktemp)"
ROLES_BODY="$(mktemp)"
MEMBERSHIPS_BODY="$(mktemp)"
ASSIGNMENTS_BODY="$(mktemp)"
TEAM_CREATE_HEADERS="$(mktemp)"
TEAM_CREATE_BODY="$(mktemp)"
ROLE_CREATE_HEADERS="$(mktemp)"
ROLE_CREATE_BODY="$(mktemp)"
MEMBERSHIP_CREATE_HEADERS="$(mktemp)"
MEMBERSHIP_CREATE_BODY="$(mktemp)"
ASSIGNMENT_CREATE_HEADERS="$(mktemp)"
ASSIGNMENT_CREATE_BODY="$(mktemp)"
USERS_BODY="$(mktemp)"
USER_CREATE_HEADERS="$(mktemp)"
USER_CREATE_BODY="$(mktemp)"
CORRELATION_ID="verify-s02-$(date +%s)"
TEAM_NAME="Security ${CORRELATION_ID}"
ROLE_NAME="Security Admin ${CORRELATION_ID}"
USER_EMAIL="${CORRELATION_ID}@passark.local"
USER_FULL_NAME="S02 Verifier ${CORRELATION_ID}"


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


echo "==> Creating a dedicated catalog user for relationship verification"
user_payload="$(USER_EMAIL="$USER_EMAIL" USER_FULL_NAME="$USER_FULL_NAME" python3 - <<'PY'
import json
import os
print(json.dumps({
    "email": os.environ["USER_EMAIL"],
    "full_name": os.environ["USER_FULL_NAME"],
    "job_title": "S02 verifier",
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


echo "==> Listing catalog users after bootstrap create"
curl --fail --silent --show-error --cookie "$COOKIE_JAR" "${backend_url}/catalog/users" > "$USERS_BODY"
python3 - "$USERS_BODY" "$CATALOG_USER_ID" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
items = payload.get("items", [])
expected_id = sys.argv[2]
assert any(item["id"] == expected_id for item in items), items
PY


echo "==> Creating a team through the protected catalog API"
team_payload="$(TEAM_NAME="$TEAM_NAME" python3 - <<'PY'
import json
import os
print(json.dumps({
    "name": os.environ["TEAM_NAME"],
    "description": "Verification team created by verify-s02",
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


echo "==> Creating a team-scoped role through the protected catalog API"
role_payload="$(ROLE_NAME="$ROLE_NAME" TEAM_ID="$TEAM_ID" python3 - <<'PY'
import json
import os
print(json.dumps({
    "name": os.environ["ROLE_NAME"],
    "description": "Verification role created by verify-s02",
    "scope_type": "team",
    "scope_id": os.environ["TEAM_ID"],
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


echo "==> Creating a team membership through the protected catalog API"
membership_payload="$(TEAM_ID="$TEAM_ID" CATALOG_USER_ID="$CATALOG_USER_ID" python3 - <<'PY'
import json
import os
print(json.dumps({
    "team_id": os.environ["TEAM_ID"],
    "catalog_user_id": os.environ["CATALOG_USER_ID"],
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


echo "==> Creating a direct role assignment through the protected catalog API"
assignment_payload="$(ROLE_ID="$ROLE_ID" CATALOG_USER_ID="$CATALOG_USER_ID" python3 - <<'PY'
import json
import os
print(json.dumps({
    "scoped_role_id": os.environ["ROLE_ID"],
    "catalog_user_id": os.environ["CATALOG_USER_ID"],
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


echo "==> Verifying list endpoints expose the new relationship records"
curl --fail --silent --show-error --cookie "$COOKIE_JAR" "${backend_url}/catalog/teams" > "$TEAMS_BODY"
curl --fail --silent --show-error --cookie "$COOKIE_JAR" "${backend_url}/catalog/roles" > "$ROLES_BODY"
curl --fail --silent --show-error --cookie "$COOKIE_JAR" "${backend_url}/catalog/memberships" > "$MEMBERSHIPS_BODY"
curl --fail --silent --show-error --cookie "$COOKIE_JAR" "${backend_url}/catalog/assignments" > "$ASSIGNMENTS_BODY"

python3 - "$TEAMS_BODY" "$ROLES_BODY" "$MEMBERSHIPS_BODY" "$ASSIGNMENTS_BODY" "$TEAM_ID" "$ROLE_ID" "$CATALOG_USER_ID" <<'PY'
import json
import sys
from pathlib import Path

teams = json.loads(Path(sys.argv[1]).read_text())["items"]
roles = json.loads(Path(sys.argv[2]).read_text())["items"]
memberships = json.loads(Path(sys.argv[3]).read_text())["items"]
assignments = json.loads(Path(sys.argv[4]).read_text())["items"]
team_id, role_id, catalog_user_id = sys.argv[5:8]

assert any(item["id"] == team_id for item in teams), teams
assert any(item["id"] == role_id and item["scope_id"] == team_id for item in roles), roles
assert any(item["team_id"] == team_id and item["catalog_user_id"] == catalog_user_id for item in memberships), memberships
assert any(item["scoped_role_id"] == role_id and item["catalog_user_id"] == catalog_user_id for item in assignments), assignments
PY

echo "S02 integrated catalog verification passed: login, team create, scoped-role create, membership link, and direct assignment link all succeeded through the protected API seam."
