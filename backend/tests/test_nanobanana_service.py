from __future__ import annotations

from app.services.nanobanana_service import (
    NanoBananaConfigLayer,
    extract_nanobanana_model_options,
    normalize_nanobanana_base_url,
    normalize_nanobanana_models_url,
    resolve_nanobanana_settings,
)


def test_normalize_nanobanana_base_url_strips_models_endpoint() -> None:
    assert (
        normalize_nanobanana_base_url("https://api.keepgo.icu/v1beta/models")
        == "https://api.keepgo.icu"
    )
    assert (
        normalize_nanobanana_base_url(
            "https://api.keepgo.icu/v1beta/models/gemini-3-pro-image-preview:generateContent"
        )
        == "https://api.keepgo.icu"
    )


def test_normalize_nanobanana_models_url_appends_list_endpoint() -> None:
    assert (
        normalize_nanobanana_models_url("https://api.keepgo.icu")
        == "https://api.keepgo.icu/v1beta/models"
    )


def test_extract_nanobanana_model_options_supports_gemini_shape() -> None:
    payload = {
        "models": [
            {
                "name": "models/gemini-3-pro-image-preview",
                "displayName": "Gemini 3 Pro Image Preview",
            }
        ]
    }

    models = extract_nanobanana_model_options(payload)

    assert len(models) == 1
    assert models[0].id == "gemini-3-pro-image-preview"
    assert models[0].display_name == "Gemini 3 Pro Image Preview"


def test_resolve_nanobanana_settings_prefers_user_then_system_then_env() -> None:
    resolved = resolve_nanobanana_settings(
        user_layer=NanoBananaConfigLayer(
            api_key="user-key",
            api_base_url="https://user.example.com",
            model="user-model",
        ),
        system_layer=NanoBananaConfigLayer(
            api_key="system-key",
            api_base_url="https://system.example.com",
            model="system-model",
        ),
        env_layer=NanoBananaConfigLayer(
            api_key="env-key",
            api_base_url="https://env.example.com",
            model="env-model",
        ),
    )

    assert resolved.api_key == "user-key"
    assert resolved.api_base_url == "https://user.example.com"
    assert resolved.model == "user-model"
    assert resolved.key_source == "byok"
