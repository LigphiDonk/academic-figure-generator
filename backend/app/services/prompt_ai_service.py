"""通用 Prompt AI 服务，支持 Anthropic 与 OpenAI 兼容协议。"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import get_settings
from app.core.exceptions import ExternalAPIException
from app.core.prompts.system_prompt import ACADEMIC_FIGURE_SYSTEM_PROMPT

logger = logging.getLogger(__name__)

SUPPORTED_PROMPT_AI_PROVIDERS = {"anthropic", "openai-compatible"}
DEFAULT_PROMPT_AI_PROVIDER = "anthropic"
DEFAULT_PROMPT_AI_MAX_TOKENS = 8192
DEFAULT_PROMPT_AI_MODELS = {
    "anthropic": "claude-sonnet-4-20250514",
    "openai-compatible": "gpt-4.1-mini",
}
DEFAULT_PROMPT_AI_BASE_URLS = {
    "anthropic": "https://api.anthropic.com",
    "openai-compatible": "https://api.openai.com",
}


@dataclass(frozen=True)
class PromptAIConfigLayer:
    """单层 Prompt AI 配置。"""

    provider: str | None = None
    api_key: str | None = None
    api_base_url: str | None = None
    model: str | None = None
    max_tokens: int | None = None


@dataclass(frozen=True)
class ResolvedPromptAISettings:
    """合并后的有效 Prompt AI 配置。"""

    provider: str
    api_key: str
    api_base_url: str
    model: str
    max_tokens: int
    key_source: str


@dataclass(frozen=True)
class PromptAIResult:
    """统一的文本模型调用结果。"""

    text: str
    input_tokens: int
    output_tokens: int
    provider: str
    model: str
    api_endpoint: str
    status_code: int
    duration_ms: int


@dataclass(frozen=True)
class PromptAIModelOption:
    """可选模型项。"""

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


def _first_positive_int(*values: int | None) -> int | None:
    for value in values:
        if value is None:
            continue
        if value > 0:
            return value
    return None


def normalize_prompt_ai_provider(value: str | None) -> str:
    """标准化 provider 名称。"""
    normalized = (value or DEFAULT_PROMPT_AI_PROVIDER).strip().lower()
    if not normalized:
        normalized = DEFAULT_PROMPT_AI_PROVIDER
    if normalized not in SUPPORTED_PROMPT_AI_PROVIDERS:
        raise ValueError(f"不支持的 Prompt AI provider: {value}")
    return normalized


def normalize_prompt_ai_base_url(provider: str, base_or_full: str | None) -> str:
    """将基础地址或完整地址规范化为基础 URL。"""
    normalized_provider = normalize_prompt_ai_provider(provider)
    base_url = (base_or_full or DEFAULT_PROMPT_AI_BASE_URLS[normalized_provider]).strip()
    if not base_url:
        base_url = DEFAULT_PROMPT_AI_BASE_URLS[normalized_provider]
    base_url = base_url.rstrip("/")

    if normalized_provider == "anthropic":
        if base_url.endswith("/v1/messages"):
            return base_url[: -len("/v1/messages")]
        if base_url.endswith("/v1/models"):
            return base_url[: -len("/v1/models")]
        return base_url

    if base_url.endswith("/v1/chat/completions"):
        return base_url[: -len("/v1/chat/completions")]
    if base_url.endswith("/v1/models"):
        return base_url[: -len("/v1/models")]
    return base_url


def normalize_prompt_ai_api_url(provider: str, base_or_full: str | None) -> str:
    """将基础地址或完整地址规范化为最终请求端点。"""
    normalized_provider = normalize_prompt_ai_provider(provider)
    base_url = normalize_prompt_ai_base_url(normalized_provider, base_or_full)

    if normalized_provider == "anthropic":
        if base_url.endswith("/v1/messages"):
            return base_url
        return f"{base_url}/v1/messages"

    if base_url.endswith("/v1/chat/completions"):
        return base_url
    return f"{base_url}/v1/chat/completions"


def normalize_prompt_ai_models_url(provider: str, base_or_full: str | None) -> str:
    """将基础地址或完整地址规范化为模型列表端点。"""
    base_url = normalize_prompt_ai_base_url(provider, base_or_full)
    if base_url.endswith("/v1/models"):
        return base_url
    return f"{base_url}/v1/models"


def extract_prompt_ai_response_content(
    provider: str, payload: dict[str, Any]
) -> tuple[str, int, int]:
    """从不同 provider 的响应中抽取文本与 token 使用量。"""
    normalized_provider = normalize_prompt_ai_provider(provider)

    if normalized_provider == "anthropic":
        content_blocks = payload.get("content", [])
        text = "".join(
            block.get("text", "")
            for block in content_blocks
            if isinstance(block, dict) and block.get("type") == "text"
        )
        usage = payload.get("usage") or {}
        return (
            text,
            int(usage.get("input_tokens") or 0),
            int(usage.get("output_tokens") or 0),
        )

    choices = payload.get("choices") or []
    if not choices:
        raise ValueError("OpenAI 兼容响应缺少 choices")

    message = (choices[0] or {}).get("message") or {}
    text = _coerce_openai_text_content(message.get("content", ""))
    if not text and not isinstance(message.get("content", ""), (str, list)):
        raise ValueError("OpenAI 兼容响应中的 message.content 格式不受支持")

    return (text, *_extract_openai_usage(payload.get("usage") or {}))


def _coerce_openai_text_content(content: Any) -> str:
    """统一解析 OpenAI 兼容 content/delta.content 字段。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part.get("text", "")
            for part in content
            if isinstance(part, dict) and (part.get("type") in {None, "text"})
        )
    return ""


