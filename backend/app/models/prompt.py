from typing import TYPE_CHECKING, Optional

from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin

if TYPE_CHECKING:
    from .document import Document
    from .image import Image
    from .project import Project
    from .user import User


class Prompt(Base, TimestampMixin):
    __tablename__ = "prompts"

    __table_args__ = (
        Index("ix_prompts_project_id", "project_id"),
        Index("ix_prompts_user_id", "user_id"),
    )

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default="gen_random_uuid()",
    )
    project_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    document_id: Mapped[Optional[UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="SET NULL"),
        nullable=True,
    )
    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    figure_number: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    title: Mapped[Optional[str]] = mapped_column(
        String(300),
        nullable=True,
    )
    original_prompt: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="AI-generated prompt",
    )
    edited_prompt: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="User-edited prompt",
    )
    suggested_figure_type: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
    )
    suggested_aspect_ratio: Mapped[Optional[str]] = mapped_column(
        String(10),
        nullable=True,
    )
    source_sections: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
        comment="Which document sections this prompt covers",
    )
    generator_provider: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="anthropic",
        comment="Prompt generator provider",
    )
    generator_model: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="Prompt generator model",
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

    @hybrid_property
    def active_prompt(self) -> Optional[str]:
        """Returns edited_prompt if set, otherwise original_prompt."""
        if self.edited_prompt:
            return self.edited_prompt
        return self.original_prompt

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="prompts")
    document: Mapped[Optional["Document"]] = relationship("Document")
    user: Mapped["User"] = relationship("User", back_populates="prompts")
    images: Mapped[list["Image"]] = relationship(
        "Image", back_populates="prompt", cascade="all, delete-orphan"
    )
