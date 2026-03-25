"""NanoBanana 配置解析与模型发现服务。"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import get_settings
from app.core.exceptions import ExternalAPIException

logger = logging.getLogger(__name__)

DEFAULT_NANOBANANA_API_BASE_URL = "https://api.keepgo.icu"
DEFAULT_NANOBANANA_MODEL = "gemini-3-pro-image-preview"


@dataclass(frozen=True)
class NanoBananaConfigLayer:
    """单层 NanoBanana 配置。"""

    api_key: str | None = None
    api_base_url: str | None = None
    model: str | None = None


@dataclass(frozen=True)
class ResolvedNanoBananaSettings:
    """合并后的有效 NanoBanana 配置。"""

    api_key: str
    api_base_url: str
    model: str
    key_source: str


@dataclass(frozen=True)
class NanoBananaModelOption:
    """NanoBanana 可选模型项。"""

    id: str
    display_name: str


def _first_non_blank(*values: str | None) -> str | None:
    for value in values:
        if value is None:
            continue
        cleaned = value.strip()
        if cleaned:
            return cleaned
    return None


def normalize_nanobanana_base_url(base_or_full: str | None) -> str:
    """将基础地址或完整地址规范化为基础 URL。"""
    base_url = (base_or_full or DEFAULT_NANOBANANA_API_BASE_URL).strip()
    if not base_url:
        base_url = DEFAULT_NANOBANANA_API_BASE_URL
    base_url = base_url.rstrip("/")

    for suffix in ("/v1beta/models", "/v1/models"):
        if base_url.endswith(suffix):
            return base_url[: -len(suffix)]

    if "/v1beta/models/" in base_url:
        return base_url.split("/v1beta/models/", 1)[0]
    if "/v1/models/" in base_url:
        return base_url.split("/v1/models/", 1)[0]
    return base_url


def normalize_nanobanana_models_url(base_or_full: str | None) -> str:
    """规范化 NanoBanana 模型列表端点。"""
    return f"{normalize_nanobanana_base_url(base_or_full)}/v1beta/models"


def extract_nanobanana_model_options(
    payload: dict[str, Any]
) -> list[NanoBananaModelOption]:
    """从 NanoBanana 模型列表响应中提取统一结构。"""
    raw_models = payload.get("models")
    if not isinstance(raw_models, list):
        raw_models = payload.get("data")
    if not isinstance(raw_models, list):
        raise ValueError("模型列表响应缺少 models/data 数组")

    options: list[NanoBananaModelOption] = []
    seen_ids: set[str] = set()

    for item in raw_models:
        if not isinstance(item, dict):
            continue

        raw_id = str(
            item.get("id")
            or item.get("model")
            or item.get("name")
            or ""
        ).strip()
        model_id = raw_id.removeprefix("models/").strip()
        if not model_id or model_id in seen_ids:
            continue

        display_name = str(
            item.get("display_name")
            or item.get("displayName")
            or model_id
        ).strip() or model_id

        seen_ids.add(model_id)
        options.append(NanoBananaModelOption(id=model_id, display_name=display_name))

    return options


def get_env_nanobanana_config_layer() -> NanoBananaConfigLayer:
    """读取环境变量中的 NanoBanana 配置层。"""
    settings = get_settings()
    return NanoBananaConfigLayer(
        api_key=settings.NANOBANANA_API_KEY,
        api_base_url=settings.NANOBANANA_API_BASE,
        model=settings.NANOBANANA_MODEL,
    )


def resolve_nanobanana_settings(
    *,
    user_layer: NanoBananaConfigLayer | None = None,
    system_layer: NanoBananaConfigLayer | None = None,
    env_layer: NanoBananaConfigLayer | None = None,
) -> ResolvedNanoBananaSettings:
    """按优先级合并 NanoBanana 配置。"""
    user = user_layer or NanoBananaConfigLayer()
    system = system_layer or NanoBananaConfigLayer()
    env = env_layer or NanoBananaConfigLayer()

    api_key = _first_non_blank(user.api_key, system.api_key, env.api_key) or ""
    api_base_url = _first_non_blank(
        user.api_base_url, system.api_base_url, env.api_base_url
    ) or DEFAULT_NANOBANANA_API_BASE_URL
    model = _first_non_blank(user.model, system.model, env.model) or DEFAULT_NANOBANANA_MODEL

    if _first_non_blank(user.api_key):
        key_source = "byok"
    else:
        key_source = "platform"

    return ResolvedNanoBananaSettings(
        api_key=api_key,
        api_base_url=api_base_url,
        model=model,
        key_source=key_source,
    )


class NanoBananaService:
    """NanoBanana 模型发现服务。"""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        api_base_url: str | None = None,
        model: str | None = None,
    ) -> None:
        resolved = resolve_nanobanana_settings(
            user_layer=NanoBananaConfigLayer(
                api_key=api_key,
                api_base_url=api_base_url,
                model=model,
            ),
            env_layer=get_env_nanobanana_config_layer(),
        )
        if not resolved.api_key:
            raise ExternalAPIException(
                "NanoBanana",
                "No API key configured. Configure BYOK or platform NanoBanana key.",
            )

        self.config = resolved
        self.models_url = normalize_nanobanana_models_url(resolved.api_base_url)

    async def list_models(
        self,
        *,
        timeout: float = 30.0,
        wrap_errors: bool = True,
    ) -> list[NanoBananaModelOption]:
        """拉取当前 Key 可用的 NanoBanana 模型列表。"""
        start_time = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.get(
                    self.models_url,
                    headers={
                        "Authorization": f"Bearer {self.config.api_key}",
                        "Content-Type": "application/json",
                    },
                )
                duration_ms = int((time.monotonic() - start_time) * 1000)
                response.raise_for_status()
                data = response.json()
        except httpx.TimeoutException as exc:
            duration_ms = int((time.monotonic() - start_time) * 1000)
            logger.error(
                "NanoBanana model listing timeout | duration_ms=%d error=%s",
                duration_ms,
                exc,
            )
            if not wrap_errors:
                raise
            raise ExternalAPIException(
                "NanoBanana",
                f"models request timed out after {duration_ms}ms",
            ) from exc
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:500]
            logger.error(
                "NanoBanana model listing HTTP error | status=%d detail=%s",
                exc.response.status_code,
                detail,
            )
            if not wrap_errors:
                raise
            raise ExternalAPIException(
                "NanoBanana",
                f"models HTTP {exc.response.status_code}: {detail}",
            ) from exc
        except httpx.HTTPError as exc:
            logger.error("NanoBanana model listing transport error | error=%s", exc)
            if not wrap_errors:
                raise
            raise ExternalAPIException("NanoBanana", str(exc)) from exc

        return extract_nanobanana_model_options(data)
