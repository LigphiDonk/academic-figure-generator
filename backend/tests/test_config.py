from __future__ import annotations

from app.config import Settings


def _apply_required_env(monkeypatch) -> None:
    monkeypatch.setenv("SECRET_KEY", "secret")
    monkeypatch.setenv("POSTGRES_PASSWORD", "postgres-password")
    monkeypatch.setenv("MINIO_SECRET_KEY", "minio-secret")
    monkeypatch.setenv("ENCRYPTION_MASTER_KEY", "encryption-master-key")


def test_settings_accepts_json_cors_origins_from_env(monkeypatch) -> None:
    _apply_required_env(monkeypatch)
    monkeypatch.setenv(
        "CORS_ORIGINS",
        '["http://localhost:3000","http://localhost:5173"]',
    )

    settings = Settings(_env_file=None)

    assert settings.CORS_ORIGINS == [
        "http://localhost:3000",
        "http://localhost:5173",
    ]


def test_settings_accepts_python_style_cors_origins_from_env(monkeypatch) -> None:
    _apply_required_env(monkeypatch)
    monkeypatch.setenv(
        "CORS_ORIGINS",
        "['http://localhost:3000', 'http://localhost:5173']",
    )

    settings = Settings(_env_file=None)

    assert settings.CORS_ORIGINS == [
        "http://localhost:3000",
        "http://localhost:5173",
    ]


def test_settings_accepts_comma_separated_cors_origins_from_env(monkeypatch) -> None:
    _apply_required_env(monkeypatch)
    monkeypatch.setenv(
        "CORS_ORIGINS",
        "http://localhost:3000, http://localhost:5173",
    )

    settings = Settings(_env_file=None)

    assert settings.CORS_ORIGINS == [
        "http://localhost:3000",
        "http://localhost:5173",
    ]


def test_settings_accepts_shell_sourced_bracketed_cors_origins(monkeypatch) -> None:
    _apply_required_env(monkeypatch)
    monkeypatch.setenv(
        "CORS_ORIGINS",
        "[http://localhost:8082,http://127.0.0.1:8082,http://localhost]",
    )

    settings = Settings(_env_file=None)

    assert settings.CORS_ORIGINS == [
        "http://localhost:8082",
        "http://127.0.0.1:8082",
        "http://localhost",
    ]
