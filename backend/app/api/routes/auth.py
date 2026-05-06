from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session as OrmSession

from app.core.config import Settings, get_settings
from app.db.base import Session, User
from app.db.session import (
    SensitiveOperationContext,
    authenticate_user,
    create_session,
    get_auth_error,
    get_current_session,
    get_current_user,
    get_db,
    get_sensitive_operation_guard,
    invalidate_session,
)

router = APIRouter(prefix="/auth", tags=["auth"])
protected_router = APIRouter(prefix="/protected", tags=["protected"])

SENSITIVE_OPERATION_REVEAL = "vault_access_probe"


class LoginRequest(BaseModel):
    email: str
    password: str


class SessionUserResponse(BaseModel):
    id: int
    email: str
    is_active: bool


class SessionResponse(BaseModel):
    user: SessionUserResponse


class ProtectedResponse(BaseModel):
    user: SessionUserResponse
    session_id: int


class SensitiveOperationResponse(BaseModel):
    operation: str
    status: str
    actor_id: int
    audit_event_id: int


sensitive_operation_guard = get_sensitive_operation_guard(SENSITIVE_OPERATION_REVEAL)


def _write_session_cookie(response: Response, session: Session, settings: Settings) -> None:
    response.set_cookie(
        key=settings.auth_session_cookie_name,
        value=session.token,
        httponly=True,
        secure=settings.auth_session_cookie_secure,
        samesite=settings.auth_session_cookie_samesite,
        domain=settings.auth_session_cookie_domain,
        max_age=settings.auth_session_ttl_hours * 3600,
        path="/",
    )


def _clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        key=settings.auth_session_cookie_name,
        domain=settings.auth_session_cookie_domain,
        path="/",
    )


def _serialize_user(user: User) -> SessionUserResponse:
    return SessionUserResponse(id=user.id, email=user.email, is_active=user.is_active)


@router.post("/login", response_model=SessionResponse)
def login(
    payload: LoginRequest,
    response: Response,
    db: OrmSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> SessionResponse:
    user = authenticate_user(db, settings, payload.email, payload.password)
    if user is None:
        raise get_auth_error()

    session = create_session(db, user, settings)
    _write_session_cookie(response, session, settings)
    return SessionResponse(user=_serialize_user(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    current_session: Session = Depends(get_current_session),
    db: OrmSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Response:
    invalidate_session(db, current_session)
    _clear_session_cookie(response, settings)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/session", response_model=SessionResponse)
def read_current_session(
    user: User = Depends(get_current_user),
) -> SessionResponse:
    return SessionResponse(user=_serialize_user(user))


@protected_router.get("/whoami", response_model=ProtectedResponse)
def whoami(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_current_session),
) -> ProtectedResponse:
    return ProtectedResponse(user=_serialize_user(user), session_id=session.id)


@protected_router.post("/vault-access-probe", response_model=SensitiveOperationResponse)
def vault_access_probe(
    context: SensitiveOperationContext = Depends(sensitive_operation_guard),
) -> SensitiveOperationResponse:
    return SensitiveOperationResponse(
        operation=SENSITIVE_OPERATION_REVEAL,
        status="allowed",
        actor_id=context.user.id,
        audit_event_id=context.audit_event.id,
    )
