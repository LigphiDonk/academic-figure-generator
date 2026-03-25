"""
Celery tasks: parse uploaded documents and generate figure prompts via Prompt AI.

Flow (generate_prompts_task):
  1. Load document sections from the Document.sections JSONB field (sync session).
  2. Build Prompt AI request using the academic-figure system prompt.
  3. Call Prompt AI via synchronous httpx client.
  4. Parse the JSON array response into individual Prompt records.
  5. Persist Prompt rows (table: prompts).

Flow (parse_document_task):
  1. Load document record from DB (storage_path, file_type).
  2. Download raw file bytes from MinIO via StorageService.
  3. Parse content using DocumentService.parse().
  4. Update document row with full_text, sections, page_count, parse_status.

Retry policy: up to 2 retries with exponential back-off on transient errors.
Soft time limit: 240 s (raises SoftTimeLimitExceeded for graceful cleanup).
Hard time limit: 300 s (SIGKILL).

Schema reference (from app/models/):
  documents:  id, parse_status, parse_error, sections (JSONB), full_text,
              page_count, storage_path, file_type, updated_at
  prompts:    id, project_id, document_id, user_id, figure_number, title,
              original_prompt, suggested_figure_type, suggested_aspect_ratio,
              generation_status, generator_model, created_at, updated_at
"""

from __future__ import annotations

import json
import logging
import os
import traceback
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import httpx
from celery import Task
from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.billing import compute_prompt_ai_cost_usd, usd_to_cny
from app.core.prompts.color_schemes import PRESET_COLOR_SCHEMES, OKABE_ITO
from app.core.prompts.figure_types import FIGURE_TYPES
from app.core.prompts.system_prompt import ACADEMIC_FIGURE_SYSTEM_PROMPT, TEMPLATE_FIGURE_SYSTEM_PROMPT
from app.core.security import decrypt_api_key
from app.services.prompt_ai_service import (
    PromptAIConfigLayer,
    PromptAIService,
    resolve_prompt_ai_settings,
)
from app.tasks.celery_app import celery_app
from app.tasks.db import _get_session

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompt AI helpers
# ---------------------------------------------------------------------------

PROMPT_AI_PROVIDER: str = os.environ.get("PROMPT_AI_PROVIDER", "anthropic")
PROMPT_AI_API_KEY: str = os.environ.get("PROMPT_AI_API_KEY", "")
PROMPT_AI_API_BASE_URL: str = os.environ.get("PROMPT_AI_API_BASE_URL", "")
PROMPT_AI_MODEL: str = os.environ.get("PROMPT_AI_MODEL", "claude-sonnet-4-20250514")
PROMPT_AI_MAX_TOKENS: int = int(os.environ.get("PROMPT_AI_MAX_TOKENS", "8192"))


def _build_user_prompt(
    sections: list[dict[str, Any]],
    color_scheme: dict[str, str],
    figure_types: list[str] | None,
    user_request: str | None,
    max_figures: int | None,
) -> str:
    """Construct the user-facing message sent to Prompt AI."""
    type_hint = ""
    if figure_types:
        type_descriptions = [
            f"- {ft}: {FIGURE_TYPES[ft]['description']}"
            for ft in figure_types
            if ft in FIGURE_TYPES
        ]
        type_hint = (
            "\n\nPreferred figure types for this paper:\n"
            + "\n".join(type_descriptions)
        )

    color_block = json.dumps(color_scheme, indent=2)

    section_text = "\n\n".join(
        f"## Section {i + 1}: {s.get('title', 'Untitled')}\n{s.get('content', s.get('text', ''))}"
        for i, s in enumerate(sections)
    )

    request_block = ""
    if user_request and user_request.strip():
        request_block = (
            "\n\nUser requested figures (highest priority):\n"
            f"{user_request.strip()}\n"
        )

    count_hint = ""
    if max_figures is not None and max_figures > 0:
        count_hint = f"Generate at most {max_figures} figure prompt(s). "

    return (
        f"Color palette to use (map exactly to the roles described in the system prompt):\n"
        f"```json\n{color_block}\n```"
        f"{type_hint}\n\n"
        f"{request_block}\n"
        f"--- PAPER SECTIONS ---\n\n"
        f"{section_text}\n\n"
        f"--- END OF PAPER ---\n\n"
        f"{count_hint}"
        f"Generate figure prompts that best match the user's request and the paper. "
        f"If no explicit user request is provided, generate one figure prompt per major section above. "
        f"Never include rulers, margin guides, or any visible measurement text like '16px', '0.5pt', or '75%'. "
        f"Return ONLY valid JSON array as specified in the system prompt. "
        f"Each prompt field must be at least 500 words and extremely precise."
    )