def _extract_openai_usage(usage: dict[str, Any]) -> tuple[int, int]:
    """兼容 prompt/completion 与 input/output 两种字段名。"""
    return (
        int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0),
        int(usage.get("completion_tokens") or usage.get("output_tokens") or 0),
    )


def _format_embedded_error(prefix: str, error: dict[str, Any]) -> str:
    """格式化 200 响应体内嵌的上游错误。"""
    message = str(error.get("message") or "未知错误").strip()
    extras: list[str] = []
    if error.get("code"):
        extras.append(f"code={error['code']}")
    if error.get("type"):
        extras.append(f"type={error['type']}")
    suffix = f" ({', '.join(extras)})" if extras else ""
    return f"{prefix}: {message}{suffix}"


def _parse_openai_sse_events(raw_text: str) -> list[dict[str, Any]]:
    """解析 OpenAI 兼容 SSE 响应中的 data 事件。"""
    events: list[dict[str, Any]] = []
    for line in raw_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(":"):
            continue
        if not stripped.startswith("data:"):
            continue

        payload = stripped[5:].strip()
        if not payload:
            continue
        if payload == "[DONE]":
            break

        event = json.loads(payload)
        if isinstance(event, dict):
            events.append(event)

    if not events:
        raise ValueError("OpenAI 兼容 SSE 响应中没有可解析的 data 事件")
    return events


def _parse_prompt_ai_http_response(
    provider: str, response: httpx.Response
) -> tuple[str, int, int]:
    """按 provider 与 content-type 解析 HTTP 响应体。"""
    normalized_provider = normalize_prompt_ai_provider(provider)
    content_type = (response.headers.get("content-type") or "").lower()
    raw_text = response.text

    if normalized_provider == "openai-compatible" and (
        "text/event-stream" in content_type or raw_text.lstrip().startswith("data:")
    ):
        events = _parse_openai_sse_events(raw_text)
        text_parts: list[str] = []
        input_tokens = 0
        output_tokens = 0

        for event in events:
            error = event.get("error")
            if isinstance(error, dict):
                raise ValueError(
                    _format_embedded_error("OpenAI 兼容 SSE 响应返回错误", error)
                )

            choices = event.get("choices") or []
            for choice in choices:
                if not isinstance(choice, dict):
                    continue
                delta = choice.get("delta")
                if isinstance(delta, dict):
                    text_parts.append(_coerce_openai_text_content(delta.get("content", "")))
                message = choice.get("message")
                if isinstance(message, dict):
                    text_parts.append(
                        _coerce_openai_text_content(message.get("content", ""))
                    )

            next_input_tokens, next_output_tokens = _extract_openai_usage(
                event.get("usage") or {}
            )
            if next_input_tokens:
                input_tokens = next_input_tokens
            if next_output_tokens:
                output_tokens = next_output_tokens

        return "".join(text_parts), input_tokens, output_tokens

    data = response.json()
    if isinstance(data, dict) and isinstance(data.get("error"), dict):
        raise ValueError(
            _format_embedded_error("Prompt AI 响应返回错误", data["error"])
        )

    return extract_prompt_ai_response_content(normalized_provider, data)


