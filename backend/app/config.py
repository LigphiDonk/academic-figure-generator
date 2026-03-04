from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings


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

    # Claude API
    CLAUDE_API_KEY: str = ""
    CLAUDE_MODEL: str = "claude-sonnet-4-20250514"
    CLAUDE_MAX_TOKENS: int = 8192

    # NanoBanana API
    NANOBANANA_API_KEY: str = ""
    NANOBANANA_API_BASE: str = "https://api.keepgo.icu"

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:5173"]

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

    def get_jwt_secret(self) -> str:
        """Return JWT secret key, falling back to SECRET_KEY if not set."""
        return self.JWT_SECRET_KEY or self.SECRET_KEY

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
