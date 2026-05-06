# PassArk

PassArk is an open-source, self-hosted platform for managing internal access, sensitive operational credentials, passwords, and environment files inside a **single-company** deployment.

This repository starts as a **modular monolith** split into:

- `backend/` — FastAPI API, persistence, migrations, and domain modules
- `frontend/` — Next.js operator-facing web application
- `docs/` — local-development and architecture notes
- `scripts/` — tracked verification and automation entrypoints

The local developer contract for M001/S01 is a **Docker Compose-first workflow**. Backend, frontend, and PostgreSQL will boot through one canonical stack entrypoint so downstream slices extend the same runtime shape instead of inventing parallel setups.

## Current foundation status

This slice establishes the repository-level contract and local workflow scaffolding. Later tasks in the same slice will add the runnable backend, frontend, database migrations, and full stack verification on top of these same files.

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
make up           # build and start the local stack
make ps           # inspect service/container state
make logs         # tail compose logs
make verify-s01   # run the tracked slice verification entrypoint
make down         # stop the stack
```

## Canonical local service contract

| Service | Compose name | Host port | Purpose |
|---|---|---:|---|
| PostgreSQL | `postgres` | `5432` | primary relational database |
| Backend API | `backend` | `8000` | FastAPI app and future migrations/auth/audit seams |
| Frontend web | `frontend` | `3000` | Next.js operator UI |

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

## Diagnostics baseline

The first inspection surfaces are intentionally simple and tracked:

```bash
docker compose ps
docker compose logs backend
docker compose logs frontend
docker compose logs postgres
bash scripts/verify-s01.sh
```

As the slice progresses, these commands become the first-line diagnosis path for startup and health issues.

## Repository roadmap context

This repo is intentionally being built foundation-first:

1. root monorepo contract and workflow
2. backend app/config/migration baseline
3. frontend shell baseline
4. integrated end-to-end local proof

See `docs/local-development.md` for the local workflow expectations used by downstream slices.
