"""FastAPI application factory."""

import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

from fastapi import FastAPI

from app.config import get_settings
from app.core.exceptions import register_exception_handlers
from app.core.middleware import setup_middleware

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan: startup and shutdown logic."""
    # Startup
    logger.info("Starting up Academic Figure Generator API...")
    try:
        from app.services.storage_service import StorageService  # noqa: PLC0415

        storage = StorageService()
        storage.ensure_bucket()
        logger.info("MinIO bucket verified.")
    except Exception as exc:  # noqa: BLE001
        logger.warning("MinIO bucket setup failed (continuing): %s", exc)

    # Seed default admin user if no admin exists
    try:
        await _seed_admin_user()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Admin user seeding failed (continuing): %s", exc)

    # Seed preset color schemes if missing
    try:
        await _seed_preset_color_schemes()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Preset color scheme seeding failed (continuing): %s", exc)

    yield

    # Shutdown
    logger.info("Shutting down Academic Figure Generator API...")


async def _seed_admin_user() -> None:
    """Create a default admin account if none exists."""
    from sqlalchemy import select  # noqa: PLC0415

    from app.core.security import hash_password  # noqa: PLC0415
    from app.dependencies import get_async_session_factory  # noqa: PLC0415
    from app.models.user import User  # noqa: PLC0415

    session_factory = get_async_session_factory()
    async with session_factory() as session:
        # Check if any admin already exists
        result = await session.execute(select(User).where(User.is_admin.is_(True)))
        existing_admin = result.scalar_one_or_none()
        if existing_admin is not None:
            logger.info("Admin user already exists (%s), skipping seed.", existing_admin.email)
            return

        admin = User(
            email="admin@admin.com",
            password_hash=hash_password("admin"),
            display_name="管理员",
            is_admin=True,
            is_active=True,
        )
        session.add(admin)
        await session.commit()
        logger.info("Default admin user created: admin@admin.com / admin")


async def _seed_preset_color_schemes() -> None:
    """Ensure system preset color schemes exist in the DB (idempotent)."""
    from sqlalchemy import select  # noqa: PLC0415

    from app.core.prompts.color_schemes import (  # noqa: PLC0415
        COLOR_SCHEME_DISPLAY_NAMES,
        DEFAULT_COLOR_SCHEME,
        PRESET_COLOR_SCHEMES,
    )
    from app.dependencies import get_async_session_factory  # noqa: PLC0415
    from app.models.color_scheme import ColorScheme  # noqa: PLC0415

    session_factory = get_async_session_factory()
    async with session_factory() as session:
        for slug, colors in PRESET_COLOR_SCHEMES.items():
            display_name = COLOR_SCHEME_DISPLAY_NAMES.get(slug, slug)
            existing = (
                await session.execute(
                    select(ColorScheme.id).where(
                        ColorScheme.type == "preset",
                        ColorScheme.name == display_name,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                continue

            session.add(
                ColorScheme(
                    user_id=None,
                    name=display_name,
                    type="preset",
                    colors=colors,
                    is_default=(slug == DEFAULT_COLOR_SCHEME),
                )
            )

        await session.commit()


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title="Academic Figure Generator API",
        version="0.1.0",
        description="AI-powered scientific paper illustration service",
        docs_url="/docs" if settings.DEBUG else None,
        redoc_url="/redoc" if settings.DEBUG else None,
        lifespan=lifespan,
    )

    # Middleware (CORS, request logging, etc.)
    setup_middleware(app)

    # Exception handlers
    register_exception_handlers(app)

    # Routers
    _include_routers(app, settings.API_V1_PREFIX)

    return app


def _include_routers(app: FastAPI, prefix: str) -> None:
    """Register all v1 API routers."""
    # Each router module is imported lazily so missing stubs don't block startup.
    router_modules = [
        ("app.api.v1.auth", "router"),
        ("app.api.v1.health", "router"),
        ("app.api.v1.projects", "router"),
        ("app.api.v1.documents", "router"),
        ("app.api.v1.prompts", "router"),
        ("app.api.v1.images", "router"),
        ("app.api.v1.color_schemes", "router"),
        ("app.api.v1.usage", "router"),
        ("app.api.v1.admin", "router"),
        ("app.api.v1.payment", "router"),
    ]

    for module_path, attr in router_modules:
        try:
            import importlib  # noqa: PLC0415

            module = importlib.import_module(module_path)
            router = getattr(module, attr)
            app.include_router(router, prefix=prefix)
            logger.debug("Registered router: %s", module_path)
        except (ImportError, AttributeError) as exc:
            logger.warning("Skipping router %s: %s", module_path, exc)


app = create_app()
