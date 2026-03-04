"""
Celery tasks: parse uploaded documents and generate figure prompts via Claude API.

Flow (generate_prompts_task):
  1. Load document sections from the Document.sections JSONB field (sync session).
  2. Build Claude API request using the academic-figure system prompt.
  3. Call Claude API via httpx (synchronous client – no asyncio in Celery).
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
              generation_status, claude_model, created_at, updated_at
"""

from __future__ import annotations

import json
import logging
import os
import time
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

from app.core.billing import compute_claude_cost_usd, usd_to_cny
from app.core.prompts.color_schemes import PRESET_COLOR_SCHEMES, OKABE_ITO
from app.core.prompts.figure_types import FIGURE_TYPES
from app.core.prompts.system_prompt import ACADEMIC_FIGURE_SYSTEM_PROMPT, TEMPLATE_FIGURE_SYSTEM_PROMPT
from app.core.security import decrypt_api_key
from app.tasks.celery_app import celery_app
from app.tasks.db import _get_session

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Claude API helpers
# ---------------------------------------------------------------------------

CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"
CLAUDE_MODEL: str = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-20250514")
CLAUDE_MAX_TOKENS: int = int(os.environ.get("CLAUDE_MAX_TOKENS", "8192"))
CLAUDE_API_KEY: str = os.environ.get("CLAUDE_API_KEY", "")


def _build_user_prompt(
    sections: list[dict[str, Any]],
    color_scheme: dict[str, str],
    figure_types: list[str] | None,
    user_request: str | None,
    max_figures: int | None,
) -> str:
    """Construct the user-facing message sent to Claude."""
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


def _call_claude_api(
    user_prompt: str,
    api_key: str,
    api_url: str,
    model: str,
    max_tokens: int,
    timeout: float = 210.0,
    system_prompt: str = ACADEMIC_FIGURE_SYSTEM_PROMPT,
) -> tuple[str, int, int, int, int]:
    """
    Synchronously call the Claude Messages API.

    Returns:
      (text, input_tokens, output_tokens, status_code, duration_ms)
    Raises httpx.HTTPStatusError on 4xx/5xx.
    """
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_prompt}],
    }

    with httpx.Client(timeout=timeout) as client:
        t0 = time.perf_counter()
        response = client.post(api_url, headers=headers, json=payload)
        duration_ms = int((time.perf_counter() - t0) * 1000)
        response.raise_for_status()
        data = response.json()

    usage = data.get("usage") or {}
    input_tokens = int(usage.get("input_tokens") or 0)
    output_tokens = int(usage.get("output_tokens") or 0)

    for block in data.get("content", []):
        if block.get("type") == "text":
            return block["text"], input_tokens, output_tokens, int(response.status_code), duration_ms

    raise ValueError(f"Unexpected Claude API response structure: {data}")


def _parse_figure_prompts(raw_text: str) -> list[dict[str, Any]]:
    """
    Extract the JSON array from Claude's response text.

    Claude sometimes wraps the JSON in markdown code fences; strip them.
    """
    text = raw_text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        inner_lines = lines[1:]
        if inner_lines and inner_lines[-1].strip() == "```":
            inner_lines = inner_lines[:-1]
        text = "\n".join(inner_lines).strip()

    figures = json.loads(text)
    if not isinstance(figures, list):
        raise ValueError(f"Expected JSON array from Claude, got {type(figures)}")
    return figures


def _normalize_claude_api_url(base_or_full: str | None) -> str:
    """Normalize Claude API base URL or full messages URL to a messages endpoint."""
    if not base_or_full:
        return CLAUDE_API_URL
    url = base_or_full.strip()
    if not url:
        return CLAUDE_API_URL
    url = url.rstrip("/")
    if url.endswith("/v1/messages"):
        return url
    return f"{url}/v1/messages"


def _get_system_claude_settings(db: Session) -> tuple[str | None, str | None, str | None]:
    """Fetch system Claude settings (encrypted key + base URL + model) from DB."""
    row = db.execute(
        text(
            "SELECT claude_api_key_enc, claude_api_base_url, claude_model "
            "FROM system_settings WHERE id = 1"
        )
    ).fetchone()
    if not row:
        return None, None, None
    return row[0], row[1], row[2]

def _get_pricing(db: Session) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    """Fetch pricing from system_settings with safe defaults.

    Returns: (usd_cny_rate, image_price_cny, claude_in_usd_per_m, claude_out_usd_per_m)
    """
    row = db.execute(
        text(
            "SELECT usd_cny_rate, image_price_cny, claude_input_usd_per_million, claude_output_usd_per_million "
            "FROM system_settings WHERE id = 1"
        )
    ).fetchone()
    if not row:
        return Decimal("7.2"), Decimal("1.5"), Decimal("3.0"), Decimal("15.0")
    usd_cny_rate = Decimal(str(row[0] if row[0] is not None else "7.2"))
    image_price_cny = Decimal(str(row[1] if row[1] is not None else "1.5"))
    claude_in = Decimal(str(row[2] if row[2] is not None else "3.0"))
    claude_out = Decimal(str(row[3] if row[3] is not None else "15.0"))
    return usd_cny_rate, image_price_cny, claude_in, claude_out


