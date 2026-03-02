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
    password_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
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
    claude_api_key_enc: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="AES-256 encrypted BYOK Claude API key",
    )
    nanobanana_api_key_enc: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="AES-256 encrypted BYOK Nanobanana API key",
    )
    claude_api_base_url: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
        comment="User-custom Claude API base URL",
    )
    nanobanana_api_base_url: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
        comment="User-custom NanoBanana API base URL",
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
    claude_tokens_quota: Mapped[int] = mapped_column(
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
