from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session as OrmSession

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
    User,
)
from app.db.session import (
    SensitiveOperationAuditWriter,
    SensitiveOperationContext,
    get_current_user,
    get_db,
    get_sensitive_operation_guard,
)

router = APIRouter(prefix="/catalog", tags=["catalog"])

ORGANIZATION_BOOTSTRAP_NAME = "PassArk"
ORGANIZATION_CODE = "organization_singleton"
DEFAULT_SCOPE_TYPE = "organization"
CATALOG_DUPLICATE_ERROR = {
    "code": "catalog_user_conflict",
    "message": "Catalog user already exists.",
}
CATALOG_NOT_FOUND_ERROR = {
    "code": "catalog_user_not_found",
    "message": "Catalog user was not found.",
}
ORGANIZATION_UPDATE_AUDIT_ERROR = {
    "code": "organization_update_audit_unavailable",
    "message": "Audit logging is required for organization updates.",
}
TEAM_DUPLICATE_ERROR = {
    "code": "team_conflict",
    "message": "Team already exists.",
}
TEAM_NOT_FOUND_ERROR = {
    "code": "team_not_found",
    "message": "Team was not found.",
}
SCOPED_ROLE_DUPLICATE_ERROR = {
    "code": "scoped_role_conflict",
    "message": "Scoped role already exists.",
}
SCOPED_ROLE_NOT_FOUND_ERROR = {
    "code": "scoped_role_not_found",
    "message": "Scoped role was not found.",
}
TEAM_MEMBERSHIP_DUPLICATE_ERROR = {
    "code": "team_membership_conflict",
    "message": "Catalog user is already a member of this team.",
}
DIRECT_ROLE_ASSIGNMENT_DUPLICATE_ERROR = {
    "code": "direct_role_assignment_conflict",
    "message": "Catalog user already has this scoped role.",
}
SCOPE_MISMATCH_ERROR = {
    "code": "scoped_role_scope_mismatch",
    "message": "Scoped role scope_type and scope_id do not match a valid catalog container.",
}
APP_DUPLICATE_ERROR = {
    "code": "app_conflict",
    "message": "App already exists.",
}
APP_NOT_FOUND_ERROR = {
    "code": "app_not_found",
    "message": "App was not found.",
}
PROJECT_DUPLICATE_ERROR = {
    "code": "project_conflict",
    "message": "Project already exists for this app.",
}
PROJECT_NOT_FOUND_ERROR = {
    "code": "project_not_found",
    "message": "Project was not found.",
}
ENVIRONMENT_DUPLICATE_ERROR = {
    "code": "environment_conflict",
    "message": "Environment already exists for this project.",
}
ENVIRONMENT_NOT_FOUND_ERROR = {
    "code": "environment_not_found",
    "message": "Environment was not found.",
}
RESOURCE_DUPLICATE_ERROR = {
    "code": "resource_conflict",
    "message": "Resource already exists for this container and scope.",
}
RESOURCE_SCOPE_MISMATCH_ERROR = {
    "code": "resource_scope_mismatch",
    "message": "Resource scope_type and scope_id do not match a valid catalog hierarchy.",
}
RESOURCE_CONTAINER_MISMATCH_ERROR = {
    "code": "resource_container_mismatch",
    "message": "Resource container_type and container_id do not match a valid catalog container.",
}
RESOURCE_SECRET_PAYLOAD_ERROR = {
    "code": "resource_secret_payload_forbidden",
    "message": "Resource metadata must stay descriptive and cannot store secret payloads.",
}
RESOURCE_NOT_FOUND_ERROR = {
    "code": "resource_not_found",
    "message": "Resource was not found.",
}
ALLOWED_SCOPE_TYPES = {DEFAULT_SCOPE_TYPE, "team"}
ALLOWED_RESOURCE_TYPES = {"database", "bucket", "queue", "service_account", "certificate", "secret_ref"}
ALLOWED_RESOURCE_CONTAINER_TYPES = {"app", "project", "environment"}
FORBIDDEN_RESOURCE_METADATA_KEYS = {
    "secret",
    "secret_value",
    "secret_payload",
    "private_key",
    "password",
    "token",
    "credential",
    "credentials",
    "value",
}


class OrganizationResponse(BaseModel):
    id: str
    slug: str
    display_name: str
    description: str | None
    created_at: str
    updated_at: str

    model_config = ConfigDict(from_attributes=True)


class OrganizationUpdateRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)


class CatalogUserResponse(BaseModel):
    id: str
    organization_id: str
    email: str
    full_name: str
    job_title: str | None
    is_active: bool
    created_at: str
    updated_at: str

    model_config = ConfigDict(from_attributes=True)


class CatalogUserCreateRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    full_name: str = Field(min_length=1, max_length=160)
    job_title: str | None = Field(default=None, max_length=160)
    is_active: bool = True


class CatalogUserUpdateRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=160)
    job_title: str | None = Field(default=None, max_length=160)
    is_active: bool


class CatalogUserListResponse(BaseModel):
    items: list[CatalogUserResponse]


class OrganizationUpdateResponse(BaseModel):
    organization: OrganizationResponse
    audit_event_id: int
    correlation_id: str


