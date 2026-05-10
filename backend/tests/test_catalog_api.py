from sqlalchemy.exc import SQLAlchemyError

from app.db.base import (
    App,
    AuditEvent,
    CatalogUser,
    DirectRoleAssignment,
    Environment,
    Organization,
    Project,
    Resource,
    ScopedRole,
    Team,
    TeamMembership,
)
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

    response = client.get("/api/v1/catalog/teams")
    assert response.status_code == 401
    assert response.json() == {
        "detail": {
            "code": "auth_unauthenticated",
            "message": "Authentication required.",
        }
    }

    response = client.get("/api/v1/catalog/roles")
    assert response.status_code == 401
    assert response.json() == {
        "detail": {
            "code": "auth_unauthenticated",
            "message": "Authentication required.",
        }
    }

    response = client.get("/api/v1/catalog/memberships")
    assert response.status_code == 401
    assert response.json() == {
        "detail": {
            "code": "auth_unauthenticated",
            "message": "Authentication required.",
        }
    }

    response = client.get("/api/v1/catalog/assignments")
    assert response.status_code == 401
    assert response.json() == {
        "detail": {
            "code": "auth_unauthenticated",
            "message": "Authentication required.",
        }
    }

    response = client.get("/api/v1/catalog/apps")
    assert response.status_code == 401
    assert response.json() == {
        "detail": {
            "code": "auth_unauthenticated",
            "message": "Authentication required.",
        }
    }

    response = client.get("/api/v1/catalog/projects")
    assert response.status_code == 401
    assert response.json() == {
        "detail": {
            "code": "auth_unauthenticated",
            "message": "Authentication required.",
        }
    }

    response = client.get("/api/v1/catalog/environments")
    assert response.status_code == 401
    assert response.json() == {
        "detail": {
            "code": "auth_unauthenticated",
            "message": "Authentication required.",
        }
    }

    response = client.get("/api/v1/catalog/resources")
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


def test_team_and_scoped_role_catalog_happy_paths(client, db_session):
    login_as_admin(client)
    organization = Organization(
        id="org_fixture",
        singleton_key="organization_singleton",
        slug="passark",
        display_name="PassArk",
    )
    db_session.add(organization)
    db_session.commit()

    team_response = client.post(
        "/api/v1/catalog/teams",
        json={"name": " Platform Engineering ", "description": "Owns backend systems "},
    )
    assert team_response.status_code == 201
    team = team_response.json()["team"]
    assert team["id"].startswith("team_")
    assert team["organization_id"] == "org_fixture"
    assert team["name"] == "Platform Engineering"
    assert team["description"] == "Owns backend systems"

    org_role_response = client.post(
        "/api/v1/catalog/roles",
        json={
            "name": "Org Admin",
            "description": "Deployment-level operator",
            "scope_type": "organization",
            "scope_id": "org_fixture",
        },
    )
    assert org_role_response.status_code == 201
    org_role = org_role_response.json()["scoped_role"]
    assert org_role["id"].startswith("role_")
    assert org_role["scope_type"] == "organization"
    assert org_role["scope_id"] == "org_fixture"

    team_role_response = client.post(
        "/api/v1/catalog/roles",
        json={
            "name": "Team Maintainer",
            "description": "Maintains the team resources",
            "scope_type": "team",
            "scope_id": team["id"],
        },
    )
    assert team_role_response.status_code == 201
    team_role = team_role_response.json()["scoped_role"]
    assert team_role["scope_type"] == "team"
    assert team_role["scope_id"] == team["id"]

    list_teams = client.get("/api/v1/catalog/teams")
    assert list_teams.status_code == 200
    assert list_teams.json()["items"] == [team]

    list_roles = client.get("/api/v1/catalog/roles")
    assert list_roles.status_code == 200
    assert [item["id"] for item in list_roles.json()["items"]] == [org_role["id"], team_role["id"]]

    stored_team = db_session.query(Team).filter_by(id=team["id"]).one()
    stored_org_role = db_session.query(ScopedRole).filter_by(id=org_role["id"]).one()
    stored_team_role = db_session.query(ScopedRole).filter_by(id=team_role["id"]).one()
    assert stored_team.organization_id == organization.id
    assert stored_org_role.scope_type == "organization"
    assert stored_team_role.scope_type == "team"


