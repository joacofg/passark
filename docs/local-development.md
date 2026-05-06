# Local development

## Scope of this document

This document defines the canonical local workflow for the PassArk monorepo foundation established in M001/S01.

The repository assumes:

- one **single-company** deployment per installation
- one backend service, one frontend service, and one PostgreSQL service
- one Compose-first local workflow that downstream slices extend unchanged

## Repository shape

- `backend/` — backend application and migrations
- `frontend/` — web application
- `docs/` — project documentation
- `scripts/` — tracked verification utilities

## Local setup

1. Copy the environment example:
   ```bash
   cp .env.example .env
   ```
2. Initialize local folders and defaults:
   ```bash
   make init
   ```
3. Inspect the rendered compose configuration:
   ```bash
   make config
   ```

## Canonical commands

```bash
make up
make ps
make logs
make verify-s01
make down
```

## Service contract

| Service | Expected URL / port | Notes |
|---|---|---|
| postgres | `localhost:5432` | primary database |
| backend | `http://localhost:8000` | future `/health` endpoint lands in T02 |
| frontend | `http://localhost:3000` | app shell lands in T03 |

## Diagnostics baseline

Use these commands first when the stack misbehaves:

```bash
docker compose ps
docker compose logs postgres
docker compose logs backend
docker compose logs frontend
bash scripts/verify-s01.sh
```

The intent is to keep startup and migration failures attributable to the failing service or command rather than hidden in ad-hoc orchestration.

## Current slice limitations

At T01, the root workflow exists before the full application code exists.

- PostgreSQL is the only service expected to be fully healthy immediately.
- Backend and frontend container definitions are placeholders that preserve canonical service names, ports, and env seams for downstream tasks.
- `scripts/verify-s01.sh` intentionally verifies the tracked foundation contract first and will be extended by later tasks in S01.
