from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings, sourced from environment variables."""

    model_config = SettingsConfigDict(env_prefix="YIELDO_", env_file=".env", extra="ignore")

    secret_key: str = "dev-insecure-key-change-me"
    data_dir: Path = Path("./data")
    access_token_minutes: int = 30
    refresh_token_days: int = 30
    registration_open: bool = True
    cors_origins: list[str] = ["http://localhost:5173"]
    version: str = "0.1.0"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.data_dir / 'yieldo.db'}"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    return settings


settings = get_settings()
