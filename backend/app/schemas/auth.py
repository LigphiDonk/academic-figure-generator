from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator


class UserRegister(BaseModel):
    email: EmailStr
    password: str
    display_name: str | None = None

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenRefresh(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    display_name: str | None
    is_active: bool
    is_admin: bool = False
    default_color_scheme: str
    default_resolution: str
    default_aspect_ratio: str
    claude_api_key_set: bool
    nanobanana_api_key_set: bool
    claude_api_base_url: str | None = None
    nanobanana_api_base_url: str | None = None
    claude_tokens_quota: int
    nanobanana_images_quota: int
    linuxdo_id: int | None = None
    linuxdo_username: str | None = None
    linuxdo_avatar_url: str | None = None
    created_at: datetime


class UserUpdate(BaseModel):
    display_name: str | None = None
    default_color_scheme: str | None = None
    default_resolution: str | None = None
    default_aspect_ratio: str | None = None
    claude_api_key: str | None = None
    nanobanana_api_key: str | None = None
    claude_api_base_url: str | None = None
    nanobanana_api_base_url: str | None = None
