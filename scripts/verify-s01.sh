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

if ! grep -q "verify-s01" README.md; then
  echo "README.md must document verify-s01 workflow." >&2
  exit 1
fi

if ! grep -q "single-company" README.md; then
  echo "README.md must document the single-company deployment model." >&2
  exit 1
fi

TEMP_ENV_CREATED=0
if [[ ! -f .env ]]; then
  cp .env.example .env
  TEMP_ENV_CREATED=1
fi

cleanup() {
  rm -f "${COOKIE_JAR:-}" "${LOGIN_HEADERS:-}" "${LOGIN_BODY:-}" "${ORG_HEADERS:-}" "${ORG_BODY:-}" "${LIST_BODY:-}" "${CREATE_HEADERS:-}" "${CREATE_BODY:-}" "${UPDATE_HEADERS:-}" "${UPDATE_BODY:-}" "${DB_OUTPUT:-}"
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
  echo "docker daemon unavailable; start Docker before running compose-backed verification." >&2
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
frontend_url="http://127.0.0.1:${FRONTEND_PORT:-3000}"
COOKIE_JAR="$(mktemp)"
LOGIN_HEADERS="$(mktemp)"
LOGIN_BODY="$(mktemp)"
ORG_HEADERS="$(mktemp)"
ORG_BODY="$(mktemp)"
LIST_BODY="$(mktemp)"
CREATE_HEADERS="$(mktemp)"
CREATE_BODY="$(mktemp)"
UPDATE_HEADERS="$(mktemp)"
UPDATE_BODY="$(mktemp)"
DB_OUTPUT="$(mktemp)"
CORRELATION_ID="verify-s01-$(date +%s)"
REQUEST_ID="req-${CORRELATION_ID}"
CATALOG_EMAIL="s01-operator-${CORRELATION_ID}@example.com"
UPDATED_DISPLAY_NAME="PassArk Verify ${CORRELATION_ID}"
UPDATED_DESCRIPTION="Compose-backed verification for ${CORRELATION_ID}"
UPDATED_FULL_NAME="Verification Operator ${CORRELATION_ID}"
UPDATED_JOB_TITLE="Catalog Verifier"

echo "==> Probing backend health endpoint: ${backend_url}/health"
backend_payload="$(curl --fail --silent --show-error "${backend_url}/health")"
printf '%s\n' "$backend_payload"
printf '%s' "$backend_payload" | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert payload["status"] == "ok"; assert payload["service"] == "passark-backend"; assert payload["environment"]'

echo "==> Probing frontend entrypoint: $frontend_url"
frontend_payload="$(curl --fail --silent --show-error "$frontend_url")"
printf '%s' "$frontend_payload" | grep -q "PassArk operator workspace"
printf '%s' "$frontend_payload" | grep -q "Open operator shell"

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
printf '%s' "$(cat "$LOGIN_BODY")" | python3 -c 'import json,os,sys; payload=json.load(sys.stdin); assert payload["user"]["email"] == os.environ.get("AUTH_BOOTSTRAP_ADMIN_EMAIL", "admin@passark.local")'

echo "==> Reading organization root through the protected catalog API"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$ORG_BODY" \
  --dump-header "$ORG_HEADERS" \
  "${backend_url}/catalog/organization"
org_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$ORG_HEADERS")"
if [[ "$org_status" != "200" ]]; then
  echo "Expected organization read to succeed; got ${org_status:-unknown}." >&2
  cat "$ORG_HEADERS" >&2
  cat "$ORG_BODY" >&2
  print_service_logs
  exit 1
fi
printf '%s' "$(cat "$ORG_BODY")" | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert payload["id"].startswith("org_"); assert payload["slug"] == "passark"; assert payload["display_name"]'

echo "==> Updating organization root and asserting audit-backed response"
organization_update_payload="$(python3 - <<PY
import json
print(json.dumps({
    "display_name": ${UPDATED_DISPLAY_NAME@Q},
    "description": ${UPDATED_DESCRIPTION@Q},
}))
PY
)"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$ORG_BODY" \
  --dump-header "$ORG_HEADERS" \
  --request PUT \
  --header 'Content-Type: application/json' \
  --header "x-correlation-id: ${CORRELATION_ID}" \
  --header "x-request-id: ${REQUEST_ID}" \
  --header 'user-agent: verify-s01-script' \
  --data "$organization_update_payload" \
  "${backend_url}/catalog/organization"
org_update_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$ORG_HEADERS")"
if [[ "$org_update_status" != "200" ]]; then
  echo "Expected organization update to succeed; got ${org_update_status:-unknown}." >&2
  cat "$ORG_HEADERS" >&2
  cat "$ORG_BODY" >&2
  print_service_logs
  exit 1
fi
printf '%s' "$(cat "$ORG_BODY")" | python3 - <<PY
import json
import sys
payload = json.load(sys.stdin)
assert payload["organization"]["display_name"] == ${UPDATED_DISPLAY_NAME@Q}
assert payload["organization"]["description"] == ${UPDATED_DESCRIPTION@Q}
assert payload["audit_event_id"] > 0
assert payload["correlation_id"] == ${CORRELATION_ID@Q}
PY

echo "==> Listing catalog users before mutation"
curl --fail --silent --show-error --cookie "$COOKIE_JAR" "${backend_url}/catalog/users" > "$LIST_BODY"
printf '%s' "$(cat "$LIST_BODY")" | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert isinstance(payload["items"], list)'

