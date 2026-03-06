"""PaddleOCR layout-parsing service.

Calls the user-configured PaddleOCR-VL REST API, converts the returned
per-page Markdown into the same ``sections`` structure used by the existing
DocumentService parsers, and stores the raw combined Markdown on the Document.

API contract (aistudio-style deployment):
    POST {server_url}/layout-parsing
    Authorization: token {token}
    Body: {"file": <base64>, "fileType": 0 (PDF) | 1 (image), ...}
    Response: {"result": {"layoutParsingResults": [{"markdown": {"text": str}}, ...]}}
"""

from __future__ import annotations

import base64
import logging
import re

import httpx

logger = logging.getLogger(__name__)

# Timeout in seconds for the PaddleOCR API call (large PDFs can be slow)
_OCR_TIMEOUT = 300.0


class OCRService:
    """Call PaddleOCR API and convert results to structured sections."""

    def call_api(
        self,
        file_bytes: bytes,
        server_url: str,
        token: str,
        file_type: int = 0,
    ) -> list[str]:
        """POST file to PaddleOCR API and return per-page Markdown texts.

        Parameters
        ----------
        file_bytes:
            Raw bytes of the PDF or image file.
        server_url:
            Base URL of the PaddleOCR deployment (without trailing slash).
            The endpoint ``/layout-parsing`` will be appended automatically.
        token:
            PaddleOCR access token (sent as ``Authorization: token <token>``).
        file_type:
            0 = PDF, 1 = image (default: 0).

        Returns
        -------
        list[str]
            One Markdown string per page / result entry.

        Raises
        ------
        RuntimeError
            On non-200 responses or unexpected payload structure.
        """
        normalized_url = server_url.rstrip("/")
        endpoint = (
            normalized_url
            if normalized_url.endswith("/layout-parsing")
            else normalized_url + "/layout-parsing"
        )
        encoded = base64.b64encode(file_bytes).decode("ascii")

        payload = {
            "file": encoded,
            "fileType": file_type,
            "useDocOrientationClassify": False,
            "useDocUnwarping": False,
            "useChartRecognition": False,
        }
        headers = {
            "Authorization": f"token {token}",
            "Content-Type": "application/json",
        }

        logger.info("Calling PaddleOCR API at %s (file_type=%d)", endpoint, file_type)
        with httpx.Client(timeout=_OCR_TIMEOUT) as client:
            resp = client.post(endpoint, json=payload, headers=headers)

        if resp.status_code != 200:
            raise RuntimeError(
                f"PaddleOCR API returned HTTP {resp.status_code}: {resp.text[:500]}"
            )

        try:
            results = resp.json()["result"]["layoutParsingResults"]
        except (KeyError, TypeError) as exc:
            raise RuntimeError(
                f"Unexpected PaddleOCR response structure: {exc}"
            ) from exc

        pages: list[str] = [r["markdown"]["text"] for r in results]
        logger.info("PaddleOCR returned %d page(s) of Markdown", len(pages))
        return pages

    def markdown_to_sections(self, markdown: str) -> list[dict]:
        """Convert combined OCR Markdown into a structured sections list.

        Mirrors the logic in ``DocumentService.parse_txt`` but is optimised
        for the richer Markdown that PaddleOCR produces (headings, tables,
        formulas).  Returns the same dict schema expected by the DB JSONB
        column::

            [
                {
                    "title": str,
                    "level": int,           # 1–6
                    "content": str,
                    "page_start": None,
                    "page_end": None,
                },
                ...
            ]
        """
        heading_pattern = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)
        headings = list(heading_pattern.finditer(markdown))

        sections: list[dict] = []

        if headings:
            for i, match in enumerate(headings):
                level = len(match.group(1))
                title = match.group(2).strip()
                start = match.end()
                end = headings[i + 1].start() if i + 1 < len(headings) else len(markdown)
                content = markdown[start:end].strip()

                # Capture any preamble text before the first heading
                if i == 0 and match.start() > 0:
                    preamble = markdown[: match.start()].strip()
                    if preamble:
                        sections.append(
                            {
                                "title": "摘要 / Preamble",
                                "level": 1,
                                "content": preamble,
                                "page_start": None,
                                "page_end": None,
                            }
                        )

                sections.append(
                    {
                        "title": title,
                        "level": level,
                        "content": content,
                        "page_start": None,
                        "page_end": None,
                    }
                )
        else:
            # No headings found – split by double newlines into paragraphs
            blocks = [b.strip() for b in re.split(r"\n\s*\n", markdown) if b.strip()]
            chunk_size = max(1, len(blocks) // 10) if len(blocks) > 10 else 1
            for i in range(0, len(blocks), chunk_size):
                chunk = blocks[i : i + chunk_size]
                combined = "\n\n".join(chunk)
                first_line = chunk[0].split("\n")[0][:80]
                sections.append(
                    {
                        "title": first_line if len(blocks) > 1 else "全文",
                        "level": 1,
                        "content": combined,
                        "page_start": None,
                        "page_end": None,
                    }
                )

        return sections

    def process(
        self,
        file_bytes: bytes,
        server_url: str,
        token: str,
        file_type: int = 0,
    ) -> dict:
        """Run OCR and return the structured parse result.

        Returns
        -------
        dict
            ``{"full_text": str, "sections": list[dict], "page_count": int | None,
               "ocr_markdown": str}``
        """
        pages = self.call_api(file_bytes, server_url, token, file_type)
        combined_markdown = "\n\n".join(pages)
        sections = self.markdown_to_sections(combined_markdown)

        return {
            "full_text": combined_markdown,
            "sections": sections,
            "page_count": len(pages) if pages else None,
            "ocr_markdown": combined_markdown,
        }