class CatalogUserMutationResponse(BaseModel):
    catalog_user: CatalogUserResponse


class TeamResponse(BaseModel):
    id: str
    organization_id: str
    name: str
    description: str | None
    created_at: str
    updated_at: str

    model_config = ConfigDict(from_attributes=True)


class TeamCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)


class TeamListResponse(BaseModel):
    items: list[TeamResponse]


class TeamMutationResponse(BaseModel):
    team: TeamResponse


class AuditedTeamMutationResponse(TeamMutationResponse):
    audit_event_id: int
    correlation_id: str


class ScopedRoleResponse(BaseModel):
    id: str
    organization_id: str
    name: str
    description: str | None
    scope_type: str
    scope_id: str
    created_at: str
    updated_at: str

    model_config = ConfigDict(from_attributes=True)


class ScopedRoleCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    scope_type: str = Field(min_length=1, max_length=32)
    scope_id: str = Field(min_length=1, max_length=64)


class ScopedRoleListResponse(BaseModel):
    items: list[ScopedRoleResponse]


class ScopedRoleMutationResponse(BaseModel):
    scoped_role: ScopedRoleResponse


class TeamMembershipResponse(BaseModel):
    id: str
    team_id: str
    catalog_user_id: str
    created_at: str

    model_config = ConfigDict(from_attributes=True)


class TeamMembershipCreateRequest(BaseModel):
    team_id: str = Field(min_length=1, max_length=64)
    catalog_user_id: str = Field(min_length=1, max_length=64)


class TeamMembershipListResponse(BaseModel):
    items: list[TeamMembershipResponse]


class TeamMembershipMutationResponse(BaseModel):
    membership: TeamMembershipResponse


class AuditedTeamMembershipMutationResponse(TeamMembershipMutationResponse):
    audit_event_id: int
    correlation_id: str


class DirectRoleAssignmentResponse(BaseModel):
    id: str
    scoped_role_id: str
    catalog_user_id: str
    created_at: str

    model_config = ConfigDict(from_attributes=True)


class DirectRoleAssignmentCreateRequest(BaseModel):
    scoped_role_id: str = Field(min_length=1, max_length=64)
    catalog_user_id: str = Field(min_length=1, max_length=64)


class DirectRoleAssignmentListResponse(BaseModel):
    items: list[DirectRoleAssignmentResponse]


class DirectRoleAssignmentMutationResponse(BaseModel):
    assignment: DirectRoleAssignmentResponse


class AppResponse(BaseModel):
    id: str
    organization_id: str
    name: str
    description: str | None
    created_at: str
    updated_at: str

    model_config = ConfigDict(from_attributes=True)


class AppCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)


class AppListResponse(BaseModel):
    items: list[AppResponse]


class AppMutationResponse(BaseModel):
    app: AppResponse


class ProjectResponse(BaseModel):
    id: str
    organization_id: str
    app_id: str
    name: str
    description: str | None
    created_at: str
    updated_at: str

    model_config = ConfigDict(from_attributes=True)


class ProjectCreateRequest(BaseModel):
    app_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)


class ProjectListResponse(BaseModel):
    items: list[ProjectResponse]


class ProjectMutationResponse(BaseModel):
    project: ProjectResponse


class EnvironmentResponse(BaseModel):
    id: str
    organization_id: str
    project_id: str
    name: str
    description: str | None
    created_at: str
    updated_at: str

    model_config = ConfigDict(from_attributes=True)


class EnvironmentCreateRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)


class EnvironmentListResponse(BaseModel):
    items: list[EnvironmentResponse]


class EnvironmentMutationResponse(BaseModel):
    environment: EnvironmentResponse


class ResourceResponse(BaseModel):
    id: str
    organization_id: str
    app_id: str | None
    project_id: str | None
    environment_id: str | None
    name: str
    resource_type: str
    container_type: str
    container_id: str
    scope_type: str
    scope_id: str
    description: str | None
    metadata: dict[str, str]
    created_at: str
    updated_at: str

    model_config = ConfigDict(from_attributes=True)


class ResourceCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    resource_type: str = Field(min_length=1, max_length=32)
    container_type: str = Field(min_length=1, max_length=32)
    container_id: str = Field(min_length=1, max_length=64)
    scope_type: str = Field(min_length=1, max_length=32)
    scope_id: str = Field(min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=2000)
    metadata: dict[str, str] = Field(default_factory=dict)


class ResourceListResponse(BaseModel):
    items: list[ResourceResponse]


class ResourceMutationResponse(BaseModel):
    resource: ResourceResponse


class AuditedResourceMutationResponse(ResourceMutationResponse):
    audit_event_id: int
    correlation_id: str


class CatalogUserRelationshipTeamMembershipResponse(BaseModel):
    membership: TeamMembershipResponse
    team: TeamResponse


class CatalogUserRelationshipAssignmentResponse(BaseModel):
    assignment: DirectRoleAssignmentResponse
    scoped_role: ScopedRoleResponse


class CatalogUserRelationshipResourceResponse(BaseModel):
    resource: ResourceResponse
    app: AppResponse | None = None
    project: ProjectResponse | None = None
    environment: EnvironmentResponse | None = None


