"""
Celery task: generate academic figures via the NanoBanana image API.

Flow:
  1. Resolve API key (BYOK or platform key).
  2. Determine timeout based on requested resolution.
  3. Build NanoBanana API request (text-to-image or image-edit).
  4. Call API via httpx (sync); retry on 429 / 5xx with exponential back-off.
  5. Decode base64 PNG from response.
  6. Upload PNG bytes to MinIO.
  7. Update Image record in DB with storage_path, width_px, height_px, file_size_bytes.
  8. Log API usage in usage_logs table.

Timeout policy:
  - 1K resolution  → 360 s soft / 420 s hard
  - 2K resolution  → 600 s soft / 660 s hard
  - 4K resolution  → 1140 s soft / 1200 s hard  (default)

Retry policy: up to 3 retries on 429 / 5xx.

Schema reference (from app/models/):
  images:      id, generation_status, storage_path, width_px, height_px,
               file_size_bytes, resolution, aspect_ratio, updated_at
  usage_logs:  id, user_id, project_id, api_name, api_endpoint, resolution,
               aspect_ratio, key_source, billing_period, is_success,
               status_code, created_at
"""

from __future__ import annotations

import base64
import io
import logging
import os
import struct
import traceback
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from celery import Task
from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded
from minio import Minio
from minio.error import S3Error
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security import decrypt_api_key
from app.tasks.celery_app import celery_app
from app.tasks.db import _get_session

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# NanoBanana API helpers
# ---------------------------------------------------------------------------

NANOBANANA_API_BASE: str = os.environ.get(
    "NANOBANANA_API_BASE", "https://api.ikuncode.cc"
)
NANOBANANA_API_KEY: str = os.environ.get("NANOBANANA_API_KEY", "")

# Resolution bucket → (soft_limit_s, hard_limit_s)
RESOLUTION_TIMEOUTS: dict[str, tuple[int, int]] = {
    "1k":  (360,  420),
    "2k":  (600,  660),
    "4k":  (1140, 1200),
    # Accept uppercase variants matching the model default "2K"
    "1K":  (360,  420),
    "2K":  (600,  660),
    "4K":  (1140, 1200),
}

# Resolution bucket → base pixel size (long edge)
RESOLUTION_BASE_PX: dict[str, int] = {
    "1k": 1024, "1K": 1024,
    "2k": 2048, "2K": 2048,
    "4k": 4096, "4K": 4096,
}

# Aspect ratio string → (width_ratio, height_ratio)
ASPECT_RATIO_MAP: dict[str, tuple[float, float]] = {
    "1:1":  (1.0, 1.0),
    "4:3":  (4.0, 3.0),
    "3:4":  (3.0, 4.0),
    "16:9": (16.0, 9.0),
    "9:16": (9.0, 16.0),
    "3:2":  (3.0, 2.0),
    "2:3":  (2.0, 3.0),
}


