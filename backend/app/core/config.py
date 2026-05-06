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
