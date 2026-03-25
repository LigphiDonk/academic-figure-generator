from __future__ import annotations

import httpx
import pytest

from app.services.prompt_ai_service import (
    PromptAIService,
    _parse_prompt_ai_http_response,
    PromptAIConfigLayer,
    extract_prompt_ai_model_options,
    extract_prompt_ai_response_content,
    normalize_prompt_ai_api_url,
    normalize_prompt_ai_models_url,
    normalize_prompt_ai_provider,
    resolve_prompt_ai_settings,
)


def test_normalize_prompt_ai_provider_defaults_to_anthropic() -> None:
    assert normalize_prompt_ai_provider(None) == "anthropic"
    assert normalize_prompt_ai_provider("") == "anthropic"


def test_normalize_prompt_ai_provider_rejects_unknown_value() -> None:
    with pytest.raises(ValueError, match="不支持的 Prompt AI provider"):
        normalize_prompt_ai_provider("unknown")


def test_normalize_prompt_ai_api_url_for_anthropic_base_url() -> None:
    assert (
        normalize_prompt_ai_api_url("anthropic", "https://api.anthropic.com")
        == "https://api.anthropic.com/v1/messages"
    )


def test_normalize_prompt_ai_api_url_for_openai_compatible_base_url() -> None:
    assert (
        normalize_prompt_ai_api_url("openai-compatible", "https://api.openai.com")
        == "https://api.openai.com/v1/chat/completions"
    )


def test_normalize_prompt_ai_models_url_for_anthropic_base_url() -> None:
    assert (
        normalize_prompt_ai_models_url("anthropic", "https://api.anthropic.com")
        == "https://api.anthropic.com/v1/models"
    )


def test_normalize_prompt_ai_models_url_for_openai_compatible_base_url() -> None:
    assert (
        normalize_prompt_ai_models_url("openai-compatible", "https://api.openai.com")
        == "https://api.openai.com/v1/models"
    )


def test_extract_prompt_ai_response_content_for_anthropic() -> None:
    payload = {
        "content": [
            {"type": "text", "text": '[{"title":"A","prompt":"B"}]'},
        ],
        "usage": {"input_tokens": 12, "output_tokens": 34},
    }

    text, input_tokens, output_tokens = extract_prompt_ai_response_content(
        "anthropic", payload
    )

    assert text == '[{"title":"A","prompt":"B"}]'
    assert input_tokens == 12
    assert output_tokens == 34


def test_extract_prompt_ai_response_content_for_openai_compatible() -> None:
    payload = {
        "choices": [
            {
                "message": {
                    "content": [
                        {"type": "text", "text": '[{"title":"A","prompt":"B"}]'},
                    ]
                }
            }
        ],
        "usage": {"prompt_tokens": 21, "completion_tokens": 43},
    }

    text, input_tokens, output_tokens = extract_prompt_ai_response_content(
        "openai-compatible", payload
    )

    assert text == '[{"title":"A","prompt":"B"}]'
    assert input_tokens == 21
    assert output_tokens == 43


def test_extract_prompt_ai_model_options_for_anthropic() -> None:
    payload = {
        "data": [
            {
                "id": "claude-sonnet-4-20250514",
                "display_name": "Claude Sonnet 4",
            }
        ]
    }

    models = extract_prompt_ai_model_options("anthropic", payload)

    assert len(models) == 1
    assert models[0].id == "claude-sonnet-4-20250514"
    assert models[0].display_name == "Claude Sonnet 4"


def test_extract_prompt_ai_model_options_for_openai_compatible() -> None:
    payload = {
        "data": [
            {"id": "gpt-4.1-mini"},
            {"id": "gpt-4.1-mini"},
            {"name": "custom-model"},
        ]
    }

    models = extract_prompt_ai_model_options("openai-compatible", payload)

    assert [model.id for model in models] == ["gpt-4.1-mini", "custom-model"]
    assert [model.display_name for model in models] == [
        "gpt-4.1-mini",
        "custom-model",
    ]


def test_resolve_prompt_ai_settings_prefers_user_layer() -> None:
    resolved = resolve_prompt_ai_settings(
        user_layer=PromptAIConfigLayer(
            provider="openai-compatible",
            api_key="user-key",
            api_base_url="https://user.example.com",
            model="gpt-4.1-mini",
            max_tokens=4096,
        ),
        system_layer=PromptAIConfigLayer(
            provider="anthropic",
            api_key="system-key",
            api_base_url="https://system.example.com",
            model="claude-sonnet-4-20250514",
            max_tokens=8192,
        ),
        env_layer=PromptAIConfigLayer(
            provider="anthropic",
            api_key="env-key",
            api_base_url="https://env.example.com",
            model="claude-env",
            max_tokens=2048,
        ),
    )

    assert resolved.provider == "openai-compatible"
    assert resolved.api_key == "user-key"
    assert resolved.api_base_url == "https://user.example.com"
    assert resolved.model == "gpt-4.1-mini"
    assert resolved.max_tokens == 4096
    assert resolved.key_source == "byok"


def test_resolve_prompt_ai_settings_falls_back_to_system_then_env() -> None:
    resolved = resolve_prompt_ai_settings(
        user_layer=PromptAIConfigLayer(),
        system_layer=PromptAIConfigLayer(
            provider="openai-compatible",
            api_key="system-key",
            api_base_url="https://system.example.com",
            model="gpt-4o-mini",
        ),
        env_layer=PromptAIConfigLayer(
            provider="anthropic",
            api_key="env-key",
            api_base_url="https://env.example.com",
            model="claude-env",
            max_tokens=2048,
        ),
    )

    assert resolved.provider == "openai-compatible"
    assert resolved.api_key == "system-key"
    assert resolved.api_base_url == "https://system.example.com"
    assert resolved.model == "gpt-4o-mini"
    assert resolved.max_tokens == 2048
    assert resolved.key_source == "platform"


def test_build_payload_for_openai_compatible_disables_streaming() -> None:
    service = object.__new__(PromptAIService)
    service.config = resolve_prompt_ai_settings(
        user_layer=PromptAIConfigLayer(
            provider="openai-compatible",
            api_key="test-key",
            api_base_url="https://api.example.com",
            model="grok-4.1-fast",
            max_tokens=256,
        ),
        env_layer=PromptAIConfigLayer(),
    )

    payload = service._build_payload(system_prompt="sys", user_prompt="usr")

    assert payload["stream"] is False


def test_parse_prompt_ai_http_response_supports_openai_sse_chunks() -> None:
    response = httpx.Response(
        200,
        headers={"content-type": "text/event-stream"},
        content=(
            'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'
            'data: {"choices":[{"delta":{"content":" world"}}],'
            '"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\n'
            "data: [DONE]\n"
        ),
        request=httpx.Request("POST", "https://api.example.com/v1/chat/completions"),
    )

    text, input_tokens, output_tokens = _parse_prompt_ai_http_response(
        "openai-compatible", response
    )

    assert text == "hello world"
    assert input_tokens == 12
    assert output_tokens == 3


def test_parse_prompt_ai_http_response_raises_clear_error_for_sse_error_event() -> None:
    response = httpx.Response(
        200,
        headers={"content-type": "text/event-stream"},
        content=(
            'data: {"error":{"message":"AppChatReverse: Chat failed, 403",'
            '"type":"server_error","code":"upstream_error"}}\n\n'
            "data: [DONE]\n"
        ),
        request=httpx.Request("POST", "https://api.example.com/v1/chat/completions"),
    )

    with pytest.raises(ValueError, match="upstream_error"):
        _parse_prompt_ai_http_response("openai-compatible", response)
