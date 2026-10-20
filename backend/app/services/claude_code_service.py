"""Claude Code SDK integration for generating academic figure prompts.

Uses the claude-agent-sdk Python package to call Claude with the
academic-figure-prompt SKILL.md injected as system_prompt.
"""

from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.core.exceptions import ExternalAPIException
from app.services.reference_search import REFERENCE_INSTRUCTIONS, reference_search_options

logger = logging.getLogger(__name__)

# Path to SKILL.md relative to project root
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_SKILL_PATH = _PROJECT_ROOT / "academic-figure-prompt" / "SKILL.md"


def _load_skill_content() -> str:
    """Load the academic-figure-prompt SKILL.md content."""
    if not _SKILL_PATH.exists():
        logger.warning("SKILL.md not found at %s", _SKILL_PATH)
        return ""
    return _SKILL_PATH.read_text(encoding="utf-8")


class ClaudeCodeService:
    """Integration with Claude via the Agent SDK for generating figure prompts."""

    def __init__(self) -> None:
        self.skill_content = _load_skill_content()
        if not self.skill_content:
            logger.warning("No SKILL.md content loaded — prompts may be generic.")

    async def generate_figure_prompts(
        self,
        sections: list[dict],
        color_scheme: dict,
        paper_field: str | None = None,
        figure_types: list[str] | None = None,
        user_request: str | None = None,
        max_figures: int | None = None,
        use_web_references: bool = True,
    ) -> dict:
        """Call Claude via Agent SDK to generate figure prompts.

        Returns:
            dict with keys: figures, duration_ms
        """
        from claude_agent_sdk import (  # noqa: PLC0415
            AssistantMessage,
            ClaudeAgentOptions,
            ResultMessage,
            query,
        )

        user_prompt = self._build_user_message(
            sections=sections,
            color_scheme=color_scheme,
            paper_field=paper_field,
            figure_types=figure_types,
            user_request=user_request,
            max_figures=max_figures,
        )

        start_time = time.monotonic()
        result_text = ""
        settings = get_settings()
        references_enabled = settings.WEB_REFERENCES_ENABLED and use_web_references
        search_options = (
            reference_search_options(settings.WEB_REFERENCES_TIMEOUT_SECONDS)
            if references_enabled
            else {}
        )
        system_prompt = self.skill_content
        if references_enabled:
            system_prompt += "\n" + REFERENCE_INSTRUCTIONS

        try:
            async for message in query(
                prompt=user_prompt,
                options=ClaudeAgentOptions(
                    system_prompt=system_prompt,
                    permission_mode="acceptEdits",
                    **search_options,
                ),
            ):
                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if hasattr(block, "text"):
                            result_text += block.text
                elif isinstance(message, ResultMessage):
                    logger.info("Claude query completed: %s", message.subtype)
                    if message.is_error:
                        raise RuntimeError(f"Claude query failed: {message.subtype}")
                    # Intermediate assistant text may precede tool calls. Prefer the
                    # SDK's final answer when parsing the structured figure output.
                    if message.result:
                        result_text = message.result

        except Exception as exc:
            duration_ms = int((time.monotonic() - start_time) * 1000)
            logger.error("Claude Agent SDK error after %d ms: %s", duration_ms, exc)
            raise ExternalAPIException("Claude", f"Agent SDK error: {exc}") from exc

        duration_ms = int((time.monotonic() - start_time) * 1000)
        figures = self._parse_figures_response(result_text)

        logger.info(
            "Claude SDK call completed in %d ms: %d figures",
            duration_ms,
            len(figures),
        )

        return {
            "figures": figures,
            "duration_ms": duration_ms,
        }

    def _build_user_message(
        self,
        sections: list[dict],
        color_scheme: dict,
        paper_field: str | None,
        figure_types: list[str] | None = None,
        user_request: str | None = None,
        max_figures: int | None = None,
    ) -> str:
        """Build the user message with paper sections and color palette."""
        parts: list[str] = []

        if paper_field:
            parts.append(f"**Academic Field:** {paper_field}\n")

        # Color palette
        parts.append("**Color Palette to Use:**")
        color_block = json.dumps(color_scheme, indent=2)
        parts.append(f"```json\n{color_block}\n```")
        parts.append("")

        # Figure types
        if figure_types:
            parts.append("**Preferred figure types:**")
            for ft in figure_types:
                parts.append(f"  - {ft}")
            parts.append("")

        # User request
        if user_request and user_request.strip():
            parts.append(f"**User Request (highest priority):**\n{user_request.strip()}\n")

        # Max figures
        if max_figures is not None and max_figures > 0:
            parts.append(f"**Generate at most {max_figures} figure prompt(s).**\n")

        # Paper content
        parts.append("--- PAPER SECTIONS ---\n")
        for i, section in enumerate(sections, 1):
            title = section.get("title", f"Section {i}")
            content = section.get("content", section.get("text", ""))

            # Truncate very long sections
            max_section_chars = 8000
            if len(content) > max_section_chars:
                content = content[:max_section_chars] + "\n[... section truncated ...]"

            parts.append(f"## Section {i}: {title}")
            parts.append(content)
            parts.append("")

        parts.append("--- END OF PAPER ---\n")
        parts.append(
            "Generate figure prompts that best match the paper content. "
            "Return ONLY valid JSON array. "
            "Each prompt field must be at least 500 words and extremely precise."
        )

        return "\n".join(parts)

    def _parse_figures_response(self, text: str) -> list[dict]:
        """Extract and validate the JSON array of figure dicts from Claude's response."""
        if not text or not text.strip():
            logger.warning("Empty response from Claude")
            return []

        cleaned = text.strip()

        # Strip markdown code fences if present
        if cleaned.startswith("```"):
            first_newline = cleaned.index("\n") if "\n" in cleaned else len(cleaned)
            cleaned = cleaned[first_newline + 1 :]
            if cleaned.rstrip().endswith("```"):
                cleaned = cleaned.rstrip()[:-3].rstrip()

        # Try direct parse
        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, list):
                return self._validate_figures(parsed)
        except json.JSONDecodeError:
            pass

        # Fallback: search for JSON array
        match = re.search(r"\[[\s\S]*\]", cleaned)
        if match:
            try:
                parsed = json.loads(match.group())
                if isinstance(parsed, list):
                    return self._validate_figures(parsed)
            except json.JSONDecodeError:
                pass

        logger.warning("Could not parse JSON figures from Claude response")
        return []

    @staticmethod
    def _validate_figures(figures: list) -> list[dict]:
        """Validate and normalize the list of figure dicts."""
        valid: list[dict] = []
        for i, fig in enumerate(figures):
            if not isinstance(fig, dict):
                logger.warning("Skipping non-dict figure at index %d", i)
                continue

            validated: dict[str, Any] = {
                "figure_number": fig.get("figure_number", i + 1),
                "title": fig.get("title", f"Figure {i + 1}"),
                "suggested_figure_type": fig.get(
                    "suggested_figure_type", fig.get("figure_type", "diagram")
                ),
                "suggested_aspect_ratio": fig.get("suggested_aspect_ratio", "16:9"),
                "prompt": fig.get("prompt", ""),
                "source_section_titles": fig.get("source_section_titles", []),
                "rationale": fig.get("rationale", ""),
            }

            if not validated["prompt"]:
                logger.warning("Skipping figure %d: empty prompt", validated["figure_number"])
                continue

            valid.append(validated)

        return valid
