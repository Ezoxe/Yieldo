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
    # How long an agent access key lives before it stops authenticating and the
    # next look at Réglages issues its replacement. A day is short enough that a
    # key pasted into a third-party agent and forgotten stops mattering, and long
    # enough that a working session is not interrupted by a rotation.
    agent_key_hours: int = 24
    # How long the optional language model is given to answer before the
    # commentary is abandoned and the deterministic figure stands alone. The
    # DEFAULT for a household that never stated one; a slow local reasoner is
    # configured per account in Réglages → Connexions rather than here, so one
    # household's choice of model does not set every household's ceiling.
    #
    # Thirty seconds was the hardcoded value, and it was measured too low: a
    # small local reasoning model (gemma-4-E2B-it-qat, llama.cpp on a LAN box)
    # spent 1 149 characters thinking before 230 of answer and returned at
    # 34,7 s — a working model that degraded to "a répondu trop tard" every
    # single time, with no way to say so short of editing this file.
    #
    # Two minutes, not the 60 that measurement alone would justify: 34,7 s and
    # 43,9 s were two runs of the SAME question on an idle box, and a longer
    # question on a busy one costs more than the 16 s of headroom 60 left. The
    # cost of a ceiling set too high is a wait the household can see coming;
    # the cost of one set too low is a working model that silently never
    # contributes.
    llm_timeout_seconds: int = 120
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
