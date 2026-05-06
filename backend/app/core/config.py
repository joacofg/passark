from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    app_name: str = "passark-backend"
    passark_env: str = Field(default="development", alias="PASSARK_ENV")
    backend_port: int = Field(default=8000, alias="BACKEND_PORT")
    database_url: str = Field(..., alias="DATABASE_URL")
    api_v1_prefix: str = "/api/v1"

    auth_bootstrap_admin_email: str = Field(
        default="admin@passark.local",
        alias="AUTH_BOOTSTRAP_ADMIN_EMAIL",
    )
    auth_bootstrap_admin_password: str = Field(
        default="change-me-now",
        alias="AUTH_BOOTSTRAP_ADMIN_PASSWORD",
    )
    auth_session_cookie_name: str = Field(
        default="passark_session",
        alias="AUTH_SESSION_COOKIE_NAME",
    )
    auth_session_cookie_secure: bool = Field(
        default=False,
        alias="AUTH_SESSION_COOKIE_SECURE",
    )
    auth_session_cookie_samesite: str = Field(
        default="lax",
        alias="AUTH_SESSION_COOKIE_SAMESITE",
    )
    auth_session_cookie_domain: str | None = Field(
        default=None,
        alias="AUTH_SESSION_COOKIE_DOMAIN",
    )
    auth_session_ttl_hours: int = Field(
        default=24,
        alias="AUTH_SESSION_TTL_HOURS",
    )
    security_sensitive_audit_failure_code: str = Field(
        default="audit_unavailable",
        alias="SECURITY_SENSITIVE_AUDIT_FAILURE_CODE",
    )
    security_sensitive_denied_code: str = Field(
        default="sensitive_operation_denied",
        alias="SECURITY_SENSITIVE_DENIED_CODE",
    )
    security_sensitive_success_code: str = Field(
        default="sensitive_operation_allowed",
        alias="SECURITY_SENSITIVE_SUCCESS_CODE",
    )

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        populate_by_name=True,
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
