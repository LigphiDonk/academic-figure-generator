from typing import TYPE_CHECKING, Optional

from decimal import Decimal

from sqlalchemy import Boolean, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin

if TYPE_CHECKING:
    from .document import Document
    from .image import Image
    from .project import Project
    from .prompt import Prompt
    from .usage import UsageLog


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default="gen_random_uuid()",
    )
    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=False,
    )
    password_hash: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    display_name: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    is_admin: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )
    prompt_ai_provider: Mapped[str] = mapped_column(
        String(50),
        default="anthropic",
        nullable=False,
        comment="User-selected Prompt AI provider",
    )
    prompt_ai_api_key_enc: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="AES-256 encrypted BYOK Prompt AI API key",
    )
    nanobanana_api_key_enc: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="AES-256 encrypted BYOK Nanobanana API key",
    )
    prompt_ai_api_base_url: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
        comment="User-custom Prompt AI API base URL",
    )
    prompt_ai_model: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="User-selected Prompt AI model",
    )
    nanobanana_api_base_url: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
        comment="User-custom NanoBanana API base URL",
    )
    nanobanana_model: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="User-selected NanoBanana model",
    )
    paddleocr_server_url: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
        comment="User-configured PaddleOCR server URL",
    )
    paddleocr_token_enc: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="AES-256 encrypted PaddleOCR access token",
    )
    default_color_scheme: Mapped[str] = mapped_column(
        String(50),
        default="okabe-ito",
        nullable=False,
    )
    default_resolution: Mapped[str] = mapped_column(
        String(10),
        default="2K",
        nullable=False,
    )
    default_aspect_ratio: Mapped[str] = mapped_column(
        String(10),
        default="16:9",
        nullable=False,
    )
    prompt_ai_tokens_quota: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )
    nanobanana_images_quota: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )
    balance_cny: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        default=0,
        nullable=False,
        comment="Unified user balance in CNY",
    )

    # Linux DO OAuth fields
    linuxdo_id: Mapped[int | None] = mapped_column(
        Integer,
        unique=True,
        index=True,
        nullable=True,
        comment="Linux DO user unique ID",
    )
    linuxdo_username: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        comment="Linux DO username",
    )
    linuxdo_avatar_url: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="Linux DO avatar URL",
    )
    linuxdo_trust_level: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Linux DO trust level",
    )

    # Relationships
    projects: Mapped[list["Project"]] = relationship(
        "Project", back_populates="user", cascade="all, delete-orphan"
    )
    documents: Mapped[list["Document"]] = relationship(
        "Document", back_populates="user", cascade="all, delete-orphan"
    )
    prompts: Mapped[list["Prompt"]] = relationship(
        "Prompt", back_populates="user", cascade="all, delete-orphan"
    )
    images: Mapped[list["Image"]] = relationship(
        "Image", back_populates="user", cascade="all, delete-orphan"
    )
    usage_logs: Mapped[list["UsageLog"]] = relationship(
        "UsageLog", back_populates="user", cascade="all, delete-orphan"
    )