class CatalogUserRelationshipResponse(BaseModel):
    catalog_user: CatalogUserResponse
    memberships: list[CatalogUserRelationshipTeamMembershipResponse]
    assignments: list[CatalogUserRelationshipAssignmentResponse]
    resources: list[CatalogUserRelationshipResourceResponse]


class CatalogUserRelationshipEnvelopeResponse(BaseModel):
    item: CatalogUserRelationshipResponse


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _normalize_required_text(value: str) -> str:
    return value.strip()


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_metadata(metadata: dict[str, str]) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for key, value in metadata.items():
        normalized_key = key.strip().lower().replace("-", "_")
        normalized_value = value.strip()
        if normalized_key in FORBIDDEN_RESOURCE_METADATA_KEYS:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=RESOURCE_SECRET_PAYLOAD_ERROR)
        normalized[normalized_key] = normalized_value
    return normalized


def _serialize_organization(organization: Organization) -> OrganizationResponse:
    return OrganizationResponse.model_validate(
        {
            "id": organization.id,
            "slug": organization.slug,
            "display_name": organization.display_name,
            "description": organization.description,
            "created_at": organization.created_at.isoformat(),
            "updated_at": organization.updated_at.isoformat(),
        }
    )


def _serialize_catalog_user(catalog_user: CatalogUser) -> CatalogUserResponse:
    return CatalogUserResponse.model_validate(
        {
            "id": catalog_user.id,
            "organization_id": catalog_user.organization_id,
            "email": catalog_user.email,
            "full_name": catalog_user.full_name,
            "job_title": catalog_user.job_title,
            "is_active": catalog_user.is_active,
            "created_at": catalog_user.created_at.isoformat(),
            "updated_at": catalog_user.updated_at.isoformat(),
        }
    )


def _serialize_team(team: Team) -> TeamResponse:
    return TeamResponse.model_validate(
        {
            "id": team.id,
            "organization_id": team.organization_id,
            "name": team.name,
            "description": team.description,
            "created_at": team.created_at.isoformat(),
            "updated_at": team.updated_at.isoformat(),
        }
    )


def _serialize_scoped_role(scoped_role: ScopedRole) -> ScopedRoleResponse:
    return ScopedRoleResponse.model_validate(
        {
            "id": scoped_role.id,
            "organization_id": scoped_role.organization_id,
            "name": scoped_role.name,
            "description": scoped_role.description,
            "scope_type": scoped_role.scope_type,
            "scope_id": scoped_role.scope_id,
            "created_at": scoped_role.created_at.isoformat(),
            "updated_at": scoped_role.updated_at.isoformat(),
        }
    )


def _serialize_team_membership(membership: TeamMembership) -> TeamMembershipResponse:
    return TeamMembershipResponse.model_validate(
        {
            "id": membership.id,
            "team_id": membership.team_id,
            "catalog_user_id": membership.catalog_user_id,
            "created_at": membership.created_at.isoformat(),
        }
    )


def _serialize_direct_role_assignment(assignment: DirectRoleAssignment) -> DirectRoleAssignmentResponse:
    return DirectRoleAssignmentResponse.model_validate(
        {
            "id": assignment.id,
            "scoped_role_id": assignment.scoped_role_id,
            "catalog_user_id": assignment.catalog_user_id,
            "created_at": assignment.created_at.isoformat(),
        }
    )


def _serialize_app(app: App) -> AppResponse:
    return AppResponse.model_validate(
        {
            "id": app.id,
            "organization_id": app.organization_id,
            "name": app.name,
            "description": app.description,
            "created_at": app.created_at.isoformat(),
            "updated_at": app.updated_at.isoformat(),
        }
    )


def _serialize_project(project: Project) -> ProjectResponse:
    return ProjectResponse.model_validate(
        {
            "id": project.id,
            "organization_id": project.organization_id,
            "app_id": project.app_id,
            "name": project.name,
            "description": project.description,
            "created_at": project.created_at.isoformat(),
            "updated_at": project.updated_at.isoformat(),
        }
    )


def _serialize_environment(environment: Environment) -> EnvironmentResponse:
    return EnvironmentResponse.model_validate(
        {
            "id": environment.id,
            "organization_id": environment.organization_id,
            "project_id": environment.project_id,
            "name": environment.name,
            "description": environment.description,
            "created_at": environment.created_at.isoformat(),
            "updated_at": environment.updated_at.isoformat(),
        }
    )


def _serialize_resource(resource: Resource) -> ResourceResponse:
    return ResourceResponse.model_validate(
        {
            "id": resource.id,
            "organization_id": resource.organization_id,
            "app_id": resource.app_id,
            "project_id": resource.project_id,
            "environment_id": resource.environment_id,
            "name": resource.name,
            "resource_type": resource.resource_type,
            "container_type": resource.container_type,
            "container_id": resource.container_id,
            "scope_type": resource.scope_type,
            "scope_id": resource.scope_id,
            "description": resource.description,
            "metadata": resource.metadata_json,
            "created_at": resource.created_at.isoformat(),
            "updated_at": resource.updated_at.isoformat(),
        }
    )


