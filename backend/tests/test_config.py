from alembic.config import Config

from app.core.config import Settings, get_settings
from app.db.base import NAMING_CONVENTION


def test_settings_load_expected_runtime_contract(monkeypatch):
    monkeypatch.setenv("PASSARK_ENV", "test")
    monkeypatch.setenv("BACKEND_PORT", "8010")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://user:pass@db:5432/passark")
    monkeypatch.setenv("AUTH_BOOTSTRAP_ADMIN_EMAIL", "admin@example.com")
    monkeypatch.setenv("AUTH_BOOTSTRAP_ADMIN_PASSWORD", "super-secret")
    monkeypatch.setenv("AUTH_SESSION_COOKIE_NAME", "passark_session")
    monkeypatch.setenv("AUTH_SESSION_COOKIE_SECURE", "true")
    monkeypatch.setenv("AUTH_SESSION_COOKIE_SAMESITE", "none")
    monkeypatch.setenv("AUTH_SESSION_COOKIE_DOMAIN", "localhost")
    monkeypatch.setenv("AUTH_SESSION_TTL_HOURS", "72")
    get_settings.cache_clear()

    settings = Settings()

    assert settings.passark_env == "test"
    assert settings.backend_port == 8010
    assert settings.database_url.endswith("/passark")
    assert settings.api_v1_prefix == "/api/v1"
    assert settings.auth_bootstrap_admin_email == "admin@example.com"
    assert settings.auth_bootstrap_admin_password == "super-secret"
    assert settings.auth_session_cookie_name == "passark_session"
    assert settings.auth_session_cookie_secure is True
    assert settings.auth_session_cookie_samesite == "none"
    assert settings.auth_session_cookie_domain == "localhost"
    assert settings.auth_session_ttl_hours == 72


def test_alembic_targets_application_metadata(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://user:pass@db:5432/passark")
    get_settings.cache_clear()

    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", "postgresql+psycopg://user:pass@db:5432/passark")

    assert config.get_main_option("script_location") == "alembic"
    assert NAMING_CONVENTION["pk"] == "pk_%(table_name)s"
