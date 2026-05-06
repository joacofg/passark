import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("PASSARK_ENV", "test")
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("AUTH_BOOTSTRAP_ADMIN_EMAIL", "admin@passark.local")
os.environ.setdefault("AUTH_BOOTSTRAP_ADMIN_PASSWORD", "change-me-now")
os.environ.setdefault("AUTH_SESSION_COOKIE_NAME", "passark_session")
os.environ.setdefault("AUTH_SESSION_COOKIE_SECURE", "false")
os.environ.setdefault("AUTH_SESSION_COOKIE_SAMESITE", "lax")
os.environ.setdefault("AUTH_SESSION_TTL_HOURS", "24")
os.environ.setdefault("SECURITY_SENSITIVE_AUDIT_FAILURE_CODE", "audit_unavailable")
os.environ.setdefault("SECURITY_SENSITIVE_DENIED_CODE", "sensitive_operation_denied")
os.environ.setdefault("SECURITY_SENSITIVE_SUCCESS_CODE", "sensitive_operation_allowed")

from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app


@pytest.fixture(autouse=True)
def clear_settings_cache() -> Iterator[None]:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture()
def db_session() -> Iterator[Session]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        engine.dispose()


@pytest.fixture()
def client(db_session: Session) -> Iterator[TestClient]:
    def override_get_db() -> Iterator[Session]:
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
