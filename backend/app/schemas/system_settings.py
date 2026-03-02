"""Schemas for admin system settings."""

from pydantic import BaseModel


class SystemSettingsResponse(BaseModel):
    """Response: global system settings (keys masked)."""

    claude_api_key_set: bool = False
    claude_api_base_url: str | None = None
    claude_model: str | None = None
    nanobanana_api_key_set: bool = False
    nanobanana_api_base_url: str | None = None
    nanobanana_model: str | None = None
    image_price_cny: float | None = None
    image_price_cny_1k: float | None = None
    image_price_cny_2k: float | None = None
    image_price_cny_4k: float | None = None
    usd_cny_rate: float | None = None
    claude_input_usd_per_million: float | None = None
    claude_output_usd_per_million: float | None = None


class SystemSettingsUpdate(BaseModel):
    """Request body for updating system settings."""

    claude_api_key: str | None = None
    claude_api_base_url: str | None = None
    claude_model: str | None = None
    nanobanana_api_key: str | None = None
    nanobanana_api_base_url: str | None = None
    nanobanana_model: str | None = None
    image_price_cny: float | None = None
    image_price_cny_1k: float | None = None
    image_price_cny_2k: float | None = None
    image_price_cny_4k: float | None = None
    usd_cny_rate: float | None = None
    claude_input_usd_per_million: float | None = None
    claude_output_usd_per_million: float | None = None
