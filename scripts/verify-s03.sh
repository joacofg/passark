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
  "backend/app/api/routes/auth.py"
  "backend/app/db/session.py"
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

if ! grep -q "vault-access-probe" docs/local-development.md; then
  echo "docs/local-development.md must document the audited sensitive route proof." >&2
  exit 1
fi

TEMP_ENV_CREATED=0
if [[ ! -f .env ]]; then
  cp .env.example .env
  TEMP_ENV_CREATED=1
fi

cleanup() {
  rm -f "${COOKIE_JAR:-}" "${LOGIN_HEADERS:-}" "${LOGIN_BODY:-}" "${PROBE_HEADERS:-}" "${PROBE_BODY:-}" "${ANON_HEADERS:-}" "${ANON_BODY:-}" "${INVALID_HEADERS:-}" "${INVALID_BODY:-}" "${DB_OUTPUT:-}"
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
  echo "curl is required for security verification." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required for security verification." >&2
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
PROBE_HEADERS="$(mktemp)"
PROBE_BODY="$(mktemp)"
ANON_HEADERS="$(mktemp)"
ANON_BODY="$(mktemp)"
INVALID_HEADERS="$(mktemp)"
INVALID_BODY="$(mktemp)"
DB_OUTPUT="$(mktemp)"
CORRELATION_ID="verify-s03-$(date +%s)"
REQUEST_ID="req-${CORRELATION_ID}"

echo "==> Probing backend health endpoint: ${backend_url}/health"
backend_payload="$(curl --fail --silent --show-error "${backend_url}/health")"
printf '%s\n' "$backend_payload"
printf '%s' "$backend_payload" | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert payload["status"] == "ok"; assert payload["service"] == "passark-backend"'

echo "==> Verifying anonymous sensitive access is rejected"
curl --silent --show-error \
  --output "$ANON_BODY" \
  --dump-header "$ANON_HEADERS" \
  --request POST \
  --header "x-request-id: ${REQUEST_ID}-anon" \
  --header "x-correlation-id: ${CORRELATION_ID}-anon" \
  "${backend_url}/protected/vault-access-probe"
anon_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$ANON_HEADERS")"
if [[ "$anon_status" != "401" ]]; then
  echo "Expected anonymous sensitive access to return 401; got ${anon_status:-unknown}." >&2
  cat "$ANON_HEADERS" >&2
  cat "$ANON_BODY" >&2
  print_service_logs
  exit 1
fi
printf '%s' "$(cat "$ANON_BODY")" | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert payload["detail"]["code"] == "auth_unauthenticated"'

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

echo "==> Verifying audited sensitive access succeeds"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$PROBE_BODY" \
  --dump-header "$PROBE_HEADERS" \
  --request POST \
  --header "x-request-id: ${REQUEST_ID}" \
  --header "x-correlation-id: ${CORRELATION_ID}" \
  --header 'user-agent: verify-s03-script' \
  --header 'x-forwarded-for: 203.0.113.10' \
  "${backend_url}/protected/vault-access-probe"
probe_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$PROBE_HEADERS")"
if [[ "$probe_status" != "200" ]]; then
  echo "Expected audited sensitive access to return 200; got ${probe_status:-unknown}." >&2
  cat "$PROBE_HEADERS" >&2
  cat "$PROBE_BODY" >&2
  print_service_logs
  exit 1
fi
printf '%s' "$(cat "$PROBE_BODY")" | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert payload["operation"] == "vault_access_probe"; assert payload["status"] == "allowed"; assert payload["actor_id"] > 0; assert payload["audit_event_id"] > 0'

echo "==> Invalidating the authenticated session to verify fail-closed denial"
curl --silent --show-error --cookie "$COOKIE_JAR" --request POST --output /dev/null "${backend_url}/auth/logout"

curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$INVALID_BODY" \
  --dump-header "$INVALID_HEADERS" \
  --request POST \
  --header "x-request-id: ${REQUEST_ID}-invalidated" \
  --header "x-correlation-id: ${CORRELATION_ID}-invalidated" \
  "${backend_url}/protected/vault-access-probe"
invalid_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$INVALID_HEADERS")"
if [[ "$invalid_status" != "401" ]]; then
  echo "Expected invalidated-session sensitive access to return 401; got ${invalid_status:-unknown}." >&2
  cat "$INVALID_HEADERS" >&2
  cat "$INVALID_BODY" >&2
  print_service_logs
  exit 1
fi
printf '%s' "$(cat "$INVALID_BODY")" | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert payload["detail"]["code"] == "auth_unauthenticated"'

echo "==> Inspecting persisted audit evidence in PostgreSQL"
if ! docker compose exec -T postgres \
  psql -U "${POSTGRES_USER:-passark}" -d "${POSTGRES_DB:-passark}" \
  -At -F '|' \
  -c "SELECT operation, outcome, reason_code, COALESCE(actor_user_id::text,''), COALESCE(correlation_id,''), COALESCE(request_id,''), metadata_json::text FROM audit_events WHERE correlation_id IN ('${CORRELATION_ID}', '${CORRELATION_ID}-invalidated') ORDER BY id;" >"$DB_OUTPUT"; then
  echo "Failed to inspect persisted audit rows." >&2
  print_service_logs
  exit 1
fi

if [[ ! -s "$DB_OUTPUT" ]]; then
  echo "Expected persisted audit rows for correlation ${CORRELATION_ID}, but found zero rows." >&2
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
    parts = raw.split("|", 6)
    if len(parts) != 7:
        raise SystemExit(f"Unexpected audit row shape: {raw}")
    operation, outcome, reason_code, actor_user_id, correlation_id, request_id, metadata_text = parts
    try:
        metadata = json.loads(metadata_text)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Malformed audit metadata JSON: {metadata_text}") from exc
    rows.append({
        "operation": operation,
        "outcome": outcome,
        "reason_code": reason_code,
        "actor_user_id": actor_user_id,
        "correlation_id": correlation_id,
        "request_id": request_id,
        "metadata": metadata,
    })

success_rows = [row for row in rows if row["correlation_id"] == sys.argv[2]]
denied_rows = [row for row in rows if row["correlation_id"] == f"{sys.argv[2]}-invalidated"]

if len(success_rows) != 1:
    raise SystemExit(f"Expected exactly one success audit row, found {len(success_rows)}")
if len(denied_rows) != 1:
    raise SystemExit(f"Expected exactly one denied audit row for invalidated session, found {len(denied_rows)}")

success = success_rows[0]
denied = denied_rows[0]

assert success["operation"] == "vault_access_probe", success
assert success["outcome"] == "sensitive_operation_allowed", success
assert success["reason_code"] == "sensitive_operation_allowed", success
assert success["actor_user_id"], success
assert success["request_id"] == f"req-{sys.argv[2]}", success
assert success["metadata"] == {"user_email": "admin@passark.local"}, success

assert denied["operation"] == "vault_access_probe", denied
assert denied["outcome"] == "sensitive_operation_denied", denied
assert denied["reason_code"] == "auth_unauthenticated", denied
assert denied["actor_user_id"], denied
assert denied["request_id"] == f"req-{sys.argv[2]}-invalidated", denied
assert denied["metadata"] == {"cause": "session_invalidated"}, denied
PY

echo "S03 security verification passed: audited success, anonymous denial, invalidated-session fail-closed denial, and persisted audit evidence are all present."