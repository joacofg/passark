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

if command -v docker >/dev/null 2>&1; then
  if ! docker compose config >/dev/null; then
    echo "docker compose config failed." >&2
    exit 1
  fi
else
  echo "docker not installed; skipped docker compose config check." >&2
fi

echo "S01 foundation contract verification passed."