def _current_billing_period() -> str:
    return datetime.utcnow().strftime("%Y-%m")


def _log_claude_usage(
    db: Session,
    *,
    user_id: str,
    project_id: str,
    api_endpoint: str,
    claude_model: str,
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
    """Best-effort usage log entry for Claude."""
    try:
        db.execute(
            text(
                """
                INSERT INTO usage_logs (
                    id, user_id, project_id,
                    api_name, api_endpoint,
                    input_tokens, output_tokens,
                    claude_model, request_duration_ms,
                    key_source, is_success, status_code, error_message,
                    estimated_cost_usd, estimated_cost_cny,
                    billing_period, created_at
                ) VALUES (
                    :id, :user_id, :project_id,
                    'claude', :api_endpoint,
                    :input_tokens, :output_tokens,
                    :claude_model, :request_duration_ms,
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
                "api_endpoint": api_endpoint[:200] if api_endpoint else None,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "claude_model": claude_model,
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
        logger.exception("Failed to log Claude usage")


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
                         When provided, only those sections are sent to Claude.

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
        # 4. Resolve API key (BYOK > env key > system key)
        # ------------------------------------------------------------------
        system_key_enc, system_api_base_url, system_model = _get_system_claude_settings(db)
        effective_api_url = _normalize_claude_api_url(system_api_base_url)
        effective_model = system_model or CLAUDE_MODEL
        effective_max_tokens = CLAUDE_MAX_TOKENS
        billing_period = _current_billing_period()
        usd_cny_rate, _image_price_cny, claude_in_usd_per_m, claude_out_usd_per_m = _get_pricing(db)

        result = db.execute(
            text("SELECT claude_api_key_enc FROM users WHERE id = :uid"),
            {"uid": user_id},
        )
        byok_row = result.fetchone()
        encrypted_key = byok_row[0] if byok_row else None

        if encrypted_key:
            api_key = decrypt_api_key(encrypted_key)
            key_source = "byok"
            logger.info("Using BYOK Claude key for user_id=%s", user_id)
        elif CLAUDE_API_KEY:
            api_key = CLAUDE_API_KEY
            key_source = "platform"
            logger.info("Using platform Claude key from env")
        elif system_key_enc:
            api_key = decrypt_api_key(system_key_enc)
            key_source = "platform"
            logger.info("Using platform Claude key from system settings")
        else:
            raise ValueError(
                "No Claude API key available: set CLAUDE_API_KEY env var, "
                "or configure system key in admin settings, "
                "or add a BYOK key for this user."
            )

        # ------------------------------------------------------------------
        # 5. Build and send Claude API request
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
            "Calling Claude API | url=%s model=%s max_tokens=%d template_mode=%s",
            effective_api_url,
            effective_model,
            effective_max_tokens,
            template_mode,
        )
        raw_text, input_tokens, output_tokens, status_code, duration_ms = _call_claude_api(
            user_prompt=user_prompt,
            api_key=api_key,
            api_url=effective_api_url,
            model=effective_model,
            max_tokens=effective_max_tokens,
            system_prompt=active_system_prompt,
        )

        estimated_cost_usd = compute_claude_cost_usd(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            input_usd_per_million=claude_in_usd_per_m,
            output_usd_per_million=claude_out_usd_per_m,
        )
        estimated_cost_cny = usd_to_cny(estimated_cost_usd, usd_cny_rate)

        _log_claude_usage(
            db,
            user_id=user_id,
            project_id=project_id,
            api_endpoint=effective_api_url,
            claude_model=effective_model,
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
        logger.info("Parsed %d figure prompts from Claude response", len(figures))

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
                        claude_model,
                        created_at, updated_at
                    ) VALUES (
                        :id, :project_id, :document_id, :user_id,
                        :figure_number, :title,
                        :original_prompt,
                        :suggested_figure_type,
                        :suggested_aspect_ratio,
                        'completed',
                        :claude_model,
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
                    "claude_model": effective_model,
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
            _log_claude_usage(
                db,
                user_id=user_id,
                project_id=project_id,
                api_endpoint=effective_api_url if "effective_api_url" in locals() else "",
                claude_model=effective_model if "effective_model" in locals() else "",
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
        _log_claude_usage(
            db,
            user_id=user_id,
            project_id=project_id,
            api_endpoint=effective_api_url if "effective_api_url" in locals() else "",
            claude_model=effective_model if "effective_model" in locals() else "",
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