def test_team_and_role_conflicts_return_stable_error_codes(client):
    login_as_admin(client)
    client.get("/api/v1/catalog/organization")

    first_team = client.post(
        "/api/v1/catalog/teams",
        json={"name": "Security", "description": "Handles review"},
    )
    assert first_team.status_code == 201

    duplicate_team = client.post(
        "/api/v1/catalog/teams",
        json={"name": "Security", "description": "Duplicate"},
    )
    assert duplicate_team.status_code == 409
    assert duplicate_team.json() == {
        "detail": {
            "code": "team_conflict",
            "message": "Team already exists.",
        }
    }

    org = client.get("/api/v1/catalog/organization").json()
    first_role = client.post(
        "/api/v1/catalog/roles",
        json={
            "name": "Auditor",
            "description": "Read-only role",
            "scope_type": "organization",
            "scope_id": org["id"],
        },
    )
    assert first_role.status_code == 201

    duplicate_role = client.post(
        "/api/v1/catalog/roles",
        json={
            "name": "Auditor",
            "description": "Duplicate role",
            "scope_type": "organization",
            "scope_id": org["id"],
        },
    )
    assert duplicate_role.status_code == 409
    assert duplicate_role.json() == {
        "detail": {
            "code": "scoped_role_conflict",
            "message": "Scoped role already exists.",
        }
    }


def test_create_scoped_role_rejects_invalid_scope_container_combinations(client, db_session):
    login_as_admin(client)
    organization = Organization(
        id="org_fixture",
        singleton_key="organization_singleton",
        slug="passark",
        display_name="PassArk",
    )
    db_session.add(organization)
    db_session.commit()

    wrong_org_scope = client.post(
        "/api/v1/catalog/roles",
        json={
            "name": "Org Admin",
            "description": "Bad org scope",
            "scope_type": "organization",
            "scope_id": "org_other",
        },
    )
    assert wrong_org_scope.status_code == 422
    assert wrong_org_scope.json() == {
        "detail": {
            "code": "scoped_role_scope_mismatch",
            "message": "Scoped role scope_type and scope_id do not match a valid catalog container.",
        }
    }

    unknown_team_scope = client.post(
        "/api/v1/catalog/roles",
        json={
            "name": "Team Maintainer",
            "description": "Bad team scope",
            "scope_type": "team",
            "scope_id": "team_missing",
        },
    )
    assert unknown_team_scope.status_code == 422
    assert unknown_team_scope.json() == {
        "detail": {
            "code": "scoped_role_scope_mismatch",
            "message": "Scoped role scope_type and scope_id do not match a valid catalog container.",
        }
    }

    unknown_scope_type = client.post(
        "/api/v1/catalog/roles",
        json={
            "name": "Mystery Role",
            "description": "Bad scope type",
            "scope_type": "project",
            "scope_id": "proj_123",
        },
    )
    assert unknown_scope_type.status_code == 422
    assert unknown_scope_type.json() == {
        "detail": {
            "code": "scoped_role_scope_mismatch",
            "message": "Scoped role scope_type and scope_id do not match a valid catalog container.",
        }
    }


def test_memberships_and_assignments_support_happy_paths_and_observable_listing(client, db_session):
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
        email="operator@example.com",
        full_name="Operator User",
        job_title="Ops Lead",
        is_active=True,
    )
    team = Team(
        id="team_fixture",
        organization_id=organization.id,
        name="Security",
        description="Handles review",
    )
    scoped_role = ScopedRole(
        id="role_fixture",
        organization_id=organization.id,
        name="Team Maintainer",
        description="Maintains team resources",
        scope_type="team",
        scope_id=team.id,
    )
    db_session.add_all([organization, catalog_user, team, scoped_role])
    db_session.commit()

    membership_response = client.post(
        "/api/v1/catalog/memberships",
        json={"team_id": "team_fixture", "catalog_user_id": "cu_fixture"},
    )
    assert membership_response.status_code == 201
    membership = membership_response.json()["membership"]
    assert membership["id"].startswith("tm_")
    assert membership["team_id"] == "team_fixture"
    assert membership["catalog_user_id"] == "cu_fixture"

    assignment_response = client.post(
        "/api/v1/catalog/assignments",
        json={"scoped_role_id": "role_fixture", "catalog_user_id": "cu_fixture"},
    )
    assert assignment_response.status_code == 201
    assignment = assignment_response.json()["assignment"]
    assert assignment["id"].startswith("dra_")
    assert assignment["scoped_role_id"] == "role_fixture"
    assert assignment["catalog_user_id"] == "cu_fixture"

    membership_list = client.get("/api/v1/catalog/memberships")
    assignment_list = client.get("/api/v1/catalog/assignments")
    assert membership_list.status_code == 200
    assert membership_list.json()["items"] == [membership]
    assert assignment_list.status_code == 200
    assert assignment_list.json()["items"] == [assignment]

    stored_membership = db_session.query(TeamMembership).filter_by(id=membership["id"]).one()
    stored_assignment = db_session.query(DirectRoleAssignment).filter_by(id=assignment["id"]).one()
    assert stored_membership.team_id == team.id
    assert stored_assignment.scoped_role_id == scoped_role.id


