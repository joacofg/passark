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
make logs-postgres
make logs-backend
make logs-frontend
make backend-migrate
make frontend-test
make frontend-lint
make verify-s01
make down
```

## Service contract

| Service | Expected URL / port | Notes |
|---|---|---|
| postgres | `localhost:5432` | primary database; should report `healthy` in Compose |
| backend | `http://localhost:8000` | `GET /health` must return service/environment status |
| frontend | `http://localhost:3000` | app shell should render the configured backend seam |

## Diagnostics baseline

Use these commands first when the stack misbehaves:

```bash
docker compose ps
docker compose logs postgres
docker compose logs backend
docker compose logs frontend
curl http://localhost:8000/health
bash scripts/verify-s01.sh
```

The intent is to keep startup and migration failures attributable to the failing service or command rather than hidden in ad-hoc orchestration. The verification script prints compose state, checks service health, validates the backend `/health` payload, and confirms the frontend shell is serving the expected backend seam.

## Integrated verification workflow

Run the slice proof with the same commands expected by the task contract:

```bash
docker compose config
docker compose up --build -d
bash scripts/verify-s01.sh
docker compose down -v
```

If Docker itself is unavailable, `bash scripts/verify-s01.sh` fails fast with an explicit daemon error so infrastructure issues are distinguished from backend or frontend regressions.
