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
)

for path in "${required_files[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing required file: $path" >&2
    exit 1
  fi
done

if ! grep -q "docker compose" README.md; then
  echo "README.md must document docker compose workflow." >&2
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

echo "==> Rendering compose configuration"
docker compose config >/dev/null

echo "==> Inspecting service state"
docker compose ps

postgres_status="$(docker compose ps --format json postgres | python3 -c 'import json,sys; rows=[json.loads(line) for line in sys.stdin if line.strip()]; print(rows[0].get("Health","")) if rows else sys.exit(1)')"
backend_status="$(docker compose ps --format json backend | python3 -c 'import json,sys; rows=[json.loads(line) for line in sys.stdin if line.strip()]; print(rows[0].get("Health","")) if rows else sys.exit(1)')"
frontend_status="$(docker compose ps --format json frontend | python3 -c 'import json,sys; rows=[json.loads(line) for line in sys.stdin if line.strip()]; print(rows[0].get("Health","")) if rows else sys.exit(1)')"

for pair in \
  "postgres:$postgres_status" \
  "backend:$backend_status" \
  "frontend:$frontend_status"; do
  service="${pair%%:*}"
  status="${pair#*:}"
  if [[ "$status" != "healthy" ]]; then
    echo "$service service is not healthy (status: ${status:-unknown})." >&2
    echo "Recent $service logs:" >&2
    docker compose logs --tail=50 "$service" >&2 || true
    exit 1
  fi
done

backend_url="http://127.0.0.1:${BACKEND_PORT:-8000}/health"
frontend_url="http://127.0.0.1:${FRONTEND_PORT:-3000}"

echo "==> Probing backend health endpoint: $backend_url"
backend_payload="$(curl --fail --silent --show-error "$backend_url")"
printf '%s\n' "$backend_payload"

printf '%s' "$backend_payload" | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert payload["status"] == "ok"; assert payload["service"] == "passark-backend"; assert payload["environment"]'

echo "==> Probing frontend entrypoint: $frontend_url"
frontend_payload="$(curl --fail --silent --show-error "$frontend_url")"
printf '%s' "$frontend_payload" | grep -q "PassArk operator workspace"
printf '%s' "$frontend_payload" | grep -q "http://localhost:${BACKEND_PORT:-8000}"

echo "S01 integrated stack verification passed."