def test_membership_and_assignment_failures_return_stable_machine_readable_codes(client, db_session):
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
        email="operator@example.com",
        full_name="Operator User",
        job_title="Ops Lead",
        is_active=True,
    )
    team = Team(
        id="team_fixture",
        organization_id=organization.id,
        name="Security",
        description="Handles review",
    )
    scoped_role = ScopedRole(
        id="role_fixture",
        organization_id=organization.id,
        name="Team Maintainer",
        description="Maintains team resources",
        scope_type="team",
        scope_id=team.id,
    )
    db_session.add_all([organization, catalog_user, team, scoped_role])
    db_session.commit()

    first_membership = client.post(
        "/api/v1/catalog/memberships",
        json={"team_id": "team_fixture", "catalog_user_id": "cu_fixture"},
    )
    assert first_membership.status_code == 201

    duplicate_membership = client.post(
        "/api/v1/catalog/memberships",
        json={"team_id": "team_fixture", "catalog_user_id": "cu_fixture"},
    )
    assert duplicate_membership.status_code == 409
    assert duplicate_membership.json() == {
        "detail": {
            "code": "team_membership_conflict",
            "message": "Catalog user is already a member of this team.",
        }
    }

    missing_team = client.post(
        "/api/v1/catalog/memberships",
        json={"team_id": "team_missing", "catalog_user_id": "cu_fixture"},
    )
    assert missing_team.status_code == 404
    assert missing_team.json() == {
        "detail": {
            "code": "team_not_found",
            "message": "Team was not found.",
        }
    }

    missing_membership_user = client.post(
        "/api/v1/catalog/memberships",
        json={"team_id": "team_fixture", "catalog_user_id": "cu_missing"},
    )
    assert missing_membership_user.status_code == 404
    assert missing_membership_user.json() == {
        "detail": {
            "code": "catalog_user_not_found",
            "message": "Catalog user was not found.",
        }
    }

    first_assignment = client.post(
        "/api/v1/catalog/assignments",
        json={"scoped_role_id": "role_fixture", "catalog_user_id": "cu_fixture"},
    )
    assert first_assignment.status_code == 201

    duplicate_assignment = client.post(
        "/api/v1/catalog/assignments",
        json={"scoped_role_id": "role_fixture", "catalog_user_id": "cu_fixture"},
    )
    assert duplicate_assignment.status_code == 409
    assert duplicate_assignment.json() == {
        "detail": {
            "code": "direct_role_assignment_conflict",
            "message": "Catalog user already has this scoped role.",
        }
    }

    missing_role = client.post(
        "/api/v1/catalog/assignments",
        json={"scoped_role_id": "role_missing", "catalog_user_id": "cu_fixture"},
    )
    assert missing_role.status_code == 404
    assert missing_role.json() == {
        "detail": {
            "code": "scoped_role_not_found",
            "message": "Scoped role was not found.",
        }
    }

    missing_assignment_user = client.post(
        "/api/v1/catalog/assignments",
        json={"scoped_role_id": "role_fixture", "catalog_user_id": "cu_missing"},
    )
    assert missing_assignment_user.status_code == 404
    assert missing_assignment_user.json() == {
        "detail": {
            "code": "catalog_user_not_found",
            "message": "Catalog user was not found.",
        }
    }


