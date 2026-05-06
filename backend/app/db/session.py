from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from hashlib import pbkdf2_hmac
from hmac import compare_digest
from secrets import token_urlsafe

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session as OrmSession
from sqlalchemy.orm import joinedload, sessionmaker

from app.core.config import Settings, get_settings
from app.db.base import Session, User

settings = get_settings()

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

AUTH_ERROR = {
    "code": "auth_unauthenticated",
    "message": "Authentication required.",
}


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
        scheme, iterations, salt, expected = encoded.split("$", 3)
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


def get_auth_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=AUTH_ERROR)


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
    if not password_hasher.verify_password(password, bootstrap_user.password_hash):
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
        raise get_auth_error()
    return current_session.user
