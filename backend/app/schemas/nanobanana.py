"""Schemas for NanoBanana model discovery."""

from pydantic import BaseModel, field_validator


class NanoBananaModelsProbeRequest(BaseModel):
    """临时 NanoBanana 探测配置。"""

    nanobanana_api_key: str | None = None
    nanobanana_api_base_url: str | None = None

    @field_validator("nanobanana_api_key", "nanobanana_api_base_url", mode="before")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class NanoBananaModelOptionResponse(BaseModel):
    """单个 NanoBanana 模型选项。"""

    id: str
    display_name: str


class NanoBananaModelsResponse(BaseModel):
    """统一 NanoBanana 模型列表响应。"""

    models: list[NanoBananaModelOptionResponse]