def test_app_project_environment_and_resource_happy_path(client, db_session):
    login_as_admin(client)
    organization = Organization(
        id="org_fixture",
        singleton_key="organization_singleton",
        slug="passark",
        display_name="PassArk",
    )
    team = Team(
        id="team_fixture",
        organization_id=organization.id,
        name="Security",
        description="Handles review",
    )
    db_session.add_all([organization, team])
    db_session.commit()

    app_response = client.post(
        "/api/v1/catalog/apps",
        json={"name": " Customer Portal ", "description": " Primary frontend "},
    )
    assert app_response.status_code == 201
    app = app_response.json()["app"]
    assert app["id"].startswith("app_")
    assert app["name"] == "Customer Portal"
    assert app["organization_id"] == organization.id

    project_response = client.post(
        "/api/v1/catalog/projects",
        json={"app_id": app["id"], "name": " Identity API ", "description": " Backend service "},
    )
    assert project_response.status_code == 201
    project = project_response.json()["project"]
    assert project["id"].startswith("proj_")
    assert project["app_id"] == app["id"]
    assert project["name"] == "Identity API"

    environment_response = client.post(
        "/api/v1/catalog/environments",
        json={"project_id": project["id"], "name": " Production ", "description": " Live env "},
    )
    assert environment_response.status_code == 201
    environment = environment_response.json()["environment"]
    assert environment["id"].startswith("env_")
    assert environment["project_id"] == project["id"]
    assert environment["name"] == "Production"

    resource_response = client.post(
        "/api/v1/catalog/resources",
        json={
            "name": "Orders Database",
            "resource_type": "database",
            "container_type": "environment",
            "container_id": environment["id"],
            "scope_type": "team",
            "scope_id": team.id,
            "description": "Aurora cluster backing order writes",
            "metadata": {"engine": "postgres", "tier": "production"},
        },
    )
    assert resource_response.status_code == 201
    resource = resource_response.json()["resource"]
    assert resource["id"].startswith("res_")
    assert resource["app_id"] == app["id"]
    assert resource["project_id"] == project["id"]
    assert resource["environment_id"] == environment["id"]
    assert resource["resource_type"] == "database"
    assert resource["container_type"] == "environment"
    assert resource["scope_type"] == "team"
    assert resource["metadata"] == {"engine": "postgres", "tier": "production"}

    assert client.get("/api/v1/catalog/apps").json()["items"] == [app]
    assert client.get("/api/v1/catalog/projects").json()["items"] == [project]
    assert client.get("/api/v1/catalog/environments").json()["items"] == [environment]
    assert client.get("/api/v1/catalog/resources").json()["items"] == [resource]

    stored_app = db_session.query(App).filter_by(id=app["id"]).one()
    stored_project = db_session.query(Project).filter_by(id=project["id"]).one()
    stored_environment = db_session.query(Environment).filter_by(id=environment["id"]).one()
    stored_resource = db_session.query(Resource).filter_by(id=resource["id"]).one()
    assert stored_project.app_id == stored_app.id
    assert stored_environment.project_id == stored_project.id
    assert stored_resource.app_id == stored_app.id
    assert stored_resource.project_id == stored_project.id
    assert stored_resource.environment_id == stored_environment.id
    assert stored_resource.metadata_json == {"engine": "postgres", "tier": "production"}
    assert "password" not in str(stored_resource.metadata_json)


