# Local development

## Scope of this document

This document defines the canonical local workflow for the PassArk monorepo foundation established in M001/S01 and extended with the local auth baseline in M001/S02.

For the exact implemented security posture behind those commands — including the cookie-session auth model, audited `vault-access-probe` route, stable denial codes, persisted `audit_events` evidence, and explicit non-goals — see `docs/security-model.md`.

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
make backend-test
make frontend-test
make frontend-lint
make quality-gates
make verify-s01
make verify-s02
make verify-s03
make down
```

## Service contract

| Service | Expected URL / port | Notes |
|---|---|---|
| postgres | `localhost:5432` | primary database; should report `healthy` in Compose |
| backend | `http://localhost:8000/api/v1` | health, auth, and protected endpoints |
| frontend | `http://localhost:3000` | login-first app shell plus protected operator route |

## Bootstrap auth contract

The backend owns the local auth baseline. Configure these values in `.env` before running the stack:

- `AUTH_BOOTSTRAP_ADMIN_EMAIL`
- `AUTH_BOOTSTRAP_ADMIN_PASSWORD`
- `AUTH_SESSION_COOKIE_NAME`
- `AUTH_SESSION_COOKIE_SECURE`
- `AUTH_SESSION_COOKIE_SAMESITE`
- `AUTH_SESSION_COOKIE_DOMAIN`
- `AUTH_SESSION_TTL_HOURS`

The frontend does **not** store a bearer token or treat local React state as the source of truth. Instead, it sends `credentials: include` requests to `NEXT_PUBLIC_API_BASE_URL`, and the backend returns an HTTP-only cookie when `/api/v1/auth/login` succeeds.

For local development, the default bootstrap operator identifier intentionally uses `admin@passark.local`. The backend normalizes it as a plain string instead of strict email validation so reserved local domains remain usable.

## Diagnostics baseline

Use these commands first when the stack misbehaves:

```bash
docker compose ps
docker compose logs postgres
docker compose logs backend
docker compose logs frontend
curl http://localhost:8000/api/v1/health
make backend-test
make frontend-test
make frontend-lint
make quality-gates
bash scripts/verify-s01.sh
bash scripts/verify-s02.sh
bash scripts/verify-s03.sh
```

The intent is to keep startup, auth, migration, and code-quality failures attributable to the failing service or command rather than hidden in ad-hoc orchestration.

`make quality-gates` is the fast host-side regression sweep. It runs `make backend-test`, `make frontend-test`, and `make frontend-lint` without invoking Docker-gated proof.

- `verify-s01` checks baseline stack health and shell rendering.
- `verify-s02` extends that proof with anonymous protected-access rejection, bootstrap login success, authenticated protected access, and frontend operator route copy for the `Operator shell`, backend-session loading state, and `Run vault access probe` affordance.
- `verify-s03` extends the proof to the audited sensitive route, including persisted PostgreSQL audit evidence for success and invalidated-session denial.

If Docker itself is unavailable, `make verify-s01`, `make verify-s02`, and `make verify-s03` fail fast with an explicit daemon error so infrastructure issues are distinguished from backend or frontend regressions.

## Integrated verification workflow

Use the fast host-side checks first, then escalate to compose-backed proof only when needed:

```bash
make quality-gates
make verify-s03
```

If you need the underlying compose lifecycle explicitly, the equivalent security-proof sequence is:

```bash
docker compose config
docker compose up --build -d
cd frontend && npm test -- --runInBand
cd .. && bash scripts/verify-s03.sh
docker compose down -v
```

A healthy security verification run proves all of the following:

1. Compose renders and the three services are healthy.
2. `/api/v1/health` returns the expected backend payload.
3. Anonymous access to `POST /api/v1/protected/vault-access-probe` returns the stable 401 auth contract.
4. Login succeeds with the configured bootstrap operator credentials.
5. Authenticated access to `POST /api/v1/protected/vault-access-probe` returns the expected operation/status/audit identifiers.
6. Logging out invalidates the session and the same sensitive route fails closed with the stable machine-readable denial code.
7. PostgreSQL contains the matching `audit_events` rows for both the allowed and denied attempts, including operation, outcome, reason code, and correlation/request identifiers.

This slice does **not** yet claim browser CSRF defenses, rate limiting, or broader security hardening beyond the audited sensitive-route contract above.
