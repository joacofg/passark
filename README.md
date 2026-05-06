# PassArk

PassArk is an open-source, self-hosted platform for managing internal access, sensitive operational credentials, passwords, and environment files inside a **single-company** deployment.

This repository starts as a **modular monolith** split into:

- `backend/` — FastAPI API, persistence, migrations, and domain modules
- `frontend/` — Next.js operator-facing web application
- `docs/` — local-development and architecture notes
- `scripts/` — tracked verification and automation entrypoints

The local developer contract for M001/S01 is a **Docker Compose-first workflow**. Backend, frontend, and PostgreSQL will boot through one canonical stack entrypoint so downstream slices extend the same runtime shape instead of inventing parallel setups.

## Current foundation status

This slice now establishes the runnable local foundation: PostgreSQL, the FastAPI backend, and the Next.js frontend boot through one Compose workflow, expose health and inspection surfaces, and now prove a backend-owned bootstrap auth flow from the real frontend shell.

## Requirements visible in the foundation

- **R001 — Single-company deployment model:** one PassArk instance is intended for one company, not multi-tenant SaaS hosting.
- **R003 — Modular monolith foundation:** the repo is organized as one backend and one frontend with clear boundaries, not microservices.

## Canonical local workflow

The canonical workflow uses `docker compose` and root `make` targets.

### Prerequisites

- Docker with Compose support
- GNU Make

### Setup

```bash
cp .env.example .env
make init
```

### Daily commands

```bash
make up                # build and start postgres, backend, and frontend
make ps                # inspect service/container state and health
make logs              # tail all compose logs
make logs-postgres     # inspect database startup and readiness
make logs-backend      # inspect API boot, migrations, or health failures
make logs-frontend     # inspect Next.js boot and runtime issues
make backend-migrate   # run Alembic migrations inside the backend container
make frontend-test     # run tracked frontend tests in the frontend container
make frontend-lint     # run tracked frontend lint in the frontend container
make verify-s01        # assert compose health plus backend/frontend smoke checks
make verify-s02        # prove auth rejects anonymous access and unlocks protected UI/API flow
make down              # stop the stack
```

## Canonical local service contract

| Service | Compose name | Host port | Purpose |
|---|---|---:|---|
| PostgreSQL | `postgres` | `5432` | primary relational database |
| Backend API | `backend` | `8000` | FastAPI app, sessions, and protected auth seams |
| Frontend web | `frontend` | `3000` | Next.js login-first operator UI |

## Environment contract

Copy `.env.example` to `.env` and keep secrets local. The example file documents variable names only and must never contain real secret values.

Baseline variables:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `BACKEND_PORT`
- `FRONTEND_PORT`
- `NEXT_PUBLIC_API_BASE_URL`
- `PASSARK_ENV`
- `AUTH_BOOTSTRAP_ADMIN_EMAIL`
- `AUTH_BOOTSTRAP_ADMIN_PASSWORD`
- `AUTH_SESSION_COOKIE_NAME`
- `AUTH_SESSION_COOKIE_SECURE`
- `AUTH_SESSION_COOKIE_SAMESITE`
- `AUTH_SESSION_COOKIE_DOMAIN`
- `AUTH_SESSION_TTL_HOURS`

The frontend signs in with the bootstrap operator credentials configured for the backend. Those credentials are verified server-side and returned to the browser only as an HTTP-only session cookie — never as a frontend-managed bearer token.

## Diagnostics baseline

The first inspection surfaces are intentionally simple and tracked:

```bash
docker compose ps
docker compose logs backend
docker compose logs frontend
docker compose logs postgres
curl http://localhost:8000/api/v1/health
bash scripts/verify-s01.sh
bash scripts/verify-s02.sh
```

`bash scripts/verify-s01.sh` renders the compose config, prints `docker compose ps`, validates all three services report `healthy`, echoes the backend health payload, and confirms the frontend responds with the documented app shell plus backend seam.

`bash scripts/verify-s02.sh` keeps the same Docker-unavailable failure triage while additionally proving that:

1. anonymous access to `/api/v1/protected/whoami` fails with the stable 401 auth contract,
2. login with the configured bootstrap operator succeeds,
3. the authenticated cookie reaches the protected backend endpoint successfully, and
4. the frontend serves the login-first and protected-shell routes used by the operator flow.

## Repository roadmap context

This repo is intentionally being built foundation-first:

1. root monorepo contract and workflow
2. backend app/config/migration baseline
3. frontend shell baseline
4. integrated end-to-end local proof

See `docs/local-development.md` for the local workflow expectations used by downstream slices.
