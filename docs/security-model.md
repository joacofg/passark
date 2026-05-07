# PassArk security model

This document records the **implemented** security baseline currently proven in-repo for local development and contributor verification. It is intentionally narrow: it describes the shipped cookie-session auth flow, the audited sensitive-route contract, the stable machine-readable denial codes, and the persisted evidence contributors can inspect today.

If you want the command surface first, start with `README.md` and `docs/local-development.md`, then return here for the exact auth/audit contract those commands prove.

## What this document does and does not claim

This is **not** a production-hardening guide and **not** a general web security checklist. It only describes behavior that is currently exercised by:

- `backend/tests/test_auth.py`
- `bash scripts/verify-s02.sh`
- `bash scripts/verify-s03.sh`
- `bash scripts/verify-milestone.sh`

Where this repository does **not** yet implement a defense, this document says so explicitly.

## Auth model: backend-owned cookie session

PassArk currently uses a backend-owned session model.

- `POST /api/v1/auth/login` accepts an email and password.
- The backend verifies those credentials against the configured bootstrap operator.
- On success, the backend creates a persisted session row and returns an **HTTP-only cookie**.
- The frontend is expected to call the backend with `credentials: include`; it is **not** the source of truth for auth state and does **not** manage a bearer token.
- `GET /api/v1/auth/session` returns the current authenticated user when the cookie maps to a valid active session.
- `POST /api/v1/auth/logout` invalidates the stored session and clears the cookie.
- `GET /api/v1/protected/whoami` is the simple protected-route contract used to prove anonymous rejection and authenticated access.

### Bootstrap operator assumption

The current baseline assumes one bootstrap operator configured through environment variables. The relevant keys are documented by name only:

- `AUTH_BOOTSTRAP_ADMIN_EMAIL`
- `AUTH_BOOTSTRAP_ADMIN_PASSWORD`
- `AUTH_SESSION_COOKIE_NAME`
- `AUTH_SESSION_COOKIE_SECURE`
- `AUTH_SESSION_COOKIE_SAMESITE`
- `AUTH_SESSION_COOKIE_DOMAIN`
- `AUTH_SESSION_TTL_HOURS`

The default local identifier is `admin@passark.local`. The code intentionally accepts that reserved local-domain address for local development.

### Session persistence and invalidation

Successful login persists a row in `sessions` with:

- a generated session token
- `user_id`
- `expires_at`
- optional `invalidated_at`

A session is treated as unauthenticated when any of the following is true:

- the cookie is missing
- the session row does not exist
- the session is expired
- the session has been invalidated by logout

## Stable denial and failure contracts

These machine-readable codes are part of the current contributor-visible diagnostic contract because they are asserted in tests and verification scripts.

| Condition | HTTP status | Code | Meaning |
|---|---:|---|---|
| Missing, expired, invalidated, or unknown session on protected access | 401 | `auth_unauthenticated` | Authentication is required and the request is not operating under a valid current session. |
| Authenticated session belongs to an inactive user | 403 | `auth_inactive_user` | A session exists, but an active account is required for the operation. |
| Stored password hash is malformed | 500 | `auth_malformed_state` | Persisted auth state is internally invalid; login fails closed. |
| Sensitive route cannot persist required audit evidence | 503 | `audit_unavailable` | Audit logging is mandatory for the operation, so the request is denied rather than proceeding without evidence. |

Contributors should treat those codes as the current stable seam for local verification and failure triage.

## Audited sensitive-route model

The current audited sensitive route is:

- `POST /api/v1/protected/vault-access-probe`

This route is intentionally narrow. It is the repository’s proof point for a security-sensitive operation that must:

1. reject anonymous access,
2. allow authenticated access under a valid active session,
3. fail closed when audit persistence is unavailable, and
4. write durable audit evidence for both success and denial paths when enough context exists.

### Success path

When an authenticated active user calls `vault-access-probe`:

- the route returns status `200`
- the payload includes `operation`, `status`, `actor_id`, and `audit_event_id`
- the operation name is `vault_access_probe`
- the status is `allowed`
- an `audit_events` row is persisted with:
  - `operation = vault_access_probe`
  - `outcome = sensitive_operation_allowed`
  - `reason_code = sensitive_operation_allowed`
  - `actor_user_id`
  - `session_id`
  - request-scoped evidence such as `request_id`, `correlation_id`, `ip_address`, and `user_agent`
  - metadata containing `user_email`

### Denial path

When the same sensitive route is denied after a session becomes invalidated or otherwise ineligible:

- the route returns the same auth denial contract where applicable, typically `401` with `auth_unauthenticated`
- the guard attempts to persist an `audit_events` row for the denied access
- the denial row uses:
  - `operation = vault_access_probe`
  - `outcome = sensitive_operation_denied`
  - `reason_code` matching the denial cause, such as `auth_unauthenticated` or `auth_inactive_user`
  - metadata describing the cause, such as `session_invalidated`, `session_expired`, or `inactive_user`

