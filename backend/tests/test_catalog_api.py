from datetime import UTC, datetime

from sqlalchemy.exc import SQLAlchemyError

from app.db.base import AuditEvent, CatalogUser, Organization
from app.db.session import SensitiveOperationAuditWriter
from tests.test_auth import login_as_admin


def test_catalog_endpoints_require_authentication(client):
    response = client.get("/api/v1/catalog/organization")
    assert response.status_code == 401
    assert response.json() == {
        "detail": {
            "code": "auth_unauthenticated",
            "message": "Authentication required.",
        }
    }

    response = client.get("/api/v1/catalog/users")
    assert response.status_code == 401
    assert response.json() == {
        "detail": {
            "code": "auth_unauthenticated",
            "message": "Authentication required.",
        }
    }


def test_read_organization_bootstraps_singleton_root(client, db_session):
    login_as_admin(client)

    response = client.get("/api/v1/catalog/organization")

    assert response.status_code == 200
    body = response.json()
    assert body["id"].startswith("org_")
    assert body["slug"] == "passark"
    assert body["display_name"] == "PassArk"
    assert body["description"] == "Primary organization for this PassArk deployment."

    stored_org = db_session.query(Organization).filter_by(id=body["id"]).one()
    assert stored_org.singleton_key == "organization_singleton"


def test_update_organization_persists_audit_event(client, db_session):
    login_as_admin(client)

    response = client.put(
        "/api/v1/catalog/organization",
        json={
            "display_name": "PassArk Labs",
            "description": "Operator-managed deployment root",
        },
        headers={
            "x-correlation-id": "catalog-corr-001",
            "x-request-id": "catalog-req-001",
            "user-agent": "pytest-catalog",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["organization"]["display_name"] == "PassArk Labs"
    assert body["organization"]["description"] == "Operator-managed deployment root"
    assert body["correlation_id"] == "catalog-corr-001"

    stored_org = db_session.query(Organization).one()
    assert stored_org.display_name == "PassArk Labs"

    audit_event = db_session.query(AuditEvent).filter_by(id=body["audit_event_id"]).one()
    assert audit_event.operation == "organization_update"
    assert audit_event.outcome == "organization_updated"
    assert audit_event.reason_code == "organization_updated"
    assert audit_event.request_id == "catalog-req-001"
    assert audit_event.correlation_id == "catalog-corr-001"
    assert audit_event.user_agent == "pytest-catalog"
    assert audit_event.metadata_json == {
        "organization_id": stored_org.id,
        "organization_slug": "passark",
    }
    assert "passark_session" not in str(audit_event.metadata_json)


def test_update_organization_fails_closed_when_audit_write_fails(client, monkeypatch):
    login_as_admin(client)

    def explode(*args, **kwargs):
        raise SQLAlchemyError("audit insert failed")

    monkeypatch.setattr(SensitiveOperationAuditWriter, "record", explode)

    response = client.put(
        "/api/v1/catalog/organization",
        json={"display_name": "PassArk Labs", "description": "test"},
    )

    assert response.status_code == 503
    assert response.json() == {
        "detail": {
            "code": "organization_update_audit_unavailable",
            "message": "Audit logging is required for organization updates.",
        }
    }


def test_list_catalog_users_returns_created_records(client, db_session):
    login_as_admin(client)
    organization = Organization(
        id="org_fixture",
        singleton_key="organization_singleton",
        slug="passark",
        display_name="PassArk",
    )
    db_session.add(organization)
    db_session.add(
        CatalogUser(
            id="cu_fixture",
            organization_id=organization.id,
            email="ada@example.com",
            full_name="Ada Lovelace",
            job_title="Analyst",
            is_active=True,
        )
    )
    db_session.commit()

    response = client.get("/api/v1/catalog/users")

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "id": "cu_fixture",
                "organization_id": "org_fixture",
                "email": "ada@example.com",
                "full_name": "Ada Lovelace",
                "job_title": "Analyst",
                "is_active": True,
                "created_at": db_session.query(CatalogUser).one().created_at.isoformat(),
                "updated_at": db_session.query(CatalogUser).one().updated_at.isoformat(),
            }
        ]
    }


