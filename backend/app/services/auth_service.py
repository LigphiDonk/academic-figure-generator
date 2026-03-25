"""Authentication and user management service."""

from __future__ import annotations

import logging
from uuid import UUID

from jose import JWTError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    BadRequestException,
    NotFoundException,
    UnauthorizedException,
)
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decrypt_api_key,
    encrypt_api_key,
    hash_password,
    mask_api_key,
    verify_password,
    verify_token,
)
from app.models.user import User

logger = logging.getLogger(__name__)


class AuthService:
    """Handles registration, login, token management, and user profile updates."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    async def register(
        self,
        email: str,
        password: str,
        display_name: str | None = None,
    ) -> User:
        """Create a new user account.

        Raises BadRequestException if the email is already registered.
        """
        # Check email uniqueness
        stmt = select(User).where(User.email == email)
        result = await self.db.execute(stmt)
        existing = result.scalar_one_or_none()
        if existing is not None:
            raise BadRequestException("Email is already registered")

        hashed = hash_password(password)
        user = User(
            email=email,
            password_hash=hashed,
            display_name=display_name,
        )
        self.db.add(user)

        try:
            await self.db.flush()
        except IntegrityError as exc:
            await self.db.rollback()
            logger.warning("Duplicate email race condition for %s: %s", email, exc)
            raise BadRequestException("Email is already registered") from exc

        await self.db.refresh(user)
        logger.info("User registered: %s (id=%s)", email, user.id)
        return user

    # ------------------------------------------------------------------
    # Login
    # ------------------------------------------------------------------

    async def login(self, email: str, password: str) -> tuple[str, str]:
        """Verify credentials and return an (access_token, refresh_token) pair.

        Raises UnauthorizedException on invalid email or password.
        """
        stmt = select(User).where(User.email == email)
        result = await self.db.execute(stmt)
        user: User | None = result.scalar_one_or_none()

        if user is None or not verify_password(password, user.password_hash):
            raise UnauthorizedException("Invalid email or password")

        if not user.is_active:
            raise UnauthorizedException("Account is deactivated")

        token_data = {"sub": str(user.id), "email": user.email}
        access_token = create_access_token(token_data)
        refresh_token = create_refresh_token(token_data)

        logger.info("User logged in: %s", email)
        return access_token, refresh_token

    # ------------------------------------------------------------------
    # Token refresh (rotation)
    # ------------------------------------------------------------------

    async def refresh_token(self, refresh_token: str) -> tuple[str, str]:
        """Verify a refresh token and issue a new (access, refresh) pair.

        Implements token rotation: each refresh token can only be used once
        conceptually (the old token expires naturally via JWT TTL).
        Raises UnauthorizedException on invalid / expired tokens.
        """
        try:
            payload = verify_token(refresh_token)
        except JWTError as exc:
            raise UnauthorizedException("Invalid or expired refresh token") from exc

        if payload.get("type") != "refresh":
            raise UnauthorizedException("Token is not a refresh token")

        user_id = payload.get("sub")
        if user_id is None:
            raise UnauthorizedException("Token payload missing subject")

        # Verify user still exists and is active
        stmt = select(User).where(User.id == user_id)
        result = await self.db.execute(stmt)
        user: User | None = result.scalar_one_or_none()

        if user is None:
            raise UnauthorizedException("User not found")
        if not user.is_active:
            raise UnauthorizedException("Account is deactivated")

        token_data = {"sub": str(user.id), "email": user.email}
        new_access = create_access_token(token_data)
        new_refresh = create_refresh_token(token_data)

        return new_access, new_refresh

    # ------------------------------------------------------------------
    # User retrieval
    # ------------------------------------------------------------------

    async def get_user(self, user_id: UUID) -> User:
        """Fetch a user by primary key.

        Raises NotFoundException if the user does not exist.
        """
        stmt = select(User).where(User.id == user_id)
        result = await self.db.execute(stmt)
        user: User | None = result.scalar_one_or_none()
        if user is None:
            raise NotFoundException("User not found")
        return user

    # ------------------------------------------------------------------
    # User update
    # ------------------------------------------------------------------

    async def update_user(self, user_id: UUID, **kwargs) -> User:
        """Update user profile fields.

        Accepted keyword arguments:
            display_name, default_color_scheme, default_resolution,
            default_aspect_ratio, prompt_ai_api_key, nanobanana_api_key

        API keys are encrypted before storage. Pass an empty string to
        clear a stored API key.
        """
        user = await self.get_user(user_id)

        # Simple scalar fields
        simple_fields = {
            "display_name",
            "default_color_scheme",
            "default_resolution",
            "default_aspect_ratio",
        }
        for field in simple_fields:
            if field in kwargs and kwargs[field] is not None:
                setattr(user, field, kwargs[field])

        # Encrypt and store BYOK Prompt AI API key
        if "prompt_ai_api_key" in kwargs:
            raw_key = kwargs["prompt_ai_api_key"]
            if raw_key:
                user.prompt_ai_api_key_enc = encrypt_api_key(raw_key)
            else:
                # Empty string means clear the key
                user.prompt_ai_api_key_enc = None

        # Encrypt and store BYOK NanoBanana API key
        if "nanobanana_api_key" in kwargs:
            raw_key = kwargs["nanobanana_api_key"]
            if raw_key:
                user.nanobanana_api_key_enc = encrypt_api_key(raw_key)
            else:
                user.nanobanana_api_key_enc = None

        await self.db.flush()
        await self.db.refresh(user)
        logger.info("User updated: id=%s, fields=%s", user_id, list(kwargs.keys()))
        return user

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def get_user_api_key_info(user: User) -> dict:
        """Return masked API key info for the user profile response."""
        prompt_ai_set = user.prompt_ai_api_key_enc is not None
        nanobanana_set = user.nanobanana_api_key_enc is not None

        info: dict = {
            "prompt_ai_api_key_set": prompt_ai_set,
            "nanobanana_api_key_set": nanobanana_set,
        }

        if prompt_ai_set:
            try:
                info["prompt_ai_api_key_masked"] = mask_api_key(
                    decrypt_api_key(user.prompt_ai_api_key_enc)
                )
            except ValueError:
                info["prompt_ai_api_key_masked"] = "****"

        if nanobanana_set:
            try:
                info["nanobanana_api_key_masked"] = mask_api_key(
                    decrypt_api_key(user.nanobanana_api_key_enc)
                )
            except ValueError:
                info["nanobanana_api_key_masked"] = "****"

        return info

    @staticmethod
    def get_decrypted_api_key(user: User, key_name: str) -> str | None:
        """Decrypt and return a user's stored API key, or None if not set.

        key_name: 'prompt_ai' or 'nanobanana'
        """
        enc_field = f"{key_name}_api_key_enc"
        enc_value = getattr(user, enc_field, None)
        if enc_value is None:
            return None
        try:
            return decrypt_api_key(enc_value)
        except ValueError:
            logger.warning(
                "Failed to decrypt %s API key for user %s", key_name, user.id
            )
            return None