def _build_template_user_prompt(
    color_scheme: dict[str, str],
    figure_types: list[str] | None,
    max_figures: int | None,
) -> str:
    """Construct the user message for template (text-free) mode."""
    color_block = json.dumps(color_scheme, indent=2)

    count_hint = ""
    if max_figures is not None and max_figures > 0:
        count_hint = f"Generate exactly {max_figures} template figure(s). "
    else:
        count_hint = "Generate 1 template figure. "

    type_hint = ""
    if figure_types:
        type_descriptions = [
            f"- {ft}: {FIGURE_TYPES[ft]['description']}"
            for ft in figure_types
            if ft in FIGURE_TYPES
        ]
        if type_descriptions:
            type_hint = (
                "\n\nUse these figure types:\n"
                + "\n".join(type_descriptions)
            )

    return (
        f"Color palette to use (map exactly to the roles described in the system prompt):\n"
        f"```json\n{color_block}\n```"
        f"{type_hint}\n\n"
        f"{count_hint}"
        f"Generate purely structural, text-free layout template(s). "
        f"Do NOT include any text, labels, annotations, numbers, or symbols of any kind. "
        f"Every element must be a shape, line, or arrow only. "
        f"Return ONLY valid JSON array as specified in the system prompt."
    )


def _escape_control_chars_inside_json_strings(raw_text: str) -> str:
    """仅修复 JSON 字符串值内部的未转义控制字符。"""
    repaired: list[str] = []
    in_string = False
    escaping = False
    changed = False

    for char in raw_text:
        if in_string:
            if escaping:
                repaired.append(char)
                escaping = False
                continue

            if char == "\\":
                repaired.append(char)
                escaping = True
                continue

            if char == '"':
                repaired.append(char)
                in_string = False
                continue

            if char == "\n":
                repaired.append("\\n")
                changed = True
                continue
            if char == "\r":
                repaired.append("\\r")
                changed = True
                continue
            if char == "\t":
                repaired.append("\\t")
                changed = True
                continue
            if ord(char) < 0x20:
                repaired.append(f"\\u{ord(char):04x}")
                changed = True
                continue
        else:
            if char == '"':
                in_string = True

        repaired.append(char)

    if not changed:
        return raw_text
    return "".join(repaired)


def _parse_figure_prompts(raw_text: str) -> list[dict[str, Any]]:
    """
    Extract the JSON array from Prompt AI response text.

    Prompt AI providers sometimes wrap JSON in markdown code fences; strip them.
    """
    text = raw_text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        inner_lines = lines[1:]
        if inner_lines and inner_lines[-1].strip() == "```":
            inner_lines = inner_lines[:-1]
        text = "\n".join(inner_lines).strip()

    try:
        figures = json.loads(text)
    except json.JSONDecodeError:
        repaired_text = _escape_control_chars_inside_json_strings(text)
        if repaired_text == text:
            raise
        logger.warning("Repairing Prompt AI figure JSON with escaped control characters")
        figures = json.loads(repaired_text)

    if not isinstance(figures, list):
        raise ValueError(f"Expected JSON array from Prompt AI, got {type(figures)}")
    return figures