def test_app_project_environment_and_resource_failures_are_machine_readable(client):
    login_as_admin(client)
    org = client.get("/api/v1/catalog/organization").json()

    first_app = client.post(
        "/api/v1/catalog/apps",
        json={"name": "Portal", "description": "UI"},
    )
    assert first_app.status_code == 201
    app = first_app.json()["app"]

    duplicate_app = client.post(
        "/api/v1/catalog/apps",
        json={"name": "Portal", "description": "Duplicate"},
    )
    assert duplicate_app.status_code == 409
    assert duplicate_app.json() == {
        "detail": {
            "code": "app_conflict",
            "message": "App already exists.",
        }
    }

    missing_project_parent = client.post(
        "/api/v1/catalog/projects",
        json={"app_id": "app_missing", "name": "Identity API", "description": "backend"},
    )
    assert missing_project_parent.status_code == 404
    assert missing_project_parent.json() == {
        "detail": {
            "code": "app_not_found",
            "message": "App was not found.",
        }
    }

    first_project = client.post(
        "/api/v1/catalog/projects",
        json={"app_id": app["id"], "name": "Identity API", "description": "backend"},
    )
    assert first_project.status_code == 201
    project = first_project.json()["project"]

    duplicate_project = client.post(
        "/api/v1/catalog/projects",
        json={"app_id": app["id"], "name": "Identity API", "description": "duplicate"},
    )
    assert duplicate_project.status_code == 409
    assert duplicate_project.json() == {
        "detail": {
            "code": "project_conflict",
            "message": "Project already exists for this app.",
        }
    }

    missing_environment_parent = client.post(
        "/api/v1/catalog/environments",
        json={"project_id": "proj_missing", "name": "prod", "description": "missing"},
    )
    assert missing_environment_parent.status_code == 404
    assert missing_environment_parent.json() == {
        "detail": {
            "code": "project_not_found",
            "message": "Project was not found.",
        }
    }

    first_environment = client.post(
        "/api/v1/catalog/environments",
        json={"project_id": project["id"], "name": "prod", "description": "live"},
    )
    assert first_environment.status_code == 201
    environment = first_environment.json()["environment"]

    duplicate_environment = client.post(
        "/api/v1/catalog/environments",
        json={"project_id": project["id"], "name": "prod", "description": "duplicate"},
    )
    assert duplicate_environment.status_code == 409
    assert duplicate_environment.json() == {
        "detail": {
            "code": "environment_conflict",
            "message": "Environment already exists for this project.",
        }
    }

    invalid_resource_parent = client.post(
        "/api/v1/catalog/resources",
        json={
            "name": "Orders Database",
            "resource_type": "database",
            "container_type": "environment",
            "container_id": "env_missing",
            "scope_type": "organization",
            "scope_id": org["id"],
            "description": "missing env",
            "metadata": {"engine": "postgres"},
        },
    )
    assert invalid_resource_parent.status_code == 404
    assert invalid_resource_parent.json() == {
        "detail": {
            "code": "environment_not_found",
            "message": "Environment was not found.",
        }
    }

    invalid_resource_scope = client.post(
        "/api/v1/catalog/resources",
        json={
            "name": "Orders Database",
            "resource_type": "database",
            "container_type": "environment",
            "container_id": environment["id"],
            "scope_type": "organization",
            "scope_id": "org_missing",
            "description": "bad scope",
            "metadata": {"engine": "postgres"},
        },
    )
    assert invalid_resource_scope.status_code == 422
    assert invalid_resource_scope.json() == {
        "detail": {
            "code": "scoped_role_scope_mismatch",
            "message": "Scoped role scope_type and scope_id do not match a valid catalog container.",
        }
    }

    invalid_resource_type = client.post(
        "/api/v1/catalog/resources",
        json={
            "name": "Orders Database",
            "resource_type": "ssh_key",
            "container_type": "environment",
            "container_id": environment["id"],
            "scope_type": "organization",
            "scope_id": org["id"],
            "description": "bad type",
            "metadata": {"engine": "postgres"},
        },
    )
    assert invalid_resource_type.status_code == 422
    assert invalid_resource_type.json() == {
        "detail": {
            "code": "resource_container_mismatch",
            "message": "Resource container_type and container_id do not match a valid catalog container.",
        }
    }

    invalid_secret_payload = client.post(
        "/api/v1/catalog/resources",
        json={
            "name": "Orders Database",
            "resource_type": "database",
            "container_type": "environment",
            "container_id": environment["id"],
            "scope_type": "organization",
            "scope_id": org["id"],
            "description": "bad metadata",
            "metadata": {"password": "super-secret"},
        },
    )
    assert invalid_secret_payload.status_code == 422
    assert invalid_secret_payload.json() == {
        "detail": {
            "code": "resource_secret_payload_forbidden",
            "message": "Resource metadata must stay descriptive and cannot store secret payloads.",
        }
    }

    first_resource = client.post(
        "/api/v1/catalog/resources",
        json={
            "name": "Orders Database",
            "resource_type": "database",
            "container_type": "environment",
            "container_id": environment["id"],
            "scope_type": "organization",
            "scope_id": org["id"],
            "description": "primary datastore",
            "metadata": {"engine": "postgres"},
        },
    )
    assert first_resource.status_code == 201

    duplicate_resource = client.post(
        "/api/v1/catalog/resources",
        json={
            "name": "Orders Database",
            "resource_type": "database",
            "container_type": "environment",
            "container_id": environment["id"],
            "scope_type": "organization",
            "scope_id": org["id"],
            "description": "duplicate",
            "metadata": {"engine": "postgres"},
        },
    )
    assert duplicate_resource.status_code == 409
    assert duplicate_resource.json() == {
        "detail": {
            "code": "resource_conflict",
            "message": "Resource already exists for this container and scope.",
        }
    }