def _audited_response_kwargs(context: SensitiveOperationContext) -> dict[str, int | str]:
    return {
        "audit_event_id": context.audit_event.id,
        "correlation_id": context.audit_event.correlation_id or "",
    }


def _serialize_catalog_user_relationship_membership(
    membership: TeamMembership,
    team: Team,
) -> CatalogUserRelationshipTeamMembershipResponse:
    return CatalogUserRelationshipTeamMembershipResponse(
        membership=_serialize_team_membership(membership),
        team=_serialize_team(team),
    )


def _serialize_catalog_user_relationship_assignment(
    assignment: DirectRoleAssignment,
    scoped_role: ScopedRole,
) -> CatalogUserRelationshipAssignmentResponse:
    return CatalogUserRelationshipAssignmentResponse(
        assignment=_serialize_direct_role_assignment(assignment),
        scoped_role=_serialize_scoped_role(scoped_role),
    )


def _serialize_catalog_user_relationship_resource(
    resource: Resource,
    *,
    app: App | None,
    project: Project | None,
    environment: Environment | None,
) -> CatalogUserRelationshipResourceResponse:
    return CatalogUserRelationshipResourceResponse(
        resource=_serialize_resource(resource),
        app=_serialize_app(app) if app is not None else None,
        project=_serialize_project(project) if project is not None else None,
        environment=_serialize_environment(environment) if environment is not None else None,
    )


def _get_or_create_organization_root(db: OrmSession) -> Organization:
    organization = db.scalar(select(Organization).where(Organization.singleton_key == ORGANIZATION_CODE))
    if organization is not None:
        return organization

    organization = Organization(
        id=f"org_{uuid4().hex}",
        singleton_key=ORGANIZATION_CODE,
        slug="passark",
        display_name=ORGANIZATION_BOOTSTRAP_NAME,
        description="Primary organization for this PassArk deployment.",
    )
    db.add(organization)
    db.commit()
    db.refresh(organization)
    return organization


def _raise_duplicate_catalog_user() -> None:
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=CATALOG_DUPLICATE_ERROR)


def _raise_duplicate_team() -> None:
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=TEAM_DUPLICATE_ERROR)


def _raise_duplicate_scoped_role() -> None:
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=SCOPED_ROLE_DUPLICATE_ERROR)


def _raise_duplicate_team_membership() -> None:
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=TEAM_MEMBERSHIP_DUPLICATE_ERROR)


def _raise_duplicate_direct_role_assignment() -> None:
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=DIRECT_ROLE_ASSIGNMENT_DUPLICATE_ERROR)


def _raise_duplicate_app() -> None:
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=APP_DUPLICATE_ERROR)


def _raise_duplicate_project() -> None:
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=PROJECT_DUPLICATE_ERROR)


def _raise_duplicate_environment() -> None:
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=ENVIRONMENT_DUPLICATE_ERROR)


def _raise_duplicate_resource() -> None:
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=RESOURCE_DUPLICATE_ERROR)


def _validate_scope(organization: Organization, scope_type: str, scope_id: str, db: OrmSession) -> tuple[str, str]:
    normalized_scope_type = scope_type.strip().lower()
    normalized_scope_id = scope_id.strip()

    if normalized_scope_type not in ALLOWED_SCOPE_TYPES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=SCOPE_MISMATCH_ERROR)

    if normalized_scope_type == DEFAULT_SCOPE_TYPE:
        if normalized_scope_id != organization.id:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=SCOPE_MISMATCH_ERROR)
        return normalized_scope_type, normalized_scope_id

    team = db.scalar(select(Team).where(Team.id == normalized_scope_id))
    if team is None or team.organization_id != organization.id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=SCOPE_MISMATCH_ERROR)
    return normalized_scope_type, normalized_scope_id


def _get_catalog_user_or_404(catalog_user_id: str, organization_id: str, db: OrmSession) -> CatalogUser:
    catalog_user = db.scalar(select(CatalogUser).where(CatalogUser.id == catalog_user_id))
    if catalog_user is None or catalog_user.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=CATALOG_NOT_FOUND_ERROR)
    return catalog_user


def _get_team_or_404(team_id: str, organization_id: str, db: OrmSession) -> Team:
    team = db.scalar(select(Team).where(Team.id == team_id))
    if team is None or team.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=TEAM_NOT_FOUND_ERROR)
    return team


def _get_scoped_role_or_404(scoped_role_id: str, organization_id: str, db: OrmSession) -> ScopedRole:
    scoped_role = db.scalar(select(ScopedRole).where(ScopedRole.id == scoped_role_id))
    if scoped_role is None or scoped_role.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=SCOPED_ROLE_NOT_FOUND_ERROR)
    return scoped_role


def _get_app_or_404(app_id: str, organization_id: str, db: OrmSession) -> App:
    app = db.scalar(select(App).where(App.id == app_id))
    if app is None or app.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=APP_NOT_FOUND_ERROR)
    return app


def _get_project_or_404(project_id: str, organization_id: str, db: OrmSession) -> Project:
    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None or project.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=PROJECT_NOT_FOUND_ERROR)
    return project