def _get_system_prompt_ai_settings(
    db: Session,
) -> tuple[str | None, str | None, str | None, str | None]:
    """Fetch system Prompt AI settings (provider + encrypted key + base URL + model)."""
    row = db.execute(
        text(
            "SELECT prompt_ai_provider, prompt_ai_api_key_enc, prompt_ai_api_base_url, prompt_ai_model "
            "FROM system_settings WHERE id = 1"
        )
    ).fetchone()
    if not row:
        return None, None, None, None
    return row[0], row[1], row[2], row[3]

def _get_pricing(db: Session) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    """Fetch pricing from system_settings with safe defaults.

    Returns: (usd_cny_rate, image_price_cny, prompt_ai_in_usd_per_m, prompt_ai_out_usd_per_m)
    """
    row = db.execute(
        text(
            "SELECT usd_cny_rate, image_price_cny, prompt_ai_input_usd_per_million, prompt_ai_output_usd_per_million "
            "FROM system_settings WHERE id = 1"
        )
    ).fetchone()
    if not row:
        return Decimal("7.2"), Decimal("1.5"), Decimal("3.0"), Decimal("15.0")
    usd_cny_rate = Decimal(str(row[0] if row[0] is not None else "7.2"))
    image_price_cny = Decimal(str(row[1] if row[1] is not None else "1.5"))
    prompt_ai_in = Decimal(str(row[2] if row[2] is not None else "3.0"))
    prompt_ai_out = Decimal(str(row[3] if row[3] is not None else "15.0"))
    return usd_cny_rate, image_price_cny, prompt_ai_in, prompt_ai_out


def _current_billing_period() -> str:
    return datetime.utcnow().strftime("%Y-%m")