def _compute_dimensions(resolution: str, aspect_ratio: str) -> tuple[int, int]:
    """Compute pixel width × height from resolution bucket and aspect ratio string."""
    base_px = RESOLUTION_BASE_PX.get(resolution, 2048)
    ar = ASPECT_RATIO_MAP.get(aspect_ratio, (1.0, 1.0))
    ratio = ar[0] / ar[1]
    if ratio >= 1.0:
        width = base_px
        height = int(base_px / ratio)
    else:
        height = base_px
        width = int(base_px * ratio)
    # Round to nearest multiple of 64 (common requirement for diffusion models)
    width = (width // 64) * 64
    height = (height // 64) * 64
    return width, height


def _build_generation_payload(
    prompt_text: str,
    aspect_ratio: str,
    image_size: str,
    color_scheme: str,
) -> dict[str, Any]:
    """Build the Gemini-style API request payload for NanoBanana.

    Uses the same format as the working ikun skill:
      POST /v1beta/models/gemini-3-pro-image-preview:generateContent
    """
    style_prefix = (
        "Academic figure, publication-quality, white background, clean vector style, "
        "no shadows, no 3D effects, professional sans-serif labels, "
        f"color scheme: {color_scheme}. "
    )
    full_prompt = style_prefix + prompt_text

    return {
        "contents": [{"parts": [{"text": full_prompt}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {
                "aspectRatio": aspect_ratio,
                "image_size": image_size,
            },
        },
    }


def _call_nanobanana_api(
    payload: dict[str, Any],
    api_key: str,
    timeout: float,
    api_base_url: str,
) -> str:
    """
    POST to NanoBanana Gemini-style image generation endpoint.

    Returns the base64-encoded image string from the response.
    Raises httpx.HTTPStatusError on non-2xx responses.
    """
    endpoint = (
        f"{api_base_url.rstrip('/')}"
        "/v1beta/models/gemini-3-pro-image-preview:generateContent"
    )
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    with httpx.Client(timeout=timeout) as client:
        response = client.post(endpoint, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    try:
        parts = data["candidates"][0]["content"]["parts"]
        image_part = next(p for p in parts if "inlineData" in p)
        b64_image = image_part["inlineData"]["data"]
    except (KeyError, IndexError, StopIteration) as exc:
        raise ValueError(
            f"NanoBanana response missing image data: {data}"
        ) from exc

    return b64_image


def _get_system_nanobanana_settings(db: Session) -> tuple[str | None, str | None]:
    """Fetch system NanoBanana settings (encrypted key + base URL) from DB."""
    row = db.execute(
        text(
            "SELECT nanobanana_api_key_enc, nanobanana_api_base_url "
            "FROM system_settings WHERE id = 1"
        )
    ).fetchone()
    if not row:
        return None, None
    return row[0], row[1]


def _get_png_dimensions(png_bytes: bytes) -> tuple[int, int]:
    """Parse width and height from PNG IHDR chunk (bytes 16-24)."""
    if len(png_bytes) < 24 or png_bytes[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Response bytes are not a valid PNG image.")
    width = struct.unpack(">I", png_bytes[16:20])[0]
    height = struct.unpack(">I", png_bytes[20:24])[0]
    return width, height


# ---------------------------------------------------------------------------
# MinIO helpers
# ---------------------------------------------------------------------------

_minio_client: Minio | None = None


def _get_minio_client() -> Minio:
    global _minio_client
    if _minio_client is None:
        _minio_client = Minio(
            endpoint=os.environ.get("MINIO_ENDPOINT", "minio:9000"),
            access_key=os.environ.get("MINIO_ACCESS_KEY", "minioadmin"),
            secret_key=os.environ.get("MINIO_SECRET_KEY", "minioadmin"),
            secure=os.environ.get("MINIO_USE_SSL", "false").lower() == "true",
        )
    return _minio_client


def _upload_to_minio(image_bytes: bytes, object_name: str) -> str:
    """
    Upload bytes to MinIO, creating the bucket if it does not exist.

    Returns the full storage path: "<bucket>/<object_name>".
    """
    bucket = os.environ.get("MINIO_BUCKET_NAME", "academic-figures")
    client = _get_minio_client()

    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)

    client.put_object(
        bucket_name=bucket,
        object_name=object_name,
        data=io.BytesIO(image_bytes),
        length=len(image_bytes),
        content_type="image/png",
    )
    return f"{bucket}/{object_name}"


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------

@celery_app.task(
    bind=True,
    queue="images",
    max_retries=3,
    # Default limits for 4K; resolution-specific limits applied at runtime
    soft_time_limit=1140,
    time_limit=1200,
    name="app.tasks.image_tasks.generate_image_task",
)
def generate_image_task(
    self: Task,
    image_id: str,
    prompt_text: str,
    user_id: str,
    resolution: str,
    aspect_ratio: str,
    color_scheme: str,
    reference_image_path: str | None,
    edit_instruction: str | None,
    direct_prompt: str | None = None,
) -> dict[str, Any]:
    """
    Generate a single academic figure image via the NanoBanana API.

    Args:
        image_id:             UUID of the Image record (images table) to update.
        prompt_text:          The detailed figure prompt (500+ words).
        user_id:              UUID of the requesting user (for BYOK lookup).
        resolution:           One of "1k"/"1K", "2k"/"2K", "4k"/"4K".
        aspect_ratio:         E.g. "16:9", "4:3", "1:1".
        color_scheme:         Preset name e.g. "okabe_ito".
        reference_image_path: MinIO path of a reference image for edits.
        edit_instruction:     Natural language edit instruction (image-edit mode).
        direct_prompt:        When provided, use this as the prompt text instead
                              of prompt_text (overrides prompt_text).

    Returns:
        dict with keys: image_id, storage_path, width_px, height_px, file_size_bytes.
    """
    logger.info(
        "generate_image_task started | image_id=%s user_id=%s resolution=%s aspect_ratio=%s",
        image_id, user_id, resolution, aspect_ratio,
    )

    # direct_prompt overrides prompt_text when provided
    effective_prompt = direct_prompt if direct_prompt is not None else prompt_text

    db: Session = _get_session()
    soft_limit_s = RESOLUTION_TIMEOUTS.get(resolution, (1140, 1200))[0]
    now = datetime.now(UTC)
    billing_period = now.strftime("%Y-%m")

    try:
        # ------------------------------------------------------------------
        # 1. Mark image as processing
        # ------------------------------------------------------------------
        db.execute(
            text(
                "UPDATE images SET generation_status = 'processing', "
                "generation_error = NULL, "
                "updated_at = :now WHERE id = :img_id"
            ),
            {"now": now, "img_id": image_id},
        )
        db.commit()

        # ------------------------------------------------------------------
        # 2. Resolve API key (BYOK > platform)
        # ------------------------------------------------------------------
        byok_result = db.execute(
            text("SELECT nanobanana_api_key_enc FROM users WHERE id = :uid"),
            {"uid": user_id},
        )
        byok_row = byok_result.fetchone()
        encrypted_key = byok_row[0] if byok_row else None
        system_key_enc, system_api_base_url = _get_system_nanobanana_settings(db)
        effective_api_base_url = system_api_base_url or NANOBANANA_API_BASE

        if encrypted_key:
            api_key = decrypt_api_key(encrypted_key)
            key_source = "byok"
            logger.info("Using BYOK NanoBanana key for user_id=%s", user_id)
        elif NANOBANANA_API_KEY:
            api_key = NANOBANANA_API_KEY
            key_source = "platform"
            logger.info("Using platform NanoBanana key from env")
        elif system_key_enc:
            api_key = decrypt_api_key(system_key_enc)
            key_source = "platform"
            logger.info("Using platform NanoBanana key from system settings")
        else:
            raise ValueError(
                "No NanoBanana API key available: set NANOBANANA_API_KEY env var, "
                "or configure system key in admin settings, "
                "or add a BYOK key for this user."
            )

        # ------------------------------------------------------------------
        # 3. Build API payload (Gemini-style, API handles resolution)
        # ------------------------------------------------------------------
        payload = _build_generation_payload(
            prompt_text=effective_prompt,
            aspect_ratio=aspect_ratio,
            image_size=resolution,
            color_scheme=color_scheme,
        )
        logger.info(
            "Built Gemini payload | resolution=%s aspect_ratio=%s",
            resolution, aspect_ratio,
        )

        # ------------------------------------------------------------------
        # 5. Call NanoBanana API
        # ------------------------------------------------------------------
        api_timeout = float(soft_limit_s - 30)  # 30 s buffer for upload
        logger.info(
            "Calling NanoBanana API | endpoint=%s timeout=%.0fs",
            effective_api_base_url, api_timeout,
        )
        b64_image = _call_nanobanana_api(
            payload,
            api_key,
            timeout=api_timeout,
            api_base_url=effective_api_base_url,
        )

        # ------------------------------------------------------------------
        # 6. Decode base64 PNG
        # ------------------------------------------------------------------
        image_bytes = base64.b64decode(b64_image)
        actual_width, actual_height = _get_png_dimensions(image_bytes)
        file_size_bytes = len(image_bytes)
        logger.info(
            "Decoded PNG: %dx%d, %d bytes", actual_width, actual_height, file_size_bytes
        )

        # ------------------------------------------------------------------
        # 7. Upload to MinIO
        # ------------------------------------------------------------------
        object_name = f"figures/{user_id}/{image_id}.png"
        storage_path = _upload_to_minio(image_bytes, object_name)
        logger.info("Uploaded to MinIO: %s", storage_path)

        # ------------------------------------------------------------------
        # 8. Update image record — use actual model column names
        # ------------------------------------------------------------------
        completed_at = datetime.now(UTC)
        db.execute(
            text(
                """
                UPDATE images SET
                    generation_status = 'completed',
                    storage_path = :storage_path,
                    width_px = :width_px,
                    height_px = :height_px,
                    file_size_bytes = :file_size_bytes,
                    resolution = :resolution,
                    aspect_ratio = :aspect_ratio,
                    generation_error = NULL,
                    updated_at = :now
                WHERE id = :img_id
                """
            ),
            {
                "storage_path": storage_path,
                "width_px": actual_width,
                "height_px": actual_height,
                "file_size_bytes": file_size_bytes,
                "resolution": resolution,
                "aspect_ratio": aspect_ratio,
                "now": completed_at,
                "img_id": image_id,
            },
        )

        # ------------------------------------------------------------------
        # 9. Log API usage in usage_logs table
        # ------------------------------------------------------------------
        usage_id = str(uuid.uuid4())
        db.execute(
            text(
                """
                INSERT INTO usage_logs (
                    id, user_id, api_name, api_endpoint,
                    resolution, aspect_ratio,
                    key_source, is_success, status_code,
                    billing_period, created_at
                ) VALUES (
                    :id, :user_id, 'nanobanana', :api_endpoint,
                    :resolution, :aspect_ratio,
                    :key_source, TRUE, 200,
                    :billing_period, :now
                )
                """
            ),
            {
                "id": usage_id,
                "user_id": user_id,
                "api_endpoint": f"{NANOBANANA_API_BASE}/v1beta/models/gemini-3-pro-image-preview:generateContent",
                "resolution": resolution,
                "aspect_ratio": aspect_ratio,
                "key_source": key_source,
                "billing_period": billing_period,
                "now": completed_at,
            },
        )
        db.commit()

        result = {
            "image_id": image_id,
            "storage_path": storage_path,
            "width_px": actual_width,
            "height_px": actual_height,
            "file_size_bytes": file_size_bytes,
        }
        logger.info(
            "generate_image_task completed | image_id=%s storage=%s",
            image_id, storage_path,
        )
        return result

    except SoftTimeLimitExceeded:
        logger.error("generate_image_task soft time limit exceeded | image_id=%s", image_id)
        _mark_image_failed(db, image_id, f"Image generation timed out ({soft_limit_s}s limit).")
        raise

    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        logger.warning(
            "HTTP error from NanoBanana | image_id=%s status=%d", image_id, status_code
        )
        _log_failed_usage(db, user_id, resolution, aspect_ratio, key_source,
                          billing_period, status_code, str(exc))
        if status_code == 429 or status_code >= 500:
            try:
                countdown = 60 * (2 ** self.request.retries)  # 60s, 120s, 240s
                raise self.retry(exc=exc, countdown=countdown)
            except MaxRetriesExceededError:
                _mark_image_failed(
                    db, image_id,
                    f"NanoBanana API error {status_code} after max retries: {exc}",
                )
                raise
        else:
            _mark_image_failed(db, image_id, f"NanoBanana client error {status_code}: {exc}")
            raise

    except httpx.TransportError as exc:
        logger.warning("Transport error | image_id=%s | %s", image_id, exc)
        _log_failed_usage(db, user_id, resolution, aspect_ratio, key_source,
                          billing_period, None, str(exc))
        try:
            countdown = 60 * (2 ** self.request.retries)
            raise self.retry(exc=exc, countdown=countdown)
        except MaxRetriesExceededError:
            _mark_image_failed(db, image_id, f"Network error after max retries: {exc}")
            raise

    except S3Error as exc:
        logger.error("MinIO upload failed | image_id=%s | %s", image_id, exc)
        _mark_image_failed(db, image_id, f"Storage upload failed: {exc}")
        raise

    except Exception as exc:
        logger.error(
            "Unexpected error in generate_image_task | image_id=%s | %s: %s\n%s",
            image_id,
            type(exc).__name__,
            exc,
            traceback.format_exc(),
        )
        _mark_image_failed(db, image_id, str(exc))
        raise

    finally:
        db.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mark_image_failed(db: Session, image_id: str, reason: str) -> None:
    """Best-effort DB update; swallows errors to avoid masking the original."""
    try:
        db.execute(
            text(
                "UPDATE images SET generation_status = 'failed', "
                "generation_error = :reason, "
                "updated_at = :now WHERE id = :img_id"
            ),
            {"now": datetime.now(UTC), "img_id": image_id, "reason": reason[:2000]},
        )
        db.commit()
    except Exception:
        logger.exception("Failed to mark image as failed | image_id=%s", image_id)


def _log_failed_usage(
    db: Session,
    user_id: str,
    resolution: str,
    aspect_ratio: str,
    key_source: str,
    billing_period: str,
    status_code: int | None,
    error_message: str,
) -> None:
    """Best-effort usage log entry for failed requests."""
    try:
        db.execute(
            text(
                """
                INSERT INTO usage_logs (
                    id, user_id, api_name, api_endpoint,
                    resolution, aspect_ratio,
                    key_source, is_success, status_code, error_message,
                    billing_period, created_at
                ) VALUES (
                    :id, :user_id, 'nanobanana', :api_endpoint,
                    :resolution, :aspect_ratio,
                    :key_source, FALSE, :status_code, :error_message,
                    :billing_period, :now
                )
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "api_endpoint": f"{NANOBANANA_API_BASE}/v1beta/models/gemini-3-pro-image-preview:generateContent",
                "resolution": resolution,
                "aspect_ratio": aspect_ratio,
                "key_source": key_source,
                "status_code": status_code,
                "error_message": error_message[:2000],
                "billing_period": billing_period,
                "now": datetime.now(UTC),
            },
        )
        db.commit()
    except Exception:
        logger.exception("Failed to log failed usage")
