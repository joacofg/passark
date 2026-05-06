from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from hashlib import pbkdf2_hmac
from hmac import compare_digest
from secrets import token_urlsafe
from typing import Any

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import create_engine, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session as OrmSession
from sqlalchemy.orm import joinedload, sessionmaker

from app.core.config import Settings, get_settings
from app.db.base import AuditEvent, Session, User

settings = get_settings()

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

AUTH_ERROR = {
    "code": "auth_unauthenticated",
    "message": "Authentication required.",
}

INACTIVE_USER_ERROR = {
    "code": "auth_inactive_user",
    "message": "Active account required.",
}

MALFORMED_AUTH_STATE_ERROR = {
    "code": "auth_malformed_state",
    "message": "Stored authentication state is invalid.",
}

AUDIT_UNAVAILABLE_ERROR = {
    "code": "audit_unavailable",
    "message": "Audit logging is required for this operation.",
}

SENSITIVE_OPERATION_SUCCESS = "sensitive_operation_allowed"
SENSITIVE_OPERATION_DENIED = "sensitive_operation_denied"


class PasswordHasher:
    iterations = 600_000
    algorithm = "sha256"
    salt_size = 16

    @classmethod
    def hash_password(cls, password: str) -> str:
        salt = token_urlsafe(cls.salt_size)
        digest = pbkdf2_hmac(
            cls.algorithm,
            password.encode("utf-8"),
            salt.encode("utf-8"),
            cls.iterations,
        ).hex()
        return f"pbkdf2_{cls.algorithm}${cls.iterations}${salt}${digest}"

    @classmethod
    def verify_password(cls, password: str, encoded: str) -> bool:
        try:
            scheme, iterations, salt, expected = encoded.split("$", 3)
        except ValueError as exc:
            raise ValueError("password hash must contain scheme, iterations, salt, and digest") from exc

        if not scheme.startswith("pbkdf2_"):
            raise ValueError("password hash scheme must use pbkdf2_")

        algorithm = scheme.removeprefix("pbkdf2_")
        derived = pbkdf2_hmac(
            algorithm,
            password.encode("utf-8"),
            salt.encode("utf-8"),
            int(iterations),
        ).hex()
        return compare_digest(derived, expected)


password_hasher = PasswordHasher()


def get_db() -> Generator[OrmSession, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class SensitiveOperationAuditWriter:
    """Persist structured audit events without storing credentials or session secrets."""

    def __init__(self, db: OrmSession):
        self._db = db

    def record(
        self,
        *,
        operation: str,
        outcome: str,
        reason_code: str,
        actor_user_id: int | None,
        session_id: int | None,
        request: Request,
        metadata: dict[str, Any] | None = None,
    ) -> AuditEvent:
        event = AuditEvent(
            operation=operation,
            outcome=outcome,
            reason_code=reason_code,
            actor_user_id=actor_user_id,
            session_id=session_id,
            request_id=_get_request_header(request, "x-request-id"),
            correlation_id=_get_request_header(request, "x-correlation-id"),
            ip_address=_get_client_ip(request),
            user_agent=request.headers.get("user-agent"),
            metadata_json=metadata or {},
        )
        self._db.add(event)
        self._db.commit()
        self._db.refresh(event)
        return event


class SensitiveOperationContext:
    def __init__(self, *, user: User, session: Session, audit_event: AuditEvent):
        self.user = user
        self.session = session
        self.audit_event = audit_event


class SensitiveOperationGuard:
    """Enforce auth + audit prerequisites for security-sensitive operations.

    Denied authentication/user-state paths attempt a best-effort audit row when enough
    context exists to persist one. Audit write failures always fail closed immediately so
    sensitive routes never proceed without durable observability.
    """

    def __init__(self, operation: str):
        self.operation = operation

    def __call__(
        self,
        request: Request,
        db: OrmSession = Depends(get_db),
        app_settings: Settings = Depends(get_settings),
    ) -> SensitiveOperationContext:
        writer = SensitiveOperationAuditWriter(db)
        token = request.cookies.get(app_settings.auth_session_cookie_name)
        if not token:
            raise get_auth_error()

        session = db.scalar(
            select(Session)
            .options(joinedload(Session.user))
            .where(Session.token == token)
        )
        now = datetime.now(UTC)
        expires_at = _normalize_timestamp(session.expires_at) if session is not None else None
        invalidated_at = (
            _normalize_timestamp(session.invalidated_at)
            if session is not None and session.invalidated_at is not None
            else None
        )

        if session is None:
            raise get_auth_error()

        if invalidated_at is not None:
            _record_or_fail_closed(
                writer,
                operation=self.operation,
                outcome=SENSITIVE_OPERATION_DENIED,
                reason_code=AUTH_ERROR["code"],
                actor_user_id=session.user_id,
                session_id=session.id,
                request=request,
                metadata={"cause": "session_invalidated"},
            )
            raise get_auth_error()

        if expires_at is None or expires_at <= now:
            _record_or_fail_closed(
                writer,
                operation=self.operation,
                outcome=SENSITIVE_OPERATION_DENIED,
                reason_code=AUTH_ERROR["code"],
                actor_user_id=session.user_id,
                session_id=session.id,
                request=request,
                metadata={"cause": "session_expired"},
            )
            raise get_auth_error()

        user = session.user
        if user is None or not user.is_active:
            _record_or_fail_closed(
                writer,
                operation=self.operation,
                outcome=SENSITIVE_OPERATION_DENIED,
                reason_code=INACTIVE_USER_ERROR["code"],
                actor_user_id=user.id if user is not None else session.user_id,
                session_id=session.id,
                request=request,
                metadata={"cause": "inactive_user"},
            )
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=INACTIVE_USER_ERROR)

        try:
            audit_event = writer.record(
                operation=self.operation,
                outcome=SENSITIVE_OPERATION_SUCCESS,
                reason_code=SENSITIVE_OPERATION_SUCCESS,
                actor_user_id=user.id,
                session_id=session.id,
                request=request,
                metadata={"user_email": user.email},
            )
        except SQLAlchemyError as exc:
            raise _audit_unavailable_error() from exc

        return SensitiveOperationContext(user=user, session=session, audit_event=audit_event)