def _log_prompt_ai_usage(
    db: Session,
    *,
    user_id: str,
    project_id: str,
    provider: str,
    api_endpoint: str,
    model: str,
    key_source: str,
    billing_period: str,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    request_duration_ms: int | None = None,
    status_code: int | None = None,
    is_success: bool,
    error_message: str | None = None,
    estimated_cost_usd: Decimal | None = None,
    estimated_cost_cny: Decimal | None = None,
) -> None:
    """Best-effort usage log entry for Prompt AI."""
    try:
        db.execute(
            text(
                """
                INSERT INTO usage_logs (
                    id, user_id, project_id,
                    api_name, provider, api_endpoint,
                    input_tokens, output_tokens,
                    model, request_duration_ms,
                    key_source, is_success, status_code, error_message,
                    estimated_cost_usd, estimated_cost_cny,
                    billing_period, created_at
                ) VALUES (
                    :id, :user_id, :project_id,
                    'prompt_ai', :provider, :api_endpoint,
                    :input_tokens, :output_tokens,
                    :model, :request_duration_ms,
                    :key_source, :is_success, :status_code, :error_message,
                    :estimated_cost_usd, :estimated_cost_cny,
                    :billing_period, :now
                )
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "project_id": project_id,
                "provider": provider,
                "api_endpoint": api_endpoint[:200] if api_endpoint else None,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "model": model,
                "request_duration_ms": request_duration_ms,
                "key_source": key_source,
                "is_success": is_success,
                "status_code": status_code,
                "error_message": (error_message or "")[:2000] if error_message else None,
                "estimated_cost_usd": estimated_cost_usd,
                "estimated_cost_cny": estimated_cost_cny,
                "billing_period": billing_period,
                "now": datetime.now(UTC),
            },
        )
    except Exception:
        logger.exception("Failed to log Prompt AI usage")


# ---------------------------------------------------------------------------
# Celery task: parse_document_task
# ---------------------------------------------------------------------------

@celery_app.task(
    bind=True,
    queue="default",
    max_retries=1,
    soft_time_limit=100,
    time_limit=120,
    name="app.tasks.prompt_tasks.parse_document_task",
)
def parse_document_task(self: Task, document_id: str) -> dict[str, Any]:
    """
    Parse an uploaded document and store the extracted sections in the DB.

    Args:
        document_id: UUID of the Document record to process.

    Returns:
        dict with keys: document_id, page_count, section_count.
    """
    logger.info("parse_document_task started | document_id=%s", document_id)

    db: Session = _get_session()

    try:
        # ------------------------------------------------------------------
        # 1. Mark document as parsing
        # ------------------------------------------------------------------
        db.execute(
            text(
                "UPDATE documents SET parse_status = 'parsing', "
                "updated_at = :now WHERE id = :doc_id"
            ),
            {"now": datetime.now(UTC), "doc_id": document_id},
        )
        db.commit()

        # ------------------------------------------------------------------
        # 2. Load document record
        # ------------------------------------------------------------------
        row = db.execute(
            text(
                "SELECT storage_path, file_type FROM documents WHERE id = :doc_id"
            ),
            {"doc_id": document_id},
        ).fetchone()

        if not row:
            raise ValueError(f"Document not found: document_id={document_id}")

        storage_path = row[0]
        file_type = row[1]

        # ------------------------------------------------------------------
        # 3. Download raw file from MinIO
        # ------------------------------------------------------------------
        from app.services.storage_service import StorageService

        storage = StorageService()
        file_bytes = storage.download_file(storage_path)
        logger.info(
            "Downloaded document from MinIO | storage_path=%s size=%d",
            storage_path, len(file_bytes),
        )

        # ------------------------------------------------------------------
        # 4. Parse document
        # ------------------------------------------------------------------
        from app.services.document_service import DocumentService

        doc_service = DocumentService()
        parse_result = doc_service.parse(file_bytes, file_type)

        full_text = parse_result.get("full_text", "")
        sections = parse_result.get("sections", [])
        page_count = parse_result.get("page_count")

        logger.info(
            "Parsed document | document_id=%s sections=%d page_count=%s",
            document_id, len(sections), page_count,
        )

        # ------------------------------------------------------------------
        # 5. Update document record
        # ------------------------------------------------------------------
        import json as _json

        now = datetime.now(UTC)
        db.execute(
            text(
                """
                UPDATE documents SET
                    full_text = :full_text,
                    sections = :sections,
                    page_count = :page_count,
                    parse_status = 'completed',
                    parse_error = NULL,
                    updated_at = :now
                WHERE id = :doc_id
                """
            ),
            {
                "full_text": full_text,
                "sections": _json.dumps(sections),
                "page_count": page_count,
                "now": now,
                "doc_id": document_id,
            },
        )
        db.commit()

        result = {
            "document_id": document_id,
            "page_count": page_count,
            "section_count": len(sections),
        }
        logger.info(
            "parse_document_task completed | document_id=%s sections=%d",
            document_id, len(sections),
        )
        return result

    except Exception as exc:
        logger.error(
            "Error in parse_document_task | document_id=%s\n%s",
            document_id, traceback.format_exc(),
        )
        try:
            db.execute(
                text(
                    "UPDATE documents SET parse_status = 'failed', "
                    "parse_error = :reason, updated_at = :now WHERE id = :doc_id"
                ),
                {
                    "reason": str(exc)[:2000],
                    "now": datetime.now(UTC),
                    "doc_id": document_id,
                },
            )
            db.commit()
        except Exception:
            logger.exception(
                "Failed to mark document as failed | document_id=%s", document_id
            )
        raise

    finally:
        db.close()


# ---------------------------------------------------------------------------
# Celery task: generate_prompts_task
# ---------------------------------------------------------------------------

@celery_app.task(
    bind=True,
    queue="prompts",
    max_retries=2,
    soft_time_limit=240,
    time_limit=300,
    name="app.tasks.prompt_tasks.generate_prompts_task",
)
def generate_prompts_task(
    self: Task,
    project_id: str,
    document_id: str,
    user_id: str,
    color_scheme: str,
    custom_colors: dict | None,
    figure_types: list[str] | None,
    section_indices: list[int] | None = None,
    user_request: str | None = None,
    max_figures: int | None = None,
    template_mode: bool = False,
) -> dict[str, Any]:
    """
    Generate AI figure prompts from an uploaded academic document.

    Args:
        project_id:      UUID of the parent project.
        document_id:     UUID of the Document record to process.
        user_id:         UUID of the requesting user (for BYOK key lookup).
        color_scheme:    Name of the preset color scheme (e.g. "okabe_ito").
        custom_colors:   Optional dict of custom hex colors overriding the preset.
        figure_types:    Optional list of preferred figure type slugs.
        section_indices: Optional list of section indices to process (0-based).
                         When provided, only those sections are sent to Prompt AI.

    Returns:
        dict with keys: document_id, prompt_ids, figure_count.
    """
    logger.info(
        "generate_prompts_task started | document_id=%s project_id=%s user_id=%s",
        document_id, project_id, user_id,
    )

    db: Session = _get_session()

    try:
        # ------------------------------------------------------------------
        # 2. Load document sections from JSONB column
        # ------------------------------------------------------------------
        row = db.execute(
            text("SELECT sections FROM documents WHERE id = :doc_id"),
            {"doc_id": document_id},
        ).fetchone()

        if not row:
            raise ValueError(f"Document not found: document_id={document_id}")

        raw_sections = row.sections
        if not raw_sections:
            raise ValueError(
                f"Document has no parsed sections (document_id={document_id}). "
                "Ensure document parsing completed before triggering prompt generation."
            )

        # sections is stored as JSONB; may be a list or dict with a 'sections' key
        if isinstance(raw_sections, list):
            sections = raw_sections
        elif isinstance(raw_sections, dict):
            sections = raw_sections.get("sections", list(raw_sections.values()))
        else:
            raise ValueError(f"Unexpected sections format: {type(raw_sections)}")

        if not sections:
            raise ValueError(f"Empty sections list for document_id={document_id}")

        # ------------------------------------------------------------------
        # 2a. Filter by section_indices if provided
        # ------------------------------------------------------------------
        if section_indices is not None:
            total_sections = len(sections)
            sections = [
                sections[i] for i in section_indices if 0 <= i < total_sections
            ]
            if not sections:
                raise ValueError(
                    f"section_indices {section_indices} produced no valid sections "
                    f"(document has {total_sections} sections)"
                )
            logger.info(
                "Filtered to %d sections via section_indices=%s",
                len(sections), section_indices,
            )

        logger.info("Loaded %d sections for document_id=%s", len(sections), document_id)

        # ------------------------------------------------------------------
        # 3. Resolve color scheme
        # ------------------------------------------------------------------
        base_colors: dict[str, str] = PRESET_COLOR_SCHEMES.get(
            color_scheme, OKABE_ITO
        ).copy()
        if custom_colors:
            base_colors.update(custom_colors)

        # ------------------------------------------------------------------
        # 4. Resolve Prompt AI settings (user > system > env)
        # ------------------------------------------------------------------
        (
            system_provider,
            system_key_enc,
            system_api_base_url,
            system_model,
        ) = _get_system_prompt_ai_settings(db)
        billing_period = _current_billing_period()
        (
            usd_cny_rate,
            _image_price_cny,
            prompt_ai_in_usd_per_m,
            prompt_ai_out_usd_per_m,
        ) = _get_pricing(db)

        result = db.execute(
            text(
                "SELECT prompt_ai_provider, prompt_ai_api_key_enc, "
                "prompt_ai_api_base_url, prompt_ai_model "
                "FROM users WHERE id = :uid"
            ),
            {"uid": user_id},
        )
        byok_row = result.fetchone()
        user_provider = byok_row[0] if byok_row else None
        user_key_enc = byok_row[1] if byok_row else None
        user_api_base_url = byok_row[2] if byok_row else None
        user_model = byok_row[3] if byok_row else None

        resolved_settings = resolve_prompt_ai_settings(
            user_layer=PromptAIConfigLayer(
                provider=user_provider,
                api_key=decrypt_api_key(user_key_enc) if user_key_enc else None,
                api_base_url=user_api_base_url,
                model=user_model,
                max_tokens=PROMPT_AI_MAX_TOKENS,
            ),
            system_layer=PromptAIConfigLayer(
                provider=system_provider,
                api_key=decrypt_api_key(system_key_enc) if system_key_enc else None,
                api_base_url=system_api_base_url,
                model=system_model,
                max_tokens=PROMPT_AI_MAX_TOKENS,
            ),
            env_layer=PromptAIConfigLayer(
                provider=PROMPT_AI_PROVIDER,
                api_key=PROMPT_AI_API_KEY,
                api_base_url=PROMPT_AI_API_BASE_URL,
                model=PROMPT_AI_MODEL,
                max_tokens=PROMPT_AI_MAX_TOKENS,
            ),
        )
        if not resolved_settings.api_key:
            raise ValueError(
                "No Prompt AI API key available: set PROMPT_AI_API_KEY env var, "
                "or configure system key in admin settings, "
                "or add a BYOK key for this user."
            )
        prompt_ai_service = PromptAIService(
            provider=resolved_settings.provider,
            api_key=resolved_settings.api_key,
            api_base_url=resolved_settings.api_base_url,
            model=resolved_settings.model,
            max_tokens=resolved_settings.max_tokens,
        )
        effective_provider = prompt_ai_service.config.provider
        effective_api_url = prompt_ai_service.api_url
        effective_model = prompt_ai_service.config.model
        effective_max_tokens = prompt_ai_service.config.max_tokens
        key_source = resolved_settings.key_source

        # ------------------------------------------------------------------
        # 5. Build and send Prompt AI request
        # ------------------------------------------------------------------
        if template_mode:
            user_prompt = _build_template_user_prompt(
                color_scheme=base_colors,
                figure_types=figure_types,
                max_figures=max_figures,
            )
            active_system_prompt = TEMPLATE_FIGURE_SYSTEM_PROMPT
        else:
            user_prompt = _build_user_prompt(
                sections=sections,
                color_scheme=base_colors,
                figure_types=figure_types,
                user_request=user_request,
                max_figures=max_figures,
            )
            active_system_prompt = ACADEMIC_FIGURE_SYSTEM_PROMPT

        logger.info(
            "Calling Prompt AI | provider=%s url=%s model=%s max_tokens=%d template_mode=%s",
            effective_provider,
            effective_api_url,
            effective_model,
            effective_max_tokens,
            template_mode,
        )
        prompt_ai_result = prompt_ai_service.generate_completion(
            system_prompt=active_system_prompt,
            user_prompt=user_prompt,
            timeout=210.0,
            wrap_errors=False,
        )
        raw_text = prompt_ai_result.text
        input_tokens = prompt_ai_result.input_tokens
        output_tokens = prompt_ai_result.output_tokens
        status_code = prompt_ai_result.status_code
        duration_ms = prompt_ai_result.duration_ms

        estimated_cost_usd = compute_prompt_ai_cost_usd(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            input_usd_per_million=prompt_ai_in_usd_per_m,
            output_usd_per_million=prompt_ai_out_usd_per_m,
        )
        estimated_cost_cny = usd_to_cny(estimated_cost_usd, usd_cny_rate)

        _log_prompt_ai_usage(
            db,
            user_id=user_id,
            project_id=project_id,
            provider=effective_provider,
            api_endpoint=effective_api_url,
            model=effective_model,
            key_source=key_source,
            billing_period=billing_period,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            request_duration_ms=duration_ms,
            status_code=status_code,
            is_success=True,
            estimated_cost_usd=estimated_cost_usd,
            estimated_cost_cny=estimated_cost_cny,
        )

        # Deduct balance (best effort; allow going negative to avoid blocking usage tracking)
        db.execute(
            text("UPDATE users SET balance_cny = balance_cny - :cost WHERE id = :uid"),
            {"cost": estimated_cost_cny, "uid": user_id},
        )

        # ------------------------------------------------------------------
        # 6. Parse response
        # ------------------------------------------------------------------
        figures = _parse_figure_prompts(raw_text)
        logger.info("Parsed %d figure prompts from Prompt AI response", len(figures))

        # ------------------------------------------------------------------
        # 7. Persist each figure prompt into the prompts table
        # ------------------------------------------------------------------
        prompt_ids: list[str] = []
        now = datetime.now(UTC)

        for i, fig in enumerate(figures):
            prompt_id = str(uuid.uuid4())
            prompt_ids.append(prompt_id)

            db.execute(
                text(
                    """
                    INSERT INTO prompts (
                        id, project_id, document_id, user_id,
                        figure_number, title,
                        original_prompt,
                        suggested_figure_type,
                        suggested_aspect_ratio,
                        generation_status,
                        generator_provider,
                        generator_model,
                        created_at, updated_at
                    ) VALUES (
                        :id, :project_id, :document_id, :user_id,
                        :figure_number, :title,
                        :original_prompt,
                        :suggested_figure_type,
                        :suggested_aspect_ratio,
                        'completed',
                        :generator_provider,
                        :generator_model,
                        :now, :now
                    )
                    """
                ),
                {
                    "id": prompt_id,
                    "project_id": project_id,
                    "document_id": document_id,
                    "user_id": user_id,
                    "figure_number": fig.get("figure_number", i + 1),
                    "title": fig.get("title", f"Figure {i + 1}"),
                    "original_prompt": fig.get("prompt", ""),
                    "suggested_figure_type": fig.get("figure_type", "overall_framework"),
                    "suggested_aspect_ratio": fig.get("suggested_aspect_ratio", "16:9"),
                    "generator_provider": effective_provider,
                    "generator_model": effective_model,
                    "now": now,
                },
            )

        db.commit()

        result = {
            "document_id": document_id,
            "prompt_ids": prompt_ids,
            "figure_count": len(figures),
        }
        logger.info(
            "generate_prompts_task completed | document_id=%s figures=%d",
            document_id, len(figures),
        )
        return result

    except SoftTimeLimitExceeded:
        logger.error(
            "generate_prompts_task soft time limit exceeded | document_id=%s", document_id
        )
        raise

    except (httpx.HTTPStatusError, httpx.TransportError) as exc:
        logger.warning(
            "Transient error in generate_prompts_task | document_id=%s | %s: %s",
            document_id, type(exc).__name__, exc,
        )
        try:
            countdown = 30 * (2 ** self.request.retries)  # 30s, 60s
            raise self.retry(exc=exc, countdown=countdown)
        except MaxRetriesExceededError:
            _log_prompt_ai_usage(
                db,
                user_id=user_id,
                project_id=project_id,
                provider=effective_provider if "effective_provider" in locals() else "anthropic",
                api_endpoint=effective_api_url if "effective_api_url" in locals() else "",
                model=effective_model if "effective_model" in locals() else "",
                key_source=key_source if "key_source" in locals() else "platform",
                billing_period=_current_billing_period(),
                is_success=False,
                status_code=getattr(getattr(exc, "response", None), "status_code", None),
                error_message=str(exc),
            )
            try:
                db.commit()
            except Exception:
                db.rollback()
            raise

    except Exception as exc:
        logger.error(
            "Unexpected error in generate_prompts_task | document_id=%s\n%s",
            document_id, traceback.format_exc(),
        )
        _log_prompt_ai_usage(
            db,
            user_id=user_id,
            project_id=project_id,
            provider=effective_provider if "effective_provider" in locals() else "anthropic",
            api_endpoint=effective_api_url if "effective_api_url" in locals() else "",
            model=effective_model if "effective_model" in locals() else "",
            key_source=key_source if "key_source" in locals() else "platform",
            billing_period=_current_billing_period(),
            is_success=False,
            error_message=str(exc),
        )
        try:
            db.commit()
        except Exception:
            db.rollback()
        raise

    finally:
        db.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mark_document_failed(db: Session, document_id: str, reason: str) -> None:
    """Deprecated helper (kept for compatibility).

    Prompt generation no longer mutates document parse_status; this should only
    be used by document parsing code paths.
    """
    try:
        db.execute(
            text(
                "UPDATE documents SET parse_status = 'failed', "
                "parse_error = :reason, updated_at = :now "
                "WHERE id = :doc_id"
            ),
            {"reason": reason[:2000], "now": datetime.now(UTC), "doc_id": document_id},
        )
        db.commit()
    except Exception:
        logger.exception("Failed to mark document as failed | document_id=%s", document_id)
