"""Application settings — personal-use local version."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings

# Project root: backend/
_BACKEND_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    # App
    APP_NAME: str = "academic-figure-generator"
    DEBUG: bool = True
    SECRET_KEY: str = "local-dev-key"
    API_V1_PREFIX: str = "/api/v1"

    # SQLite
    DATABASE_PATH: str = str(_BACKEND_ROOT / "data" / "app.db")

    @property
    def DATABASE_URL(self) -> str:
        return f"sqlite+aiosqlite:///{self.DATABASE_PATH}"

    # Data directory (uploads, figures)
    DATA_DIR: str = str(_BACKEND_ROOT / "data")

    # Claude Agent SDK (uses ANTHROPIC_API_KEY env var directly)
    ANTHROPIC_API_KEY: str = ""

    # Public scientific-reference lookup while generating figure prompts.
    WEB_REFERENCES_ENABLED: bool = True
    WEB_REFERENCES_TIMEOUT_SECONDS: float = Field(default=30, gt=0, le=300)

    # NanoBanana / Gemini image generation API
    NANOBANANA_API_KEY: str = ""
    NANOBANANA_API_BASE: str = "https://api.keepgo.icu"
    NANOBANANA_MODEL: str = "gemini-3-pro-image-preview"

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    # Upload
    MAX_UPLOAD_SIZE_MB: int = 50

    @field_validator("API_V1_PREFIX")
    @classmethod
    def _normalize_api_prefix(cls, value: str) -> str:
        prefix = (value or "").strip()
        if not prefix:
            return "/api/v1"
        if not prefix.startswith("/"):
            prefix = f"/{prefix}"
        prefix = prefix.rstrip("/")
        return prefix or "/api/v1"

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