def get_sensitive_operation_guard(operation: str) -> SensitiveOperationGuard:
    return SensitiveOperationGuard(operation)


def get_auth_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=AUTH_ERROR)


def _audit_unavailable_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=AUDIT_UNAVAILABLE_ERROR)


def get_or_create_bootstrap_admin(db: OrmSession, app_settings: Settings) -> User:
    email = app_settings.auth_bootstrap_admin_email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if user is not None:
        return user

    user = User(
        email=email,
        password_hash=password_hasher.hash_password(app_settings.auth_bootstrap_admin_password),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate_user(db: OrmSession, app_settings: Settings, email: str, password: str) -> User | None:
    bootstrap_user = get_or_create_bootstrap_admin(db, app_settings)
    normalized_email = email.strip().lower()
    if normalized_email != bootstrap_user.email:
        return None
    try:
        password_is_valid = password_hasher.verify_password(password, bootstrap_user.password_hash)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=MALFORMED_AUTH_STATE_ERROR) from exc
    if not password_is_valid:
        return None
    return bootstrap_user


def create_session(db: OrmSession, user: User, app_settings: Settings) -> Session:
    expires_at = datetime.now(UTC) + timedelta(hours=app_settings.auth_session_ttl_hours)
    session = Session(token=token_urlsafe(32), user_id=user.id, expires_at=expires_at)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def invalidate_session(db: OrmSession, session: Session) -> None:
    session.invalidated_at = datetime.now(UTC)
    db.add(session)
    db.commit()


def _normalize_timestamp(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _get_request_header(request: Request, header_name: str) -> str | None:
    value = request.headers.get(header_name)
    return value.strip() if value else None


def _get_client_ip(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip()
    if request.client is None:
        return None
    return request.client.host


def _record_or_fail_closed(
    writer: SensitiveOperationAuditWriter,
    *,
    operation: str,
    outcome: str,
    reason_code: str,
    actor_user_id: int | None,
    session_id: int | None,
    request: Request,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    try:
        return writer.record(
            operation=operation,
            outcome=outcome,
            reason_code=reason_code,
            actor_user_id=actor_user_id,
            session_id=session_id,
            request=request,
            metadata=metadata,
        )
    except SQLAlchemyError as exc:
        raise _audit_unavailable_error() from exc


def get_current_session(
    request: Request,
    db: OrmSession = Depends(get_db),
    app_settings: Settings = Depends(get_settings),
) -> Session:
    token = request.cookies.get(app_settings.auth_session_cookie_name)
    if not token:
        raise get_auth_error()

    session = db.scalar(
        select(Session)
        .options(joinedload(Session.user))
        .where(Session.token == token)
    )
    now = datetime.now(UTC)
    expires_at = _normalize_timestamp(session.expires_at) if session is not None else None
    invalidated_at = (
        _normalize_timestamp(session.invalidated_at)
        if session is not None and session.invalidated_at is not None
        else None
    )
    if session is None or invalidated_at is not None or expires_at <= now:
        raise get_auth_error()
    return session


def get_current_user(current_session: Session = Depends(get_current_session)) -> User:
    if not current_session.user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=INACTIVE_USER_ERROR)
    return current_session.user
