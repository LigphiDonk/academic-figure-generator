"""SystemSettings model – key/value store for admin-configurable settings."""

from decimal import Decimal

from sqlalchemy import Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin


class SystemSettings(Base, TimestampMixin):
    """Single-row table holding global admin settings.

    We use ``id = 1`` as the canonical (only) row, enforced at the
    application level.
    """

    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)

    # Claude API
    claude_api_key_enc: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="AES-256 encrypted system Claude API key",
    )
    claude_api_base_url: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="Custom Claude API base URL (e.g. proxy)",
    )
    claude_model: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        comment="Claude model override",
    )

    # NanoBanana API
    nanobanana_api_key_enc: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="AES-256 encrypted system NanoBanana API key",
    )
    nanobanana_api_base_url: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="Custom NanoBanana API base URL",
    )
    nanobanana_model: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        default="gemini-3-pro-image-preview",
        comment="NanoBanana model id (e.g. gemini-3-pro-image-preview)",
    )

    # Billing / Pricing
    image_price_cny: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
        default=Decimal("1.50"),
        comment="Price per generated image in CNY",
    )
    image_price_cny_1k: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
        default=Decimal("1.50"),
        comment="Price per 1K image in CNY",
    )
    image_price_cny_2k: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
        default=Decimal("1.50"),
        comment="Price per 2K image in CNY",
    )
    image_price_cny_4k: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
        default=Decimal("1.50"),
        comment="Price per 4K image in CNY",
    )
    usd_cny_rate: Mapped[Decimal] = mapped_column(
        Numeric(10, 4),
        nullable=False,
        default=Decimal("7.2000"),
        comment="USD->CNY conversion rate for billing",
    )
    claude_input_usd_per_million: Mapped[Decimal] = mapped_column(
        Numeric(10, 4),
        nullable=False,
        default=Decimal("3.0000"),
        comment="Claude input price (USD per 1M tokens)",
    )
    claude_output_usd_per_million: Mapped[Decimal] = mapped_column(
        Numeric(10, 4),
        nullable=False,
        default=Decimal("15.0000"),
        comment="Claude output price (USD per 1M tokens)",
    )

    # Linux DO OAuth
    linuxdo_client_id: Mapped[str | None] = mapped_column(
        String(200),
        nullable=True,
        comment="Linux DO OAuth Client ID",
    )
    linuxdo_client_secret_enc: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="AES-256 encrypted Linux DO OAuth Client Secret",
    )
    linuxdo_redirect_uri: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="Linux DO OAuth redirect URI",
    )

    # EasyPay (Linux DO Credits)
    epay_pid: Mapped[str | None] = mapped_column(
        String(200),
        nullable=True,
        comment="EasyPay Client ID (pid)",
    )
    epay_key_enc: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="AES-256 encrypted EasyPay key",
    )
    linuxdo_credits_per_cny: Mapped[Decimal] = mapped_column(
        Numeric(10, 4),
        nullable=False,
        default=Decimal("1.0000"),
        comment="Linux DO credits per 1 CNY",
    )