echo "==> Creating catalog user through the protected catalog API"
create_payload="$(python3 - <<PY
import json
print(json.dumps({
    "email": ${CATALOG_EMAIL@Q},
    "full_name": ${UPDATED_FULL_NAME@Q},
    "job_title": "Initial Operator",
    "is_active": True,
}))
PY
)"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$CREATE_BODY" \
  --dump-header "$CREATE_HEADERS" \
  --header 'Content-Type: application/json' \
  --data "$create_payload" \
  "${backend_url}/catalog/users"
create_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$CREATE_HEADERS")"
if [[ "$create_status" != "201" ]]; then
  echo "Expected catalog user create to succeed; got ${create_status:-unknown}." >&2
  cat "$CREATE_HEADERS" >&2
  cat "$CREATE_BODY" >&2
  print_service_logs
  exit 1
fi
catalog_user_id="$(python3 - <<'PY' "$CREATE_BODY"
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
user = payload["catalog_user"]
assert user["id"].startswith("cu_")
assert user["email"]
assert "passark_session" not in json.dumps(user)
print(user["id"])
PY
)"

echo "==> Editing catalog user through the protected catalog API"
update_payload="$(python3 - <<PY
import json
print(json.dumps({
    "full_name": ${UPDATED_FULL_NAME@Q},
    "job_title": ${UPDATED_JOB_TITLE@Q},
    "is_active": False,
}))
PY
)"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$UPDATE_BODY" \
  --dump-header "$UPDATE_HEADERS" \
  --request PUT \
  --header 'Content-Type: application/json' \
  --data "$update_payload" \
  "${backend_url}/catalog/users/${catalog_user_id}"
update_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$UPDATE_HEADERS")"
if [[ "$update_status" != "200" ]]; then
  echo "Expected catalog user update to succeed; got ${update_status:-unknown}." >&2
  cat "$UPDATE_HEADERS" >&2
  cat "$UPDATE_BODY" >&2
  print_service_logs
  exit 1
fi
printf '%s' "$(cat "$UPDATE_BODY")" | python3 - <<PY
import json
import sys
payload = json.load(sys.stdin)
user = payload["catalog_user"]
assert user["id"] == ${catalog_user_id@Q}
assert user["full_name"] == ${UPDATED_FULL_NAME@Q}
assert user["job_title"] == ${UPDATED_JOB_TITLE@Q}
assert user["is_active"] is False
assert "passark_session" not in json.dumps(user)
PY

echo "==> Re-reading catalog users to prove the live create/edit path"
list_after_payload="$(curl --fail --silent --show-error --cookie "$COOKIE_JAR" "${backend_url}/catalog/users")"
printf '%s\n' "$list_after_payload"
printf '%s' "$list_after_payload" | python3 - <<PY
import json
import sys
payload = json.load(sys.stdin)
match = None
for item in payload["items"]:
    if item["id"] == ${catalog_user_id@Q}:
        match = item
        break
assert match is not None
assert match["email"] == ${CATALOG_EMAIL@Q}
assert match["full_name"] == ${UPDATED_FULL_NAME@Q}
assert match["job_title"] == ${UPDATED_JOB_TITLE@Q}
assert match["is_active"] is False
assert "passark_session" not in json.dumps(match)
PY

echo "==> Inspecting persisted organization audit evidence in PostgreSQL"
if ! docker compose exec -T postgres \
  psql -U "${POSTGRES_USER:-passark}" -d "${POSTGRES_DB:-passark}" \
  -At -F '|' \
  -c "SELECT operation, outcome, reason_code, COALESCE(correlation_id,''), COALESCE(request_id,''), metadata_json::text FROM audit_events WHERE correlation_id = '${CORRELATION_ID}' ORDER BY id;" >"$DB_OUTPUT"; then
  echo "Failed to inspect persisted audit rows." >&2
  print_service_logs
  exit 1
fi

if [[ ! -s "$DB_OUTPUT" ]]; then
  echo "Expected persisted audit row for correlation ${CORRELATION_ID}, but found zero rows." >&2
  print_service_logs
  exit 1
fi

printf '%s\n' "Persisted audit rows:"
cat "$DB_OUTPUT"

python3 - "$DB_OUTPUT" "$CORRELATION_ID" <<'PY'
import json
import sys
from pathlib import Path

rows = []
for raw in Path(sys.argv[1]).read_text().splitlines():
    if not raw.strip():
        continue
    parts = raw.split("|", 5)
    if len(parts) != 6:
        raise SystemExit(f"Unexpected audit row shape: {raw}")
    operation, outcome, reason_code, correlation_id, request_id, metadata_text = parts
    rows.append({
        "operation": operation,
        "outcome": outcome,
        "reason_code": reason_code,
        "correlation_id": correlation_id,
        "request_id": request_id,
        "metadata": json.loads(metadata_text),
    })

if len(rows) != 1:
    raise SystemExit(f"Expected exactly one organization audit row, found {len(rows)}")
row = rows[0]
assert row["operation"] == "organization_update", row
assert row["outcome"] == "organization_updated", row
assert row["reason_code"] == "organization_updated", row
assert row["correlation_id"] == sys.argv[2], row
assert row["request_id"] == f"req-{sys.argv[2]}", row
assert row["metadata"]["organization_id"].startswith("org_"), row
assert row["metadata"]["organization_slug"] == "passark", row
assert "passark_session" not in json.dumps(row["metadata"]), row
PY

echo "S01 integrated catalog verification passed: login, organization read/update, catalog-user create/edit, and persisted audit evidence are all present."
