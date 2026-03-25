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
from decimal import Decimal
from typing import Any

import httpx
from celery import Task
from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded
from minio import Minio
from minio.error import S3Error
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.billing import cny_to_usd
from app.core.security import decrypt_api_key
from app.services.nanobanana_service import (
    NanoBananaConfigLayer,
    resolve_nanobanana_settings,
)
from app.tasks.celery_app import celery_app
from app.tasks.db import _get_session

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# NanoBanana API helpers
# ---------------------------------------------------------------------------

NANOBANANA_API_BASE: str = os.environ.get(
    "NANOBANANA_API_BASE", "https://api.keepgo.icu"
)
NANOBANANA_API_KEY: str = os.environ.get("NANOBANANA_API_KEY", "")
NANOBANANA_MODEL: str = os.environ.get("NANOBANANA_MODEL", "gemini-3-pro-image-preview")

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

def _resolve_image_price_for_resolution(
    resolution: str,
    price_1k: Decimal,
    price_2k: Decimal,
    price_4k: Decimal,
    fallback: Decimal,
) -> Decimal:
    r = (resolution or "").strip()
    if r in ("1k", "1K"):
        return price_1k
    if r in ("4k", "4K"):
        return price_4k
    if r in ("2k", "2K"):
        return price_2k
    return fallback


def _get_pricing(db: Session, resolution: str) -> tuple[Decimal, Decimal]:
    """Fetch (usd_cny_rate, image_price_cny_for_resolution) from system_settings with defaults."""
    row = db.execute(
        text("SELECT usd_cny_rate, image_price_cny FROM system_settings WHERE id = 1")
    ).fetchone()
    if not row:
        return Decimal("7.2"), Decimal("1.5")
    usd_cny_rate = Decimal(str(row[0] if row[0] is not None else "7.2"))
    fallback = Decimal(str(row[1] if row[1] is not None else "1.5"))

    # Try per-resolution columns if present (older DBs may not have them yet)
    try:
        row2 = db.execute(
            text(
                "SELECT image_price_cny_1k, image_price_cny_2k, image_price_cny_4k "
                "FROM system_settings WHERE id = 1"
            )
        ).fetchone()
        if row2:
            p1 = Decimal(str(row2[0] if row2[0] is not None else fallback))
            p2 = Decimal(str(row2[1] if row2[1] is not None else fallback))
            p4 = Decimal(str(row2[2] if row2[2] is not None else fallback))
            return usd_cny_rate, _resolve_image_price_for_resolution(resolution, p1, p2, p4, fallback)
    except Exception:
        # DB schema may not include columns yet; fallback to single price.
        pass

    return usd_cny_rate, fallback


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
    model: str,
) -> str:
    """
    POST to NanoBanana Gemini-style image generation endpoint.

    Returns the base64-encoded image string from the response.
    Raises httpx.HTTPStatusError on non-2xx responses.
    """
    model_id = (model or "gemini-3-pro-image-preview").strip()
    endpoint = f"{api_base_url.rstrip('/')}/v1beta/models/{model_id}:generateContent"
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


def _get_system_nanobanana_settings(db: Session) -> tuple[str | None, str | None, str | None]:
    """Fetch system NanoBanana settings (encrypted key + base URL + model) from DB."""
    row = db.execute(
        text(
            "SELECT nanobanana_api_key_enc, nanobanana_api_base_url, nanobanana_model "
            "FROM system_settings WHERE id = 1"
        )
    ).fetchone()
    if not row:
        return None, None, None
    return row[0], row[1], row[2]


def _get_user_nanobanana_settings(
    db: Session, user_id: str
) -> tuple[str | None, str | None, str | None]:
    """Fetch user NanoBanana settings (encrypted key + base URL + model) from DB."""
    row = db.execute(
        text(
            "SELECT nanobanana_api_key_enc, nanobanana_api_base_url, nanobanana_model "
            "FROM users WHERE id = :uid"
        ),
        {"uid": user_id},
    ).fetchone()
    if not row:
        return None, None, None
    return row[0], row[1], row[2]


