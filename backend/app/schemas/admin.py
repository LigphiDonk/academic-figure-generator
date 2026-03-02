"""Admin schemas for user management."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator


class AdminUserResponse(BaseModel):
    """User info as seen by admin."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    display_name: str | None
    is_active: bool
    is_admin: bool
    balance_cny: float
    nanobanana_images_quota: int
    claude_tokens_quota: int
    created_at: datetime
    updated_at: datetime | None = None


class AdminUserCreate(BaseModel):
    """Admin creates a new user."""

    email: EmailStr
    password: str
    display_name: str | None = None
    is_admin: bool = False
    nanobanana_images_quota: int = 0
    balance_cny: float = 0.0

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("密码至少需要 6 个字符")
        return v


class AdminUserUpdate(BaseModel):
    """Admin updates user fields."""

    display_name: str | None = None
    is_active: bool | None = None
    is_admin: bool | None = None
    nanobanana_images_quota: int | None = None
    claude_tokens_quota: int | None = None
    balance_cny: float | None = None


class AdminCreditUpdate(BaseModel):
    """Adjust user credits (positive = add, negative = subtract)."""

    delta: int

    @field_validator("delta")
    @classmethod
    def delta_not_zero(cls, v: int) -> int:
        if v == 0:
            raise ValueError("额度调整值不能为 0")
        return v


class AdminBalanceUpdate(BaseModel):
    """Adjust user balance in CNY (positive = add, negative = subtract)."""

    delta_cny: float

    @field_validator("delta_cny")
    @classmethod
    def delta_cny_not_zero(cls, v: float) -> float:
        if v == 0:
            raise ValueError("余额调整值不能为 0")
        return v
