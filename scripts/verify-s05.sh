#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

required_files=(
  "README.md"
  ".env.example"
  "compose.yaml"
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

if ! grep -q "verify-s05" README.md; then
  echo "README.md must document verify-s05 workflow." >&2
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
TEAMS_BODY=""
TEAM_CREATE_HEADERS=""
TEAM_CREATE_BODY=""
MEMBERSHIP_CREATE_HEADERS=""
MEMBERSHIP_CREATE_BODY=""
RESOURCE_CREATE_HEADERS=""
RESOURCE_CREATE_BODY=""
AUDIT_ROWS_BODY=""

cleanup() {
  rm -f \
    "$COOKIE_JAR" \
    "$LOGIN_HEADERS" \
    "$LOGIN_BODY" \
    "$USERS_BODY" \
    "$TEAMS_BODY" \
    "$TEAM_CREATE_HEADERS" \
    "$TEAM_CREATE_BODY" \
    "$MEMBERSHIP_CREATE_HEADERS" \
    "$MEMBERSHIP_CREATE_BODY" \
    "$RESOURCE_CREATE_HEADERS" \
    "$RESOURCE_CREATE_BODY" \
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
USERS_BODY="$(mktemp)"
TEAMS_BODY="$(mktemp)"
TEAM_CREATE_HEADERS="$(mktemp)"
TEAM_CREATE_BODY="$(mktemp)"
MEMBERSHIP_CREATE_HEADERS="$(mktemp)"
MEMBERSHIP_CREATE_BODY="$(mktemp)"
RESOURCE_CREATE_HEADERS="$(mktemp)"
RESOURCE_CREATE_BODY="$(mktemp)"
AUDIT_ROWS_BODY="$(mktemp)"
CORRELATION_ID="verify-s05-$(date +%s)"
TEAM_NAME="S05 Team ${CORRELATION_ID}"


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

echo "==> Listing prerequisite catalog users and teams"
curl --fail --silent --show-error --cookie "$COOKIE_JAR" "${backend_url}/catalog/users" > "$USERS_BODY"
curl --fail --silent --show-error --cookie "$COOKIE_JAR" "${backend_url}/catalog/teams" > "$TEAMS_BODY"
CATALOG_USER_ID="$(python3 - "$USERS_BODY" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
items = payload.get("items", [])
if not items:
    raise SystemExit("No catalog users exist; create one via the operator workspace before running verify-s05.")
print(items[0]["id"])
PY
)"
ORGANIZATION_ID="$(python3 - <<'PY'
print('org_123')
PY
)"


echo "==> Creating an audited team mutation"
team_payload="$(python3 - <<PY
import json
print(json.dumps({
    "name": ${TEAM_NAME@Q},
    "description": "Verification team created by verify-s05",
}))
PY
)"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$TEAM_CREATE_BODY" \
  --dump-header "$TEAM_CREATE_HEADERS" \
  --header 'Content-Type: application/json' \
  --header "x-correlation-id: ${CORRELATION_ID}" \
  --header "x-request-id: ${CORRELATION_ID}-team" \
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
assert payload["audit_event_id"] > 0, payload
assert payload["correlation_id"], payload
assert payload["team"]["id"].startswith("team_"), payload
print(payload["team"]["id"])
PY
)"


echo "==> Creating an audited membership mutation"
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
  --header "x-correlation-id: ${CORRELATION_ID}" \
  --header "x-request-id: ${CORRELATION_ID}-membership" \
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
python3 - "$MEMBERSHIP_CREATE_BODY" <<'PY'
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
assert payload["audit_event_id"] > 0, payload
assert payload["correlation_id"], payload
assert payload["membership"]["id"].startswith("tm_"), payload
PY


echo "==> Inspecting durable audit rows in postgres"
if ! docker compose exec -T postgres psql -U "${POSTGRES_USER:-passark}" -d "${POSTGRES_DB:-passark}" \
  -F $'\t' -A \
  -c "SELECT operation, outcome, reason_code, COALESCE(correlation_id,''), COALESCE(request_id,''), metadata_json::text FROM audit_events WHERE correlation_id = '${CORRELATION_ID}' ORDER BY id;" >"$AUDIT_ROWS_BODY"; then
  echo "Failed to inspect audit_events rows for correlation ${CORRELATION_ID}." >&2
  print_service_logs
  exit 1
fi

python3 - "$AUDIT_ROWS_BODY" "$CORRELATION_ID" <<'PY'
import json
import sys
from pathlib import Path
lines = [line.strip() for line in Path(sys.argv[1]).read_text().splitlines() if line.strip()]
if len(lines) < 2:
    raise SystemExit(f"Expected at least two audit rows for correlation {sys.argv[2]}, got: {lines!r}")
rows = []
for line in lines:
    parts = line.split('\t')
    if len(parts) != 6:
        raise SystemExit(f"Unexpected audit row shape: {line!r}")
    operation, outcome, reason_code, correlation_id, request_id, metadata_text = parts
    rows.append({
        "operation": operation,
        "outcome": outcome,
        "reason_code": reason_code,
        "correlation_id": correlation_id,
        "request_id": request_id,
        "metadata": json.loads(metadata_text),
    })
ops = {row["operation"] for row in rows}
assert "catalog_team_mutation" in ops, rows
assert "catalog_membership_mutation" in ops, rows
for row in rows:
    assert row["outcome"] == "sensitive_operation_allowed", row
    assert row["reason_code"] == "sensitive_operation_allowed", row
    assert row["correlation_id"] == sys.argv[2], row
PY

echo "S05 audited catalog verification passed: team and membership mutations returned audited envelopes, and matching durable audit rows were persisted and queryable by correlation id."
