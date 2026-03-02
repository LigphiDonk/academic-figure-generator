from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .project import Project
    from .user import User


class UsageLog(Base):
    __tablename__ = "usage_logs"

    __table_args__ = (
        Index("ix_usage_logs_user_id", "user_id"),
        Index("ix_usage_logs_user_billing", "user_id", "billing_period"),
    )

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default="gen_random_uuid()",
    )
    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id: Mapped[Optional[UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    api_name: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="claude/nanobanana",
    )
    api_endpoint: Mapped[Optional[str]] = mapped_column(
        String(200),
        nullable=True,
    )
    input_tokens: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )
    output_tokens: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )
    claude_model: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
    )
    resolution: Mapped[Optional[str]] = mapped_column(
        String(10),
        nullable=True,
    )
    aspect_ratio: Mapped[Optional[str]] = mapped_column(
        String(10),
        nullable=True,
    )
    request_duration_ms: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )
    status_code: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )
    is_success: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    error_message: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    estimated_cost_usd: Mapped[Optional[Numeric]] = mapped_column(
        Numeric(10, 6),
        nullable=True,
    )
    estimated_cost_cny: Mapped[Optional[Numeric]] = mapped_column(
        Numeric(12, 6),
        nullable=True,
        comment="Estimated cost in CNY (preferred display currency)",
    )
    billing_period: Mapped[str] = mapped_column(
        String(7),
        nullable=False,
        comment="YYYY-MM format",
    )
    key_source: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="platform/byok",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="usage_logs")
    project: Mapped[Optional["Project"]] = relationship("Project")