### Audit-write failure path

If audit persistence itself fails for the sensitive route, the route does **not** proceed optimistically. It fails closed with:

- HTTP `503`
- code `audit_unavailable`

That behavior is intentional: the sensitive route requires durable audit evidence as part of its contract.

## Persisted audit evidence

The durable evidence surface is the `audit_events` table. Current stored fields include:

- `operation`
- `outcome`
- `reason_code`
- `actor_user_id`
- `session_id`
- `request_id`
- `correlation_id`
- `ip_address`
- `user_agent`
- `metadata_json`
- `created_at`

This repository’s compose-backed verification uses those fields to prove that success and denial are not only visible in HTTP responses but also persisted in PostgreSQL.

### How to inspect the evidence

Use the documented verification entrypoints first:

```bash
make backend-test
make quality-gates
make verify-s02
make verify-s03
make verify-milestone
```

Or run the scripts directly:

```bash
bash scripts/verify-s02.sh
bash scripts/verify-s03.sh
bash scripts/verify-milestone.sh
```

`make quality-gates` is the fast host-side regression sweep. It proves the tracked backend/frontend tests and lint still pass, but it does **not** prove Docker availability, compose health, cookie-session integration, or persisted PostgreSQL audit evidence.

`verify-s02` is the canonical proof that the protected operator shell and backend session contract are still aligned. It verifies anonymous `whoami` rejection, bootstrap login success, authenticated `whoami` access, and the operator-facing shell copy for the loading state plus `vault-access-probe` affordance.

`verify-s03` is the canonical proof for the security-sensitive route. It:

- checks Docker Compose service health,
- probes `/api/v1/health`,
- proves anonymous denial for `vault-access-probe`,
- logs in with the configured bootstrap operator,
- proves authenticated access to the sensitive route,
- logs out to invalidate the session,
- proves fail-closed denial for the invalidated session, and
- queries PostgreSQL `audit_events` rows by correlation/request identifiers.

`verify-milestone` is the canonical milestone-level wrapper. It prints a compose service snapshot, treats Docker daemon availability as an explicit infrastructure gate, and then runs `verify-s02` followed by `verify-s03` without changing their acceptance contract. Use it when you need one truthful compose-backed proof of the assembled auth, operator-shell, and audit-evidence flow.

When investigating drift or failures, the first inspection surfaces are:

```bash
docker compose ps
docker compose logs backend
docker compose logs frontend
docker compose logs postgres
curl http://localhost:8000/api/v1/health
bash scripts/verify-s03.sh
```

## Threat boundaries and current limits

The implemented boundary today is intentionally small.

### What is protected today

Today’s repository proof covers:

- cookie-backed authentication for protected routes,
- logout-driven session invalidation,
- inactive-user denial on protected access,
- audited success and denial for one sensitive operation (`vault-access-probe`), and
- fail-closed behavior when required audit persistence is unavailable.

### What is not claimed today

This repository does **not** currently claim that it has:

- comprehensive **CSRF** mitigation for browser-driven state-changing requests,
- brute-force protection or account lockout,
- request **rate limit** defenses,
- multi-factor authentication,
- authorization roles beyond the current bootstrap-operator baseline,
- secret rotation workflows,
- production cookie policy guidance beyond the exposed environment knobs,
- broad coverage for every sensitive domain operation,
- a guarantee that compose-backed proof can run when Docker is unavailable.

### Environment-gated proof

`verify-s02` and `verify-s03` are intentionally compose-backed verification surfaces. They are useful because they prove real backend, frontend, and PostgreSQL behavior together, but they are also environment-gated:

- if Docker is not installed, they cannot run;
- if the Docker daemon is unavailable, they fail before app-level verification begins.

That is an infrastructure-gating condition, not evidence that the auth or audit model itself regressed. Contributors should distinguish Docker availability failures from application failures before debugging service code.

## Non-goals for this slice

This slice documents the current security posture; it does **not** attempt to extend it.

Non-goals include:

- adding new auth mechanisms,
- claiming production readiness,
- claiming CSRF protection that is not yet implemented,
- claiming rate limiting that is not yet implemented,
- replacing the bootstrap operator with a broader identity model,
- documenting or exposing any real secret values.

## Secret hygiene

This repository documents **variable names and data flow**, not credential contents.

- Use `.env.example` for key names.
- Keep real values only in local `.env` files or other private secret stores.
- Do not paste cookies, passwords, session tokens, or database secrets into docs, tests, screenshots, or issue reports.
- Audit metadata should remain limited to operational evidence such as `user_email`, request/correlation IDs, and denial causes rather than raw secrets.

## Related docs

- `README.md` — root command surface and contributor entrypoints
- `docs/local-development.md` — Compose-first setup, verification flow, and diagnostic commands
