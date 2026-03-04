"""PaymentOrder model – tracks Linux DO credits top-up transactions."""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin


class PaymentOrder(Base, TimestampMixin):
    """Records each user top-up payment via Linux DO EasyPay."""

    __tablename__ = "payment_orders"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    out_trade_no: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        index=True,
        nullable=False,
        comment="PAY-{timestamp}-{random6}",
    )
    trade_no: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="Trade number returned by Linux DO",
    )
    amount_cny: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
        comment="Top-up amount in CNY",
    )
    amount_credits: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
        comment="Corresponding Linux DO credits",
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="pending",
        comment="pending / paid / failed",
    )
    paid_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    notify_data: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Raw callback JSON for audit",
    )
