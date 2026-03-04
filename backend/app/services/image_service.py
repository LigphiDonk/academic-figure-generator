"""NanoBanana (api.keepgo.icu) image generation service."""

from __future__ import annotations

import base64
import logging
import math
import time

import httpx

from app.config import get_settings
from app.core.exceptions import ExternalAPIException

logger = logging.getLogger(__name__)


class ImageService:
    """Integration with NanoBanana API for image generation.

    The API at ``api.keepgo.icu`` follows the OpenAI-compatible image
    generation format.
    """

    RESOLUTION_MAP: dict[str, dict[str, int]] = {
        "1K": {"width": 1024, "height": 1024},
        "2K": {"width": 2048, "height": 2048},
        "4K": {"width": 4096, "height": 4096},
    }

    ASPECT_RATIO_MAP: dict[str, tuple[int, int]] = {
        "1:1": (1, 1),
        "16:9": (16, 9),
        "9:16": (9, 16),
        "4:3": (4, 3),
        "3:4": (3, 4),
        "3:2": (3, 2),
        "2:3": (2, 3),
        "21:9": (21, 9),
        "9:21": (9, 21),
        "1:2": (1, 2),
    }

    TIMEOUT_MAP: dict[str, int] = {
        "1K": 360,
        "2K": 600,
        "4K": 1200,
    }

    def __init__(self, api_key: str | None = None, api_base_url: str | None = None) -> None:
        settings = get_settings()
        self.api_key = api_key or settings.NANOBANANA_API_KEY
        # Priority: explicit param → config default
        self.api_base = (api_base_url or settings.NANOBANANA_API_BASE).rstrip("/")

        if not self.api_key:
            raise ExternalAPIException(
                "NanoBanana",
                "No API key configured. Provide a BYOK key or set NANOBANANA_API_KEY.",
            )

    # ------------------------------------------------------------------
    # Public API (synchronous -- intended for Celery tasks)
    # ------------------------------------------------------------------

    def generate_image(
        self,
        prompt: str,
        resolution: str = "2K",
        aspect_ratio: str = "16:9",
        reference_image_base64: str | None = None,
        edit_instruction: str | None = None,
    ) -> dict:
        """Generate an image via the NanoBanana API synchronously.

        Parameters
        ----------
        prompt:
            The text prompt describing the desired image.
        resolution:
            Target resolution tier: ``"1K"``, ``"2K"``, or ``"4K"``.
        aspect_ratio:
            Target aspect ratio string, e.g. ``"16:9"``.
        reference_image_base64:
            Optional base64-encoded reference image for image editing.
        edit_instruction:
            Optional natural-language edit instruction (used with reference image).

        Returns
        -------
        dict
            ``{"image_base64": str, "width": int, "height": int, "duration_ms": int}``

        Raises
        ------
        ExternalAPIException
            On any API communication failure.
        """
        width, height = self._calculate_dimensions(resolution, aspect_ratio)
        size_str = f"{width}x{height}"
        timeout = self.TIMEOUT_MAP.get(resolution, 600)

        # Build the request body (OpenAI-compatible format)
        body: dict = {
            "model": "gemini-3-pro-image-preview",
            "n": 1,
            "size": size_str,
            "aspect_ratio": aspect_ratio,
            "response_format": "b64_json",
        }

        # If a reference image is provided, use the edit endpoint pattern
        if reference_image_base64 is not None:
            # Build multimodal prompt that includes reference + instruction
            combined_prompt = prompt
            if edit_instruction:
                combined_prompt = (
                    f"{edit_instruction}\n\nOriginal prompt context: {prompt}"
                )

            body["prompt"] = combined_prompt
            # Include reference image as an input image
            body["image"] = reference_image_base64
        else:
            body["prompt"] = prompt

        endpoint = f"{self.api_base}/v1/images/generations"

        start_time = time.monotonic()

        try:
            with httpx.Client(timeout=float(timeout)) as client:
                response = client.post(
                    endpoint,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=body,
                )
                response.raise_for_status()
                result = response.json()
        except httpx.TimeoutException as exc:
            duration_ms = int((time.monotonic() - start_time) * 1000)
            logger.error(
                "NanoBanana API timeout after %d ms (resolution=%s): %s",
                duration_ms,
                resolution,
                exc,
            )
            raise ExternalAPIException(
                "NanoBanana",
                f"Image generation timed out after {duration_ms}ms "
                f"(resolution={resolution})",
            ) from exc
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            detail = exc.response.text[:500]
            logger.error("NanoBanana API HTTP %d: %s", status, detail)
            raise ExternalAPIException(
                "NanoBanana", f"HTTP {status}: {detail}"
            ) from exc
        except httpx.HTTPError as exc:
            logger.error("NanoBanana API error: %s", exc)
            raise ExternalAPIException("NanoBanana", str(exc)) from exc

        duration_ms = int((time.monotonic() - start_time) * 1000)

        # Extract image data from OpenAI-compatible response
        data_list = result.get("data", [])
        if not data_list:
            raise ExternalAPIException(
                "NanoBanana", "No image data returned in response"
            )

        image_data = data_list[0]
        image_base64 = image_data.get("b64_json", "")
        if not image_base64:
            raise ExternalAPIException(
                "NanoBanana", "Empty base64 image data in response"
            )

        logger.info(
            "NanoBanana image generated in %d ms: %dx%d (resolution=%s, aspect=%s)",
            duration_ms,
            width,
            height,
            resolution,
            aspect_ratio,
        )

        return {
            "image_base64": image_base64,
            "width": width,
            "height": height,
            "duration_ms": duration_ms,
        }

    # ------------------------------------------------------------------
    # Dimension calculation
    # ------------------------------------------------------------------

    def _calculate_dimensions(
        self, resolution: str, aspect_ratio: str
    ) -> tuple[int, int]:
        """Calculate actual pixel dimensions from resolution tier and aspect ratio.

        The resolution tier defines the total pixel area budget.  The aspect
        ratio is then applied to determine width and height that respect both
        constraints.

        For example, with ``resolution="2K"`` (base 2048x2048 = ~4.2M pixels)
        and ``aspect_ratio="16:9"``:
            area = 2048 * 2048 = 4_194_304
            h = sqrt(area / (16/9)) = sqrt(4_194_304 * 9/16) ~ 1536
            w = h * 16/9 ~ 2731
        Values are then rounded to the nearest multiple of 8 (common for
        diffusion models).
        """
        base = self.RESOLUTION_MAP.get(resolution)
        if base is None:
            base = self.RESOLUTION_MAP["2K"]

        ratio = self.ASPECT_RATIO_MAP.get(aspect_ratio)
        if ratio is None:
            ratio = (16, 9)

        rw, rh = ratio
        area = base["width"] * base["height"]

        # height = sqrt(area * rh / rw), width = height * rw / rh
        height = math.sqrt(area * rh / rw)
        width = height * rw / rh

        # Round to nearest multiple of 8
        width = max(8, round(width / 8) * 8)
        height = max(8, round(height / 8) * 8)

        return width, height

    # ------------------------------------------------------------------
    # Utility
    # ------------------------------------------------------------------

    @staticmethod
    def image_bytes_from_base64(b64_string: str) -> bytes:
        """Decode a base64-encoded image string to raw bytes."""
        return base64.b64decode(b64_string)

    @staticmethod
    def image_size_bytes(b64_string: str) -> int:
        """Estimate the decoded byte size of a base64 image string."""
        # base64 encodes 3 bytes into 4 chars; padding may add 1-2 '=' chars
        padding = b64_string.count("=")
        return (len(b64_string) * 3) // 4 - padding