def _get_environment_or_404(environment_id: str, organization_id: str, db: OrmSession) -> Environment:
    environment = db.scalar(select(Environment).where(Environment.id == environment_id))
    if environment is None or environment.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ENVIRONMENT_NOT_FOUND_ERROR)
    return environment


def _resolve_resource_container(
    *,
    organization_id: str,
    container_type: str,
    container_id: str,
    db: OrmSession,
) -> tuple[str, str, App | None, Project | None, Environment | None]:
    normalized_container_type = container_type.strip().lower()
    normalized_container_id = container_id.strip()

    if normalized_container_type not in ALLOWED_RESOURCE_CONTAINER_TYPES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=RESOURCE_CONTAINER_MISMATCH_ERROR)

    if normalized_container_type == "app":
        app = _get_app_or_404(normalized_container_id, organization_id, db)
        return normalized_container_type, app.id, app, None, None

    if normalized_container_type == "project":
        project = _get_project_or_404(normalized_container_id, organization_id, db)
        app = _get_app_or_404(project.app_id, organization_id, db)
        return normalized_container_type, project.id, app, project, None

    environment = _get_environment_or_404(normalized_container_id, organization_id, db)
    project = _get_project_or_404(environment.project_id, organization_id, db)
    app = _get_app_or_404(project.app_id, organization_id, db)
    return normalized_container_type, environment.id, app, project, environment


def _validate_resource_scope(
    *,
    organization: Organization,
    scope_type: str,
    scope_id: str,
    app: App | None,
    project: Project | None,
    environment: Environment | None,
    db: OrmSession,
) -> tuple[str, str]:
    normalized_scope_type, normalized_scope_id = _validate_scope(organization, scope_type, scope_id, db)

    if normalized_scope_type == "team":
        return normalized_scope_type, normalized_scope_id

    if environment is not None:
        return normalized_scope_type, normalized_scope_id

    if project is not None:
        return normalized_scope_type, normalized_scope_id

    if app is not None:
        return normalized_scope_type, normalized_scope_id

    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=RESOURCE_SCOPE_MISMATCH_ERROR)


def _resolve_catalog_user_relationship_resources(
    *,
    organization_id: str,
    team_ids: set[str],
    db: OrmSession,
) -> list[CatalogUserRelationshipResourceResponse]:
    visible_scope_ids = {organization_id, *team_ids}
    resources = db.scalars(
        select(Resource)
        .where(Resource.organization_id == organization_id)
        .where(
            ((Resource.scope_type == DEFAULT_SCOPE_TYPE) & (Resource.scope_id == organization_id))
            | ((Resource.scope_type == "team") & (Resource.scope_id.in_(visible_scope_ids)))
        )
        .order_by(
            Resource.resource_type.asc(),
            Resource.name.asc(),
            Resource.id.asc(),
        )
    ).all()

    app_ids = {resource.app_id for resource in resources if resource.app_id is not None}
    project_ids = {resource.project_id for resource in resources if resource.project_id is not None}
    environment_ids = {resource.environment_id for resource in resources if resource.environment_id is not None}

    apps_by_id = {
        app.id: app
        for app in db.scalars(select(App).where(App.id.in_(app_ids))).all()
    } if app_ids else {}
    projects_by_id = {
        project.id: project
        for project in db.scalars(select(Project).where(Project.id.in_(project_ids))).all()
    } if project_ids else {}
    environments_by_id = {
        environment.id: environment
        for environment in db.scalars(select(Environment).where(Environment.id.in_(environment_ids))).all()
    } if environment_ids else {}

    items: list[CatalogUserRelationshipResourceResponse] = []
    for resource in resources:
        app = apps_by_id.get(resource.app_id) if resource.app_id is not None else None
        project = projects_by_id.get(resource.project_id) if resource.project_id is not None else None
        environment = environments_by_id.get(resource.environment_id) if resource.environment_id is not None else None
        items.append(
            _serialize_catalog_user_relationship_resource(
                resource,
                app=app,
                project=project,
                environment=environment,
            )
        )
    return items


sensitive_team_mutation_guard = get_sensitive_operation_guard("catalog_team_mutation")
sensitive_membership_mutation_guard = get_sensitive_operation_guard("catalog_membership_mutation")
sensitive_resource_mutation_guard = get_sensitive_operation_guard("catalog_resource_mutation")