def test_create_catalog_user_persists_distinct_catalog_record(client, db_session):
    login_as_admin(client)
    client.get("/api/v1/catalog/organization")

    response = client.post(
        "/api/v1/catalog/users",
        json={
            "email": " Operator@example.com ",
            "full_name": "Operator User",
            "job_title": "Ops Lead",
            "is_active": True,
        },
    )

    assert response.status_code == 201
    body = response.json()["catalog_user"]
    assert body["id"].startswith("cu_")
    assert body["email"] == "operator@example.com"
    assert body["full_name"] == "Operator User"
    assert body["job_title"] == "Ops Lead"
    assert body["is_active"] is True

    stored_catalog_user = db_session.query(CatalogUser).filter_by(id=body["id"]).one()
    assert stored_catalog_user.organization_id.startswith("org_")
    assert stored_catalog_user.email == "operator@example.com"

    organization = db_session.query(Organization).filter_by(id=stored_catalog_user.organization_id).one()
    assert organization.singleton_key == "organization_singleton"


def test_create_catalog_user_rejects_duplicates_with_stable_conflict_code(client):
    login_as_admin(client)
    client.get("/api/v1/catalog/organization")
    first_payload = {
        "email": "duplicate@example.com",
        "full_name": "First Person",
        "job_title": "Engineer",
        "is_active": True,
    }
    assert client.post("/api/v1/catalog/users", json=first_payload).status_code == 201

    response = client.post(
        "/api/v1/catalog/users",
        json={
            "email": "duplicate@example.com",
            "full_name": "Second Person",
            "job_title": "Engineer",
            "is_active": True,
        },
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": {
            "code": "catalog_user_conflict",
            "message": "Catalog user already exists.",
        }
    }


def test_create_catalog_user_rejects_invalid_payload(client):
    login_as_admin(client)

    response = client.post(
        "/api/v1/catalog/users",
        json={
            "email": "",
            "full_name": "",
            "job_title": "Engineer",
            "is_active": True,
        },
    )

    assert response.status_code == 422


def test_update_catalog_user_edits_existing_record(client, db_session):
    login_as_admin(client)
    organization = Organization(
        id="org_fixture",
        singleton_key="organization_singleton",
        slug="passark",
        display_name="PassArk",
    )
    catalog_user = CatalogUser(
        id="cu_fixture",
        organization_id=organization.id,
        email="existing@example.com",
        full_name="Existing User",
        job_title="Analyst",
        is_active=True,
    )
    db_session.add_all([organization, catalog_user])
    db_session.commit()

    response = client.put(
        "/api/v1/catalog/users/cu_fixture",
        json={
            "full_name": "Updated User",
            "job_title": "Principal Analyst",
            "is_active": False,
        },
    )

    assert response.status_code == 200
    body = response.json()["catalog_user"]
    assert body["email"] == "existing@example.com"
    assert body["full_name"] == "Updated User"
    assert body["job_title"] == "Principal Analyst"
    assert body["is_active"] is False

    db_session.refresh(catalog_user)
    assert catalog_user.full_name == "Updated User"
    assert catalog_user.job_title == "Principal Analyst"
    assert catalog_user.is_active is False


def test_update_catalog_user_rejects_missing_record(client):
    login_as_admin(client)

    response = client.put(
        "/api/v1/catalog/users/cu_missing",
        json={
            "full_name": "Updated User",
            "job_title": None,
            "is_active": True,
        },
    )

    assert response.status_code == 404
    assert response.json() == {
        "detail": {
            "code": "catalog_user_not_found",
            "message": "Catalog user was not found.",
        }
    }
