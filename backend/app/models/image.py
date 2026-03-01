from typing import TYPE_CHECKING, Optional

from sqlalchemy import BigInteger, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin

if TYPE_CHECKING:
    from .project import Project
    from .prompt import Prompt
    from .user import User


class Image(Base, TimestampMixin):
    __tablename__ = "images"

    __table_args__ = (
        Index("ix_images_prompt_id", "prompt_id"),
        Index("ix_images_project_id", "project_id"),
        Index("ix_images_user_id", "user_id"),
    )

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default="gen_random_uuid()",
    )
    prompt_id: Mapped[Optional[UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("prompts.id", ondelete="SET NULL"),
        nullable=True,
    )
    project_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    resolution: Mapped[str] = mapped_column(
        String(10),
        default="2K",
        nullable=False,
    )
    aspect_ratio: Mapped[str] = mapped_column(
        String(10),
        default="16:9",
        nullable=False,
    )
    color_scheme: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
    )
    custom_colors: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
    )
    reference_image_path: Mapped[Optional[str]] = mapped_column(
        String(1000),
        nullable=True,
    )
    edit_instruction: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    storage_path: Mapped[Optional[str]] = mapped_column(
        String(1000),
        nullable=True,
    )
    file_size_bytes: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        nullable=True,
    )
    width_px: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )
    height_px: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )
    generation_task_id: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="Celery task ID",
    )
    generation_status: Mapped[str] = mapped_column(
        String(20),
        default="pending",
        nullable=False,
    )
    generation_duration_ms: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )
    generation_error: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Failure reason for generation (best-effort).",
    )
    final_prompt_sent: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    retry_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )

    # Relationships
    prompt: Mapped[Optional["Prompt"]] = relationship("Prompt", back_populates="images")
    project: Mapped["Project"] = relationship("Project", back_populates="images")
    user: Mapped["User"] = relationship("User", back_populates="images")