@router.get("/organization", response_model=OrganizationResponse)
def read_organization(
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> OrganizationResponse:
    del current_user
    organization = _get_or_create_organization_root(db)
    return _serialize_organization(organization)


@router.put("/organization", response_model=OrganizationUpdateResponse)
def update_organization(
    payload: OrganizationUpdateRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> OrganizationUpdateResponse:
    organization = _get_or_create_organization_root(db)
    organization.display_name = payload.display_name.strip()
    organization.description = _normalize_optional_text(payload.description)
    db.add(organization)
    db.commit()
    db.refresh(organization)

    writer = SensitiveOperationAuditWriter(db)
    try:
        audit_event = writer.record(
            operation="organization_update",
            outcome="organization_updated",
            reason_code="organization_updated",
            actor_user_id=current_user.id,
            session_id=None,
            request=request,
            metadata={
                "organization_id": organization.id,
                "organization_slug": organization.slug,
            },
        )
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=ORGANIZATION_UPDATE_AUDIT_ERROR,
        ) from exc

    return OrganizationUpdateResponse(
        organization=_serialize_organization(organization),
        audit_event_id=audit_event.id,
        correlation_id=audit_event.correlation_id or "",
    )


@router.get("/users", response_model=CatalogUserListResponse)
def list_catalog_users(
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> CatalogUserListResponse:
    del current_user
    organization = _get_or_create_organization_root(db)
    items = db.scalars(
        select(CatalogUser)
        .where(CatalogUser.organization_id == organization.id)
        .order_by(CatalogUser.full_name.asc(), CatalogUser.id.asc())
    ).all()
    return CatalogUserListResponse(items=[_serialize_catalog_user(item) for item in items])


@router.post("/users", response_model=CatalogUserMutationResponse, status_code=status.HTTP_201_CREATED)
def create_catalog_user(
    payload: CatalogUserCreateRequest,
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> CatalogUserMutationResponse:
    del current_user
    organization = _get_or_create_organization_root(db)
    catalog_user = CatalogUser(
        id=f"cu_{uuid4().hex}",
        organization_id=organization.id,
        email=_normalize_email(payload.email),
        full_name=payload.full_name.strip(),
        job_title=_normalize_optional_text(payload.job_title),
        is_active=payload.is_active,
    )
    db.add(catalog_user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        _raise_duplicate_catalog_user()
    db.refresh(catalog_user)
    return CatalogUserMutationResponse(catalog_user=_serialize_catalog_user(catalog_user))


@router.put("/users/{catalog_user_id}", response_model=CatalogUserMutationResponse)
def update_catalog_user(
    catalog_user_id: str,
    payload: CatalogUserUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> CatalogUserMutationResponse:
    del current_user
    catalog_user = db.scalar(select(CatalogUser).where(CatalogUser.id == catalog_user_id))
    if catalog_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=CATALOG_NOT_FOUND_ERROR)

    catalog_user.full_name = payload.full_name.strip()
    catalog_user.job_title = _normalize_optional_text(payload.job_title)
    catalog_user.is_active = payload.is_active
    db.add(catalog_user)
    db.commit()
    db.refresh(catalog_user)
    return CatalogUserMutationResponse(catalog_user=_serialize_catalog_user(catalog_user))


@router.get("/users/{catalog_user_id}/relationship", response_model=CatalogUserRelationshipEnvelopeResponse)
def read_catalog_user_relationship(
    catalog_user_id: str,
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> CatalogUserRelationshipEnvelopeResponse:
    del current_user
    organization = _get_or_create_organization_root(db)
    catalog_user = _get_catalog_user_or_404(catalog_user_id, organization.id, db)

    membership_rows = db.execute(
        select(TeamMembership, Team)
        .join(Team, Team.id == TeamMembership.team_id)
        .where(TeamMembership.catalog_user_id == catalog_user.id)
        .where(Team.organization_id == organization.id)
        .order_by(Team.name.asc(), TeamMembership.id.asc())
    ).all()
    memberships = [
        _serialize_catalog_user_relationship_membership(membership, team)
        for membership, team in membership_rows
    ]
    team_ids = {team.id for _, team in membership_rows}

    assignment_rows = db.execute(
        select(DirectRoleAssignment, ScopedRole)
        .join(ScopedRole, ScopedRole.id == DirectRoleAssignment.scoped_role_id)
        .where(DirectRoleAssignment.catalog_user_id == catalog_user.id)
        .where(ScopedRole.organization_id == organization.id)
        .order_by(
            ScopedRole.scope_type.asc(),
            ScopedRole.name.asc(),
            DirectRoleAssignment.id.asc(),
        )
    ).all()
    assignments = [
        _serialize_catalog_user_relationship_assignment(assignment, scoped_role)
        for assignment, scoped_role in assignment_rows
    ]

    resources = _resolve_catalog_user_relationship_resources(
        organization_id=organization.id,
        team_ids=team_ids,
        db=db,
    )

    return CatalogUserRelationshipEnvelopeResponse(
        item=CatalogUserRelationshipResponse(
            catalog_user=_serialize_catalog_user(catalog_user),
            memberships=memberships,
            assignments=assignments,
            resources=resources,
        )
    )


@router.get("/teams", response_model=TeamListResponse)
def list_teams(
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> TeamListResponse:
    del current_user
    organization = _get_or_create_organization_root(db)
    items = db.scalars(
        select(Team)
        .where(Team.organization_id == organization.id)
        .order_by(Team.name.asc(), Team.id.asc())
    ).all()
    return TeamListResponse(items=[_serialize_team(item) for item in items])


@router.post("/teams", response_model=AuditedTeamMutationResponse, status_code=status.HTTP_201_CREATED)
def create_team(
    payload: TeamCreateRequest,
    context: SensitiveOperationContext = Depends(sensitive_team_mutation_guard),
    db: OrmSession = Depends(get_db),
) -> AuditedTeamMutationResponse:
    del context.user
    organization = _get_or_create_organization_root(db)
    team = Team(
        id=f"team_{uuid4().hex}",
        organization_id=organization.id,
        name=_normalize_required_text(payload.name),
        description=_normalize_optional_text(payload.description),
    )
    db.add(team)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        _raise_duplicate_team()
    db.refresh(team)
    return AuditedTeamMutationResponse(team=_serialize_team(team), **_audited_response_kwargs(context))


@router.get("/roles", response_model=ScopedRoleListResponse)
def list_scoped_roles(
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> ScopedRoleListResponse:
    del current_user
    organization = _get_or_create_organization_root(db)
    items = db.scalars(
        select(ScopedRole)
        .where(ScopedRole.organization_id == organization.id)
        .order_by(ScopedRole.scope_type.asc(), ScopedRole.name.asc(), ScopedRole.id.asc())
    ).all()
    return ScopedRoleListResponse(items=[_serialize_scoped_role(item) for item in items])


@router.post("/roles", response_model=ScopedRoleMutationResponse, status_code=status.HTTP_201_CREATED)
def create_scoped_role(
    payload: ScopedRoleCreateRequest,
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> ScopedRoleMutationResponse:
    del current_user
    organization = _get_or_create_organization_root(db)
    normalized_scope_type, normalized_scope_id = _validate_scope(
        organization,
        payload.scope_type,
        payload.scope_id,
        db,
    )
    scoped_role = ScopedRole(
        id=f"role_{uuid4().hex}",
        organization_id=organization.id,
        name=_normalize_required_text(payload.name),
        description=_normalize_optional_text(payload.description),
        scope_type=normalized_scope_type,
        scope_id=normalized_scope_id,
    )
    db.add(scoped_role)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        _raise_duplicate_scoped_role()
    db.refresh(scoped_role)
    return ScopedRoleMutationResponse(scoped_role=_serialize_scoped_role(scoped_role))


@router.get("/memberships", response_model=TeamMembershipListResponse)
def list_team_memberships(
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> TeamMembershipListResponse:
    del current_user
    organization = _get_or_create_organization_root(db)
    items = db.scalars(
        select(TeamMembership)
        .join(Team, Team.id == TeamMembership.team_id)
        .where(Team.organization_id == organization.id)
        .order_by(TeamMembership.created_at.asc(), TeamMembership.id.asc())
    ).all()
    return TeamMembershipListResponse(items=[_serialize_team_membership(item) for item in items])


@router.post("/memberships", response_model=AuditedTeamMembershipMutationResponse, status_code=status.HTTP_201_CREATED)
def create_team_membership(
    payload: TeamMembershipCreateRequest,
    context: SensitiveOperationContext = Depends(sensitive_membership_mutation_guard),
    db: OrmSession = Depends(get_db),
) -> AuditedTeamMembershipMutationResponse:
    del context.user
    organization = _get_or_create_organization_root(db)
    team = _get_team_or_404(payload.team_id.strip(), organization.id, db)
    catalog_user = _get_catalog_user_or_404(payload.catalog_user_id.strip(), organization.id, db)

    membership = TeamMembership(
        id=f"tm_{uuid4().hex}",
        team_id=team.id,
        catalog_user_id=catalog_user.id,
    )
    db.add(membership)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        _raise_duplicate_team_membership()
    db.refresh(membership)
    return AuditedTeamMembershipMutationResponse(
        membership=_serialize_team_membership(membership),
        **_audited_response_kwargs(context),
    )


@router.get("/assignments", response_model=DirectRoleAssignmentListResponse)
def list_direct_role_assignments(
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> DirectRoleAssignmentListResponse:
    del current_user
    organization = _get_or_create_organization_root(db)
    items = db.scalars(
        select(DirectRoleAssignment)
        .join(ScopedRole, ScopedRole.id == DirectRoleAssignment.scoped_role_id)
        .where(ScopedRole.organization_id == organization.id)
        .order_by(DirectRoleAssignment.created_at.asc(), DirectRoleAssignment.id.asc())
    ).all()
    return DirectRoleAssignmentListResponse(items=[_serialize_direct_role_assignment(item) for item in items])


@router.post("/assignments", response_model=DirectRoleAssignmentMutationResponse, status_code=status.HTTP_201_CREATED)
def create_direct_role_assignment(
    payload: DirectRoleAssignmentCreateRequest,
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> DirectRoleAssignmentMutationResponse:
    del current_user
    organization = _get_or_create_organization_root(db)
    scoped_role = _get_scoped_role_or_404(payload.scoped_role_id.strip(), organization.id, db)
    catalog_user = _get_catalog_user_or_404(payload.catalog_user_id.strip(), organization.id, db)

    assignment = DirectRoleAssignment(
        id=f"dra_{uuid4().hex}",
        scoped_role_id=scoped_role.id,
        catalog_user_id=catalog_user.id,
    )
    db.add(assignment)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        _raise_duplicate_direct_role_assignment()
    db.refresh(assignment)
    return DirectRoleAssignmentMutationResponse(assignment=_serialize_direct_role_assignment(assignment))


@router.get("/apps", response_model=AppListResponse)
def list_apps(
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> AppListResponse:
    del current_user
    organization = _get_or_create_organization_root(db)
    items = db.scalars(
        select(App)
        .where(App.organization_id == organization.id)
        .order_by(App.name.asc(), App.id.asc())
    ).all()
    return AppListResponse(items=[_serialize_app(item) for item in items])


@router.post("/apps", response_model=AppMutationResponse, status_code=status.HTTP_201_CREATED)
def create_app(
    payload: AppCreateRequest,
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> AppMutationResponse:
    del current_user
    organization = _get_or_create_organization_root(db)
    app = App(
        id=f"app_{uuid4().hex}",
        organization_id=organization.id,
        name=_normalize_required_text(payload.name),
        description=_normalize_optional_text(payload.description),
    )
    db.add(app)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        _raise_duplicate_app()
    db.refresh(app)
    return AppMutationResponse(app=_serialize_app(app))


@router.get("/projects", response_model=ProjectListResponse)
def list_projects(
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> ProjectListResponse:
    del current_user
    organization = _get_or_create_organization_root(db)
    items = db.scalars(
        select(Project)
        .where(Project.organization_id == organization.id)
        .order_by(Project.name.asc(), Project.id.asc())
    ).all()
    return ProjectListResponse(items=[_serialize_project(item) for item in items])


@router.post("/projects", response_model=ProjectMutationResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreateRequest,
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> ProjectMutationResponse:
    del current_user
    organization = _get_or_create_organization_root(db)
    app = _get_app_or_404(payload.app_id.strip(), organization.id, db)
    project = Project(
        id=f"proj_{uuid4().hex}",
        organization_id=organization.id,
        app_id=app.id,
        name=_normalize_required_text(payload.name),
        description=_normalize_optional_text(payload.description),
    )
    db.add(project)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        _raise_duplicate_project()
    db.refresh(project)
    return ProjectMutationResponse(project=_serialize_project(project))


@router.get("/environments", response_model=EnvironmentListResponse)
def list_environments(
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> EnvironmentListResponse:
    del current_user
    organization = _get_or_create_organization_root(db)
    items = db.scalars(
        select(Environment)
        .where(Environment.organization_id == organization.id)
        .order_by(Environment.name.asc(), Environment.id.asc())
    ).all()
    return EnvironmentListResponse(items=[_serialize_environment(item) for item in items])


@router.post("/environments", response_model=EnvironmentMutationResponse, status_code=status.HTTP_201_CREATED)
def create_environment(
    payload: EnvironmentCreateRequest,
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> EnvironmentMutationResponse:
    del current_user
    organization = _get_or_create_organization_root(db)
    project = _get_project_or_404(payload.project_id.strip(), organization.id, db)
    environment = Environment(
        id=f"env_{uuid4().hex}",
        organization_id=organization.id,
        project_id=project.id,
        name=_normalize_required_text(payload.name),
        description=_normalize_optional_text(payload.description),
    )
    db.add(environment)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        _raise_duplicate_environment()
    db.refresh(environment)
    return EnvironmentMutationResponse(environment=_serialize_environment(environment))


@router.get("/resources", response_model=ResourceListResponse)
def list_resources(
    current_user: User = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
) -> ResourceListResponse:
    del current_user
    organization = _get_or_create_organization_root(db)
    items = db.scalars(
        select(Resource)
        .where(Resource.organization_id == organization.id)
        .order_by(Resource.resource_type.asc(), Resource.name.asc(), Resource.id.asc())
    ).all()
    return ResourceListResponse(items=[_serialize_resource(item) for item in items])


@router.post("/resources", response_model=AuditedResourceMutationResponse, status_code=status.HTTP_201_CREATED)
def create_resource(
    payload: ResourceCreateRequest,
    context: SensitiveOperationContext = Depends(sensitive_resource_mutation_guard),
    db: OrmSession = Depends(get_db),
) -> AuditedResourceMutationResponse:
    del context.user
    organization = _get_or_create_organization_root(db)
    resource_type = payload.resource_type.strip().lower()
    if resource_type not in ALLOWED_RESOURCE_TYPES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=RESOURCE_CONTAINER_MISMATCH_ERROR)

    container_type, container_id, app, project, environment = _resolve_resource_container(
        organization_id=organization.id,
        container_type=payload.container_type,
        container_id=payload.container_id,
        db=db,
    )
    scope_type, scope_id = _validate_resource_scope(
        organization=organization,
        scope_type=payload.scope_type,
        scope_id=payload.scope_id,
        app=app,
        project=project,
        environment=environment,
        db=db,
    )
    metadata = _normalize_metadata(payload.metadata)

    resource = Resource(
        id=f"res_{uuid4().hex}",
        organization_id=organization.id,
        app_id=app.id if app is not None else None,
        project_id=project.id if project is not None else None,
        environment_id=environment.id if environment is not None else None,
        name=_normalize_required_text(payload.name),
        resource_type=resource_type,
        container_type=container_type,
        container_id=container_id,
        scope_type=scope_type,
        scope_id=scope_id,
        description=_normalize_optional_text(payload.description),
        metadata_json=metadata,
    )
    db.add(resource)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        _raise_duplicate_resource()
    db.refresh(resource)
    return AuditedResourceMutationResponse(resource=_serialize_resource(resource), **_audited_response_kwargs(context))
