from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session as OrmSession

from app.db.base import AuditEvent, CatalogUser, Organization, User
from app.db.session import (
    SensitiveOperationAuditWriter,
    get_auth_error,
    get_current_user,
    get_db,
)

router = APIRouter(prefix="/catalog", tags=["catalog"])

ORGANIZATION_BOOTSTRAP_NAME = "PassArk"
ORGANIZATION_CODE = "organization_singleton"
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


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


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
    except IntegrityError as exc:
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
