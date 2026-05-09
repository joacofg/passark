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
  "frontend/app/login/page.tsx"
  "frontend/app/operator/page.tsx"
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

if ! grep -q "AUTH_BOOTSTRAP_ADMIN_EMAIL" docs/local-development.md; then
  echo "docs/local-development.md must document bootstrap auth." >&2
  exit 1
fi

TEMP_ENV_CREATED=0
if [[ ! -f .env ]]; then
  cp .env.example .env
  TEMP_ENV_CREATED=1
fi

cleanup() {
  if [[ "$TEMP_ENV_CREATED" -eq 1 ]]; then
    rm -f .env
  fi
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not installed; cannot run compose-backed verification." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "docker daemon unavailable; start Docker before running compose-backed verification." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for auth verification." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required for auth verification." >&2
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
      echo "$service service is not running under docker compose." >&2
      echo "Infrastructure gating diagnostic follows." >&2
      docker compose ps >&2 || true
      docker compose logs --tail=50 "$service" >&2 || true
      return 1
    fi

    service_health="$(printf '%s\n' "$service_json" | python3 -c 'import json,sys; rows=[json.loads(line) for line in sys.stdin if line.strip()]; print(rows[0].get("Health","")) if rows else sys.exit(1)')"
    if [[ "$service_health" == "healthy" ]]; then
      return 0
    fi

    if (( $(date +%s) - start_ts >= timeout_seconds )); then
      echo "$service service is not healthy (status: ${service_health:-unknown})." >&2
      echo "Recent $service logs:" >&2
      docker compose logs --tail=50 "$service" >&2 || true
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
cookie_jar="$(mktemp)"
trap 'rm -f "$cookie_jar"; cleanup' EXIT

echo "==> Probing backend health endpoint: ${backend_url}/health"
backend_payload="$(curl --fail --silent --show-error "${backend_url}/health")"
printf '%s\n' "$backend_payload"
printf '%s' "$backend_payload" | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert payload["status"] == "ok"; assert payload["service"] == "passark-backend"; assert payload["environment"]'

echo "==> Verifying anonymous protected access is rejected"
anon_headers="$(mktemp)"
anon_body="$(mktemp)"
curl --silent --show-error \
  --output "$anon_body" \
  --dump-header "$anon_headers" \
  "${backend_url}/protected/whoami"
anon_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$anon_headers")"
if [[ "$anon_status" != "401" ]]; then
  echo "Expected anonymous protected access to return 401; got ${anon_status:-unknown}." >&2
  cat "$anon_headers" >&2
  cat "$anon_body" >&2
  rm -f "$anon_headers" "$anon_body"
  exit 1
fi
printf '%s' "$(cat "$anon_body")" | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert payload["detail"]["code"] == "auth_unauthenticated"'
rm -f "$anon_headers" "$anon_body"

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
login_headers="$(mktemp)"
login_body="$(mktemp)"
curl --silent --show-error \
  --cookie-jar "$cookie_jar" \
  --output "$login_body" \
  --dump-header "$login_headers" \
  --header 'Content-Type: application/json' \
  --data "$login_payload" \
  "${backend_url}/auth/login"
login_status="$(awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}' "$login_headers")"
if [[ "$login_status" != "200" ]]; then
  echo "Expected login to succeed; got ${login_status:-unknown}." >&2
  cat "$login_headers" >&2
  cat "$login_body" >&2
  rm -f "$login_headers" "$login_body"
  exit 1
fi
printf '%s' "$(cat "$login_body")" | python3 -c 'import json,os,sys; payload=json.load(sys.stdin); assert payload["user"]["email"] == os.environ.get("AUTH_BOOTSTRAP_ADMIN_EMAIL", "admin@passark.local")'
rm -f "$login_headers" "$login_body"

echo "==> Verifying authenticated protected access succeeds"
whoami_payload="$(curl --fail --silent --show-error --cookie "$cookie_jar" "${backend_url}/protected/whoami")"
printf '%s\n' "$whoami_payload"
printf '%s' "$whoami_payload" | python3 -c 'import json,os,sys; payload=json.load(sys.stdin); assert payload["user"]["email"] == os.environ.get("AUTH_BOOTSTRAP_ADMIN_EMAIL", "admin@passark.local"); assert payload["session_id"] > 0'

echo "==> Probing frontend routes for login-first/protected shell copy"
frontend_home="$(curl --fail --silent --show-error "$frontend_url")"
printf '%s' "$frontend_home" | grep -q "Sign in to reach the protected operator shell"
frontend_login="$(curl --fail --silent --show-error "$frontend_url/login")"
printf '%s' "$frontend_login" | grep -q "Authenticate with the local bootstrap operator"
frontend_operator="$(curl --fail --silent --show-error "$frontend_url/operator")"
printf '%s' "$frontend_operator" | grep -q "Checking backend session"
printf '%s' "$frontend_operator" | grep -q "Operator shell"
printf '%s' "$frontend_operator" | grep -q "protected/whoami"
printf '%s' "$frontend_operator" | grep -q "Protected operator boundary"

echo "S02 integrated auth verification passed."
