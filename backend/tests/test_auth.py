from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError

from app.db.base import AuditEvent, Session, User
from app.db.session import SensitiveOperationAuditWriter, password_hasher


def login_as_admin(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@passark.local", "password": "change-me-now"},
    )
    assert response.status_code == 200
    return response


def test_auth_login_preflight_allows_local_frontend_origin(client):
    response = client.options(
        "/api/v1/auth/login",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_login_sets_session_cookie_and_persists_session(client, db_session):
    response = login_as_admin(client)

    assert response.json()["user"]["email"] == "admin@passark.local"
    assert "passark_session" in response.cookies

    stored_user = db_session.query(User).filter_by(email="admin@passark.local").one()
    stored_session = db_session.query(Session).filter_by(user_id=stored_user.id).one()
    assert stored_session.token == response.cookies["passark_session"]
    assert stored_session.invalidated_at is None


def test_invalid_login_returns_stable_401_contract(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@passark.local", "password": "wrong-password"},
    )

    assert response.status_code == 401
    assert response.json() == {
        "detail": {
            "code": "auth_unauthenticated",
            "message": "Authentication required.",
        }
    }


def test_login_fails_closed_when_stored_password_hash_is_malformed(client, db_session):
    response = login_as_admin(client)
    stored_user = db_session.query(User).filter_by(email="admin@passark.local").one()
    stored_user.password_hash = "totally-not-a-valid-hash"
    db_session.add(stored_user)
    db_session.commit()
    client.cookies.clear()

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@passark.local", "password": "change-me-now"},
    )

    assert response.status_code == 500
    assert response.json() == {
        "detail": {
            "code": "auth_malformed_state",
            "message": "Stored authentication state is invalid.",
        }
    }


def test_auth_session_returns_current_user(client):
    login_as_admin(client)

    response = client.get("/api/v1/auth/session")

    assert response.status_code == 200
    assert response.json() == {
        "user": {
            "id": 1,
            "email": "admin@passark.local",
            "is_active": True,
        }
    }


def test_anonymous_protected_access_is_rejected(client):
    response = client.get("/api/v1/protected/whoami")

    assert response.status_code == 401
    assert response.json() == {
        "detail": {
            "code": "auth_unauthenticated",
            "message": "Authentication required.",
        }
    }


def test_authenticated_protected_access_succeeds(client):
    login_as_admin(client)

    response = client.get("/api/v1/protected/whoami")

    assert response.status_code == 200
    body = response.json()
    assert body["user"]["email"] == "admin@passark.local"
    assert body["session_id"] > 0


def test_sensitive_operation_persists_success_audit_event(client, db_session):
    login_as_admin(client)

    response = client.post(
        "/api/v1/protected/vault-access-probe",
        headers={
            "x-request-id": "req-123",
            "x-correlation-id": "corr-456",
            "user-agent": "pytest-agent",
            "x-forwarded-for": "203.0.113.10",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["operation"] == "vault_access_probe"
    assert body["status"] == "allowed"

    audit_event = db_session.query(AuditEvent).filter_by(id=body["audit_event_id"]).one()
    assert audit_event.operation == "vault_access_probe"
    assert audit_event.outcome == "sensitive_operation_allowed"
    assert audit_event.reason_code == "sensitive_operation_allowed"
    assert audit_event.actor_user_id == body["actor_id"]
    assert audit_event.request_id == "req-123"
    assert audit_event.correlation_id == "corr-456"
    assert audit_event.ip_address == "203.0.113.10"
    assert audit_event.user_agent == "pytest-agent"
    assert audit_event.metadata_json == {"user_email": "admin@passark.local"}
    assert "change-me-now" not in str(audit_event.metadata_json)
    assert response.cookies.get("passark_session") is None


def test_sensitive_operation_rejects_expired_session_and_persists_denial(client, db_session):
    login_as_admin(client)
    stored_session = db_session.query(Session).one()
    stored_session.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db_session.add(stored_session)
    db_session.commit()

    response = client.post("/api/v1/protected/vault-access-probe")

    assert response.status_code == 401
    assert response.json() == {
        "detail": {
            "code": "auth_unauthenticated",
            "message": "Authentication required.",
        }
    }

    denial_event = db_session.query(AuditEvent).filter_by(session_id=stored_session.id).one()
    assert denial_event.outcome == "sensitive_operation_denied"
    assert denial_event.reason_code == "auth_unauthenticated"
    assert denial_event.metadata_json == {"cause": "session_expired"}


def test_sensitive_operation_rejects_inactive_user_and_persists_denial(client, db_session):
    login_as_admin(client)
    stored_user = db_session.query(User).filter_by(email="admin@passark.local").one()
    stored_user.is_active = False
    db_session.add(stored_user)
    db_session.commit()

    response = client.post("/api/v1/protected/vault-access-probe")

    assert response.status_code == 403
    assert response.json() == {
        "detail": {
            "code": "auth_inactive_user",
            "message": "Active account required.",
        }
    }

    denial_event = db_session.query(AuditEvent).filter_by(actor_user_id=stored_user.id).one()
    assert denial_event.outcome == "sensitive_operation_denied"
    assert denial_event.reason_code == "auth_inactive_user"
    assert denial_event.metadata_json == {"cause": "inactive_user"}


def test_sensitive_operation_fails_closed_when_audit_write_fails(client, monkeypatch):
    login_as_admin(client)

    def explode(*args, **kwargs):
        raise SQLAlchemyError("db write failed")

    monkeypatch.setattr(SensitiveOperationAuditWriter, "record", explode)

    response = client.post("/api/v1/protected/vault-access-probe")

    assert response.status_code == 503
    assert response.json() == {
        "detail": {
            "code": "audit_unavailable",
            "message": "Audit logging is required for this operation.",
        }
    }


def test_logout_invalidates_the_session(client, db_session):
    login_response = login_as_admin(client)
    session_token = login_response.cookies["passark_session"]

    logout_response = client.post("/api/v1/auth/logout")
    assert logout_response.status_code == 204

    stored_session = db_session.query(Session).filter_by(token=session_token).one()
    assert stored_session.invalidated_at is not None

    response = client.get("/api/v1/protected/whoami")
    assert response.status_code == 401


def test_password_hasher_rejects_malformed_encoded_state():
    with pytest.raises(ValueError):
        password_hasher.verify_password("change-me-now", "missing-delimiters")