def extract_prompt_ai_model_options(
    provider: str, payload: dict[str, Any]
) -> list[PromptAIModelOption]:
    """从模型列表响应中提取统一结构。"""
    normalize_prompt_ai_provider(provider)

    raw_models = payload.get("data")
    if not isinstance(raw_models, list):
        raw_models = payload.get("models")
    if not isinstance(raw_models, list):
        raise ValueError("模型列表响应缺少 data/models 数组")

    options: list[PromptAIModelOption] = []
    seen_ids: set[str] = set()
    for item in raw_models:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get("id") or item.get("name") or "").strip()
        if not model_id or model_id in seen_ids:
            continue
        display_name = str(
            item.get("display_name") or item.get("name") or model_id
        ).strip() or model_id
        seen_ids.add(model_id)
        options.append(PromptAIModelOption(id=model_id, display_name=display_name))
    return options


def get_env_prompt_ai_config_layer() -> PromptAIConfigLayer:
    """读取环境变量中的 Prompt AI 配置层。"""
    settings = get_settings()
    return PromptAIConfigLayer(
        provider=settings.PROMPT_AI_PROVIDER,
        api_key=settings.PROMPT_AI_API_KEY,
        api_base_url=settings.PROMPT_AI_API_BASE_URL,
        model=settings.PROMPT_AI_MODEL,
        max_tokens=settings.PROMPT_AI_MAX_TOKENS,
    )


def resolve_prompt_ai_settings(
    *,
    user_layer: PromptAIConfigLayer | None = None,
    system_layer: PromptAIConfigLayer | None = None,
    env_layer: PromptAIConfigLayer | None = None,
) -> ResolvedPromptAISettings:
    """按优先级合并 Prompt AI 配置。"""
    user = user_layer or PromptAIConfigLayer()
    system = system_layer or PromptAIConfigLayer()
    env = env_layer or PromptAIConfigLayer()

    provider = normalize_prompt_ai_provider(
        _first_non_blank(user.provider, system.provider, env.provider)
    )
    api_key = _first_non_blank(user.api_key, system.api_key, env.api_key) or ""
    api_base_url = _first_non_blank(
        user.api_base_url,
        system.api_base_url,
        env.api_base_url,
    ) or DEFAULT_PROMPT_AI_BASE_URLS[provider]
    model = _first_non_blank(user.model, system.model, env.model) or DEFAULT_PROMPT_AI_MODELS[
        provider
    ]
    max_tokens = _first_positive_int(user.max_tokens, system.max_tokens, env.max_tokens)
    if max_tokens is None:
        max_tokens = DEFAULT_PROMPT_AI_MAX_TOKENS

    if _first_non_blank(user.api_key):
        key_source = "byok"
    elif _first_non_blank(system.api_key):
        key_source = "platform"
    elif _first_non_blank(env.api_key):
        key_source = "platform"
    else:
        key_source = "platform"

    return ResolvedPromptAISettings(
        provider=provider,
        api_key=api_key,
        api_base_url=api_base_url,
        model=model,
        max_tokens=max_tokens,
        key_source=key_source,
    )


