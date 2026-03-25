import ast
from functools import lru_cache
import json
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode


class Settings(BaseSettings):
    # App
    APP_NAME: str = "academic-figure-generator"
    APP_ENV: str = "development"
    DEBUG: bool = True
    SECRET_KEY: str
    API_V1_PREFIX: str = "/api/v1"

    # Database
    POSTGRES_HOST: str = "postgres"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "afg_user"
    POSTGRES_PASSWORD: str
    POSTGRES_DB: str = "academic_figure_generator"

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def DATABASE_URL_SYNC(self) -> str:
        return (
            f"postgresql+psycopg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    # Redis
    REDIS_URL: str = "redis://redis:6379/0"
    CELERY_BROKER_URL: str = "redis://redis:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://redis:6379/2"

    # MinIO
    MINIO_ENDPOINT: str = "minio:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str
    MINIO_BUCKET_NAME: str = "academic-figures"
    MINIO_USE_SSL: bool = False

    # JWT
    JWT_SECRET_KEY: str = ""  # defaults to SECRET_KEY if empty
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Encryption
    ENCRYPTION_MASTER_KEY: str

    # Prompt AI
    PROMPT_AI_PROVIDER: str = "anthropic"
    PROMPT_AI_API_KEY: str = ""
    PROMPT_AI_API_BASE_URL: str = ""
    PROMPT_AI_MODEL: str = "claude-sonnet-4-20250514"
    PROMPT_AI_MAX_TOKENS: int = 8192

    # NanoBanana API
    NANOBANANA_API_KEY: str = ""
    NANOBANANA_API_BASE: str = "https://api.keepgo.icu"
    NANOBANANA_MODEL: str = "gemini-3-pro-image-preview"

    # CORS
    CORS_ORIGINS: Annotated[list[str], NoDecode] = [
        "http://localhost:3000",
        "http://localhost:5173",
    ]

    # Rate Limiting
    RATE_LIMIT_DEFAULT: str = "100/minute"
    RATE_LIMIT_AUTH: str = "10/minute"
    RATE_LIMIT_GENERATION: str = "20/hour"

    # Upload
    MAX_UPLOAD_SIZE_MB: int = 50

    @field_validator("API_V1_PREFIX")
    @classmethod
    def _normalize_api_prefix(cls, value: str) -> str:
        """Normalize API prefix to avoid double slashes like `/api/v1//auth/...`."""
        prefix = (value or "").strip()
        if not prefix:
            return "/api/v1"
        if not prefix.startswith("/"):
            prefix = f"/{prefix}"
        prefix = prefix.rstrip("/")
        return prefix or "/api/v1"

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _normalize_cors_origins(cls, value: object) -> list[str]:
        """兼容 JSON、Python 列表字面量与逗号分隔格式。"""
        if value is None:
            return []

        if isinstance(value, (list, tuple, set)):
            return [str(item).strip() for item in value if str(item).strip()]

        if not isinstance(value, str):
            return [str(value).strip()] if str(value).strip() else []

        raw = value.strip()
        if not raw:
            return []

        for parser in (json.loads, ast.literal_eval):
            try:
                parsed = parser(raw)
            except (json.JSONDecodeError, SyntaxError, ValueError):
                continue

            if isinstance(parsed, (list, tuple, set)):
                return [str(item).strip() for item in parsed if str(item).strip()]
            if isinstance(parsed, str) and parsed.strip():
                return [parsed.strip()]

        if raw.startswith("[") and raw.endswith("]"):
            raw = raw[1:-1].strip()

        return [
            item.strip().strip('"').strip("'")
            for item in raw.split(",")
            if item.strip().strip('"').strip("'")
        ]

    def get_jwt_secret(self) -> str:
        """Return JWT secret key, falling back to SECRET_KEY if not set."""
        return self.JWT_SECRET_KEY or self.SECRET_KEY

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
