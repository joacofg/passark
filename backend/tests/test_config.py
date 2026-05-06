from alembic.config import Config

from app.core.config import Settings, get_settings
from app.db.base import NAMING_CONVENTION


def test_settings_load_expected_runtime_contract(monkeypatch):
    monkeypatch.setenv("PASSARK_ENV", "test")
    monkeypatch.setenv("BACKEND_PORT", "8010")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://user:pass@db:5432/passark")
    get_settings.cache_clear()

    settings = Settings()

    assert settings.passark_env == "test"
    assert settings.backend_port == 8010
    assert settings.database_url.endswith("/passark")
    assert settings.api_v1_prefix == "/api/v1"


def test_alembic_targets_application_metadata(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://user:pass@db:5432/passark")
    get_settings.cache_clear()

    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", "postgresql+psycopg://user:pass@db:5432/passark")

    assert config.get_main_option("script_location") == "alembic"
    assert NAMING_CONVENTION["pk"] == "pk_%(table_name)s"