class PromptAIService:
    """通用 Prompt AI 文本生成服务。"""

    def __init__(
        self,
        *,
        provider: str | None = None,
        api_key: str | None = None,
        api_base_url: str | None = None,
        model: str | None = None,
        max_tokens: int | None = None,
    ) -> None:
        resolved = resolve_prompt_ai_settings(
            user_layer=PromptAIConfigLayer(
                provider=provider,
                api_key=api_key,
                api_base_url=api_base_url,
                model=model,
                max_tokens=max_tokens,
            ),
            env_layer=get_env_prompt_ai_config_layer(),
        )
        if not resolved.api_key:
            raise ExternalAPIException(
                "PromptAI",
                "No API key configured. Configure BYOK or platform Prompt AI key.",
            )

        self.config = resolved
        self.api_url = normalize_prompt_ai_api_url(
            resolved.provider, resolved.api_base_url
        )
        self.models_url = normalize_prompt_ai_models_url(
            resolved.provider, resolved.api_base_url
        )

    def generate_completion(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        timeout: float = 120.0,
        wrap_errors: bool = True,
    ) -> PromptAIResult:
        """调用底层文本模型并返回统一结构。"""
        start_time = time.monotonic()
        response: httpx.Response | None = None
        try:
            with httpx.Client(timeout=timeout) as client:
                response = client.post(
                    self.api_url,
                    headers=self._build_headers(),
                    json=self._build_payload(
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                    ),
                )
                duration_ms = int((time.monotonic() - start_time) * 1000)
                response.raise_for_status()
                text, input_tokens, output_tokens = _parse_prompt_ai_http_response(
                    self.config.provider, response
                )
        except httpx.TimeoutException as exc:
            duration_ms = int((time.monotonic() - start_time) * 1000)
            logger.error(
                "Prompt AI timeout | provider=%s duration_ms=%d error=%s",
                self.config.provider,
                duration_ms,
                exc,
            )
            if not wrap_errors:
                raise
            raise ExternalAPIException(
                "PromptAI",
                f"{self.config.provider} request timed out after {duration_ms}ms",
            ) from exc
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:500]
            logger.error(
                "Prompt AI HTTP error | provider=%s status=%d detail=%s",
                self.config.provider,
                exc.response.status_code,
                detail,
            )
            if not wrap_errors:
                raise
            raise ExternalAPIException(
                "PromptAI",
                f"{self.config.provider} HTTP {exc.response.status_code}: {detail}",
            ) from exc
        except httpx.HTTPError as exc:
            logger.error(
                "Prompt AI transport error | provider=%s error=%s",
                self.config.provider,
                exc,
            )
            if not wrap_errors:
                raise
            raise ExternalAPIException("PromptAI", str(exc)) from exc
        except ValueError as exc:
            duration_ms = int((time.monotonic() - start_time) * 1000)
            content_type = response.headers.get("content-type") if response else None
            body_preview = (
                response.text[:500].replace("\n", " ") if response is not None else ""
            )
            logger.error(
                "Prompt AI parse error | provider=%s status=%s content_type=%s duration_ms=%d detail=%s body=%s",
                self.config.provider,
                response.status_code if response is not None else None,
                content_type,
                duration_ms,
                exc,
                body_preview,
            )
            if not wrap_errors:
                raise
            raise ExternalAPIException("PromptAI", str(exc)) from exc

        return PromptAIResult(
            text=text,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            provider=self.config.provider,
            model=self.config.model,
            api_endpoint=self.api_url,
            status_code=int(response.status_code),
            duration_ms=duration_ms,
        )

    async def list_models(
        self,
        *,
        timeout: float = 30.0,
        wrap_errors: bool = True,
    ) -> list[PromptAIModelOption]:
        """拉取当前 provider 可用的模型列表。"""
        start_time = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.get(
                    self.models_url,
                    headers=self._build_headers(),
                )
                duration_ms = int((time.monotonic() - start_time) * 1000)
                response.raise_for_status()
                data = response.json()
        except httpx.TimeoutException as exc:
            duration_ms = int((time.monotonic() - start_time) * 1000)
            logger.error(
                "Prompt AI model listing timeout | provider=%s duration_ms=%d error=%s",
                self.config.provider,
                duration_ms,
                exc,
            )
            if not wrap_errors:
                raise
            raise ExternalAPIException(
                "PromptAI",
                f"{self.config.provider} models request timed out after {duration_ms}ms",
            ) from exc
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:500]
            logger.error(
                "Prompt AI model listing HTTP error | provider=%s status=%d detail=%s",
                self.config.provider,
                exc.response.status_code,
                detail,
            )
            if not wrap_errors:
                raise
            raise ExternalAPIException(
                "PromptAI",
                f"{self.config.provider} models HTTP {exc.response.status_code}: {detail}",
            ) from exc
        except httpx.HTTPError as exc:
            logger.error(
                "Prompt AI model listing transport error | provider=%s error=%s",
                self.config.provider,
                exc,
            )
            if not wrap_errors:
                raise
            raise ExternalAPIException("PromptAI", str(exc)) from exc

        return extract_prompt_ai_model_options(self.config.provider, data)

    def generate_figure_prompts(
        self,
        sections: list[dict],
        color_scheme: dict,
        paper_field: str | None = None,
    ) -> dict[str, Any]:
        """兼容旧服务接口，用于直接生成 figure prompt。"""
        user_message = self._build_user_message(sections, color_scheme, paper_field)
        result = self.generate_completion(
            system_prompt=ACADEMIC_FIGURE_SYSTEM_PROMPT,
            user_prompt=user_message,
        )
        figures = self._parse_figures_response(result.text)
        return {
            "figures": figures,
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
            "model": result.model,
            "provider": result.provider,
            "duration_ms": result.duration_ms,
        }

    def _build_headers(self) -> dict[str, str]:
        if self.config.provider == "anthropic":
            return {
                "x-api-key": self.config.api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
        return {
            "Authorization": f"Bearer {self.config.api_key}",
            "content-type": "application/json",
        }

    def _build_payload(self, *, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        if self.config.provider == "anthropic":
            return {
                "model": self.config.model,
                "max_tokens": self.config.max_tokens,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
            }
        return {
            "model": self.config.model,
            "stream": False,
            "max_tokens": self.config.max_tokens,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }

    def _build_user_message(
        self,
        sections: list[dict],
        color_scheme: dict,
        paper_field: str | None,
    ) -> str:
        parts: list[str] = []
        if paper_field:
            parts.append(f"**Academic Field:** {paper_field}\n")

        parts.append("**Color Palette to Use:**")
        for color_key, color_value in color_scheme.items():
            parts.append(f"  - {color_key}: {color_value}")
        parts.append("")

        parts.append("**Paper Content (organized by section):**\n")
        for i, section in enumerate(sections, 1):
            title = section.get("title", f"Section {i}")
            level = section.get("level", 1)
            content = section.get("content", "")
            if len(content) > 8000:
                content = content[:8000] + "\n[... section truncated ...]"
            heading_prefix = "#" * min(level + 1, 4)
            parts.append(f"{heading_prefix} {title}")
            parts.append(content)
            parts.append("")

        parts.append(
            "---\n"
            "Based on the paper content above, generate a comprehensive set of "
            "academic figures. For each figure, provide a detailed image-generation "
            "prompt that incorporates the specified color palette. Return ONLY a "
            "JSON array of figure objects."
        )
        return "\n".join(parts)

    def _parse_figures_response(self, text: str) -> list[dict[str, Any]]:
        if not text or not text.strip():
            logger.warning("Prompt AI 返回空文本")
            return []

        cleaned = text.strip()
        if cleaned.startswith("```"):
            first_newline = cleaned.index("\n") if "\n" in cleaned else len(cleaned)
            cleaned = cleaned[first_newline + 1 :]
            if cleaned.rstrip().endswith("```"):
                cleaned = cleaned.rstrip()[:-3].rstrip()

        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, list):
                return self._validate_figures(parsed)
        except json.JSONDecodeError:
            pass

        match = re.search(r"\[[\s\S]*\]", cleaned)
        if match:
            try:
                parsed = json.loads(match.group())
                if isinstance(parsed, list):
                    return self._validate_figures(parsed)
            except json.JSONDecodeError:
                pass

        logger.warning("无法从 Prompt AI 响应中解析 figure JSON")
        return []

    @staticmethod
    def _validate_figures(figures: list[Any]) -> list[dict[str, Any]]:
        valid: list[dict[str, Any]] = []
        for index, fig in enumerate(figures):
            if not isinstance(fig, dict):
                continue
            validated = {
                "figure_number": fig.get("figure_number", index + 1),
                "title": fig.get("title", f"Figure {index + 1}"),
                "suggested_figure_type": fig.get(
                    "suggested_figure_type", "diagram"
                ),
                "suggested_aspect_ratio": fig.get("suggested_aspect_ratio", "16:9"),
                "prompt": fig.get("prompt", ""),
                "source_section_titles": fig.get("source_section_titles", []),
                "rationale": fig.get("rationale", ""),
            }
            if validated["prompt"]:
                valid.append(validated)
        return valid
