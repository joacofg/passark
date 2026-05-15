#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

required_files=(
  "scripts/verify-s02.sh"
  "scripts/verify-s03.sh"
  "Makefile"
  "README.md"
  "docs/local-development.md"
)

for path in "${required_files[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing required file: $path" >&2
    exit 1
  fi
done

if ! grep -q "verify-milestone" README.md; then
  echo "README.md must document verify-milestone workflow." >&2
  exit 1
fi

if ! grep -q "verify-milestone" docs/local-development.md; then
  echo "docs/local-development.md must document verify-milestone workflow." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not installed; cannot run milestone verification." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "docker daemon unavailable; milestone verification is infrastructure-gated until Docker is running." >&2
  exit 1
fi

if ! command -v bash >/dev/null 2>&1; then
  echo "bash is required for milestone verification." >&2
  exit 1
fi

run_stage() {
  local label="$1"
  local script_path="$2"

  echo "==> ${label}"
  if bash "$script_path"; then
    echo "==> ${label} passed"
  else
    local exit_code=$?
    echo "==> ${label} failed with exit code ${exit_code}" >&2
    return "$exit_code"
  fi
}

echo "==> Starting milestone integration verification"
echo "==> Docker availability is a hard prerequisite; daemon failures are infrastructure gating, not auth or app regressions."

echo "==> Starting compose stack for milestone verification"
docker compose up --build -d

echo "==> Compose service snapshot"
docker compose ps || true

run_stage "S02 integrated auth verification" "scripts/verify-s02.sh"
run_stage "S03 audited sensitive-route verification" "scripts/verify-s03.sh"

echo "==> Milestone integration verification passed"
echo "Verified compose-backed auth flow, protected API access, audited sensitive route behavior, and persisted PostgreSQL audit evidence."