def _get_png_dimensions(png_bytes: bytes) -> tuple[int, int]:
    """Parse width and height from PNG IHDR chunk (bytes 16-24)."""
    if len(png_bytes) < 24 or png_bytes[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Response bytes are not a valid PNG image.")
    width = struct.unpack(">I", png_bytes[16:20])[0]
    height = struct.unpack(">I", png_bytes[20:24])[0]
    return width, height


def _get_jpeg_dimensions(jpeg_bytes: bytes) -> tuple[int, int]:
    """Parse width/height from a JPEG byte stream (SOF marker)."""
    if len(jpeg_bytes) < 4 or jpeg_bytes[:2] != b"\xff\xd8":
        raise ValueError("Response bytes are not a valid JPEG image.")

    i = 2  # after SOI
    while i + 1 < len(jpeg_bytes):
        # Find marker 0xFF
        if jpeg_bytes[i] != 0xFF:
            i += 1
            continue

        # Skip fill bytes 0xFF
        while i < len(jpeg_bytes) and jpeg_bytes[i] == 0xFF:
            i += 1
        if i >= len(jpeg_bytes):
            break

        marker = jpeg_bytes[i]
        i += 1

        # Standalone markers (no length)
        if marker in (0xD8, 0xD9):  # SOI, EOI
            continue
        if 0xD0 <= marker <= 0xD7:  # RSTn
            continue

        # Need segment length
        if i + 1 >= len(jpeg_bytes):
            break
        seg_len = (jpeg_bytes[i] << 8) + jpeg_bytes[i + 1]
        if seg_len < 2:
            break

        seg_start = i + 2
        seg_end = seg_start + (seg_len - 2)
        if seg_end > len(jpeg_bytes):
            break

        # SOF markers that contain dimensions
        if marker in (
            0xC0, 0xC1, 0xC2, 0xC3,
            0xC5, 0xC6, 0xC7,
            0xC9, 0xCA, 0xCB,
            0xCD, 0xCE, 0xCF,
        ):
            if seg_start + 7 > len(jpeg_bytes):
                break
            height = (jpeg_bytes[seg_start + 1] << 8) + jpeg_bytes[seg_start + 2]
            width = (jpeg_bytes[seg_start + 3] << 8) + jpeg_bytes[seg_start + 4]
            return width, height

        i = seg_end

    raise ValueError("Unable to determine JPEG dimensions (no SOF marker found).")


def _detect_image(
    image_bytes: bytes,
) -> tuple[str, str, int, int]:
    """Detect image type and dimensions.

    Returns: (ext, mime_type, width_px, height_px)
    """
    if len(image_bytes) >= 8 and image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = _get_png_dimensions(image_bytes)
        return "png", "image/png", w, h

    if len(image_bytes) >= 2 and image_bytes[:2] == b"\xff\xd8":
        w, h = _get_jpeg_dimensions(image_bytes)
        return "jpg", "image/jpeg", w, h

    # Best-effort preview to aid debugging (avoid dumping full bytes)
    head = image_bytes[:16].hex()
    raise ValueError(f"Unsupported image format (header={head}). Expected PNG or JPEG.")


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


def _upload_to_minio(image_bytes: bytes, object_name: str, content_type: str) -> str:
    """
    Upload bytes to MinIO, creating the bucket if it does not exist.

    Returns the object name (key): "<object_name>".
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
        content_type=content_type,
    )
    return object_name


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
        encrypted_key, user_api_base_url, user_model = _get_user_nanobanana_settings(
            db, user_id
        )
        system_key_enc, system_api_base_url, system_model = _get_system_nanobanana_settings(db)
        resolved_settings = resolve_nanobanana_settings(
            user_layer=NanoBananaConfigLayer(
                api_key=decrypt_api_key(encrypted_key) if encrypted_key else None,
                api_base_url=user_api_base_url,
                model=user_model,
            ),
            system_layer=NanoBananaConfigLayer(
                api_key=decrypt_api_key(system_key_enc) if system_key_enc else None,
                api_base_url=system_api_base_url,
                model=system_model,
            ),
            env_layer=NanoBananaConfigLayer(
                api_key=NANOBANANA_API_KEY,
                api_base_url=NANOBANANA_API_BASE,
                model=NANOBANANA_MODEL,
            ),
        )
        effective_api_base_url = resolved_settings.api_base_url
        effective_model = resolved_settings.model.strip()

        if encrypted_key:
            api_key = resolved_settings.api_key
            key_source = "byok"
            logger.info("Using BYOK NanoBanana key for user_id=%s", user_id)
        elif system_key_enc:
            api_key = resolved_settings.api_key
            key_source = "platform"
            logger.info("Using platform NanoBanana key from system settings")
        elif NANOBANANA_API_KEY:
            api_key = resolved_settings.api_key
            key_source = "platform"
            logger.info("Using platform NanoBanana key from env")
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
            model=effective_model,
        )

        # ------------------------------------------------------------------
        # 6. Decode base64 PNG
        # ------------------------------------------------------------------
        image_bytes = base64.b64decode(b64_image)
        ext, mime_type, actual_width, actual_height = _detect_image(image_bytes)
        file_size_bytes = len(image_bytes)
        logger.info(
            "Decoded image (%s): %dx%d, %d bytes",
            mime_type,
            actual_width,
            actual_height,
            file_size_bytes,
        )

        # ------------------------------------------------------------------
        # 7. Upload to MinIO
        # ------------------------------------------------------------------
        object_name = f"figures/{user_id}/{image_id}.{ext}"
        storage_path = _upload_to_minio(image_bytes, object_name, mime_type)
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
        usd_cny_rate, image_price_cny = _get_pricing(db, resolution)
        estimated_cost_cny = image_price_cny
        estimated_cost_usd = cny_to_usd(estimated_cost_cny, usd_cny_rate)

        usage_id = str(uuid.uuid4())
        api_endpoint = f"{effective_api_base_url.rstrip('/')}/v1beta/models/{effective_model}:generateContent"
        db.execute(
            text(
                """
                INSERT INTO usage_logs (
                    id, user_id, api_name, api_endpoint,
                    resolution, aspect_ratio,
                    estimated_cost_usd, estimated_cost_cny,
                    key_source, is_success, status_code,
                    billing_period, created_at
                ) VALUES (
                    :id, :user_id, 'nanobanana', :api_endpoint,
                    :resolution, :aspect_ratio,
                    :estimated_cost_usd, :estimated_cost_cny,
                    :key_source, TRUE, 200,
                    :billing_period, :now
                )
                """
            ),
            {
                "id": usage_id,
                "user_id": user_id,
                "api_endpoint": api_endpoint,
                "resolution": resolution,
                "aspect_ratio": aspect_ratio,
                "estimated_cost_usd": estimated_cost_usd,
                "estimated_cost_cny": estimated_cost_cny,
                "key_source": key_source,
                "billing_period": billing_period,
                "now": completed_at,
            },
        )

        # Deduct unified balance (best-effort; API side should pre-check for enough balance)
        db.execute(
            text("UPDATE users SET balance_cny = balance_cny - :cost WHERE id = :uid"),
            {"cost": estimated_cost_cny, "uid": user_id},
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
        api_endpoint = (
            f"{effective_api_base_url.rstrip('/')}/v1beta/models/{effective_model}:generateContent"
            if "effective_api_base_url" in locals() and "effective_model" in locals()
            else None
        )
        _log_failed_usage(db, user_id, resolution, aspect_ratio, key_source,
                          billing_period, status_code, str(exc), api_endpoint=api_endpoint)
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
        api_endpoint = (
            f"{effective_api_base_url.rstrip('/')}/v1beta/models/{effective_model}:generateContent"
            if "effective_api_base_url" in locals() and "effective_model" in locals()
            else None
        )
        _log_failed_usage(db, user_id, resolution, aspect_ratio, key_source,
                          billing_period, None, str(exc), api_endpoint=api_endpoint)
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
    api_endpoint: str | None = None,
) -> None:
    """Best-effort usage log entry for failed requests."""
    try:
        db.execute(
            text(
                """
                INSERT INTO usage_logs (
                    id, user_id, api_name, api_endpoint,
                    resolution, aspect_ratio,
                    estimated_cost_usd, estimated_cost_cny,
                    key_source, is_success, status_code, error_message,
                    billing_period, created_at
                ) VALUES (
                    :id, :user_id, 'nanobanana', :api_endpoint,
                    :resolution, :aspect_ratio,
                    :estimated_cost_usd, :estimated_cost_cny,
                    :key_source, FALSE, :status_code, :error_message,
                    :billing_period, :now
                )
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "api_endpoint": (api_endpoint or f"{NANOBANANA_API_BASE}/v1beta/models/{NANOBANANA_MODEL}:generateContent")[:200],
                "resolution": resolution,
                "aspect_ratio": aspect_ratio,
                "estimated_cost_usd": Decimal("0"),
                "estimated_cost_cny": Decimal("0"),
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
