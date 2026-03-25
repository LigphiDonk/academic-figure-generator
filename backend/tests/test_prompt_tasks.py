from __future__ import annotations

import json

import pytest

from app.tasks.prompt_tasks import _parse_figure_prompts


def test_parse_figure_prompts_accepts_valid_json_array() -> None:
    raw = json.dumps(
        [
            {
                "title": "Figure 1",
                "prompt": "A clean valid prompt.",
            }
        ]
    )

    figures = _parse_figure_prompts(raw)

    assert figures == [{"title": "Figure 1", "prompt": "A clean valid prompt."}]


def test_parse_figure_prompts_repairs_unescaped_newlines_inside_string_values() -> None:
    raw = """[
  {
    "title": "Figure 1",
    "prompt": "Stage 1: Input Query & Environment

Stage 2: Retriever / Extractor"
  }
]"""

    figures = _parse_figure_prompts(raw)

    assert len(figures) == 1
    assert figures[0]["title"] == "Figure 1"
    assert figures[0]["prompt"] == (
        "Stage 1: Input Query & Environment\n\n"
        "Stage 2: Retriever / Extractor"
    )


def test_parse_figure_prompts_still_rejects_structurally_invalid_json() -> None:
    raw = '[{"title":"Figure 1","prompt":"missing brace"}'

    with pytest.raises(json.JSONDecodeError):
        _parse_figure_prompts(raw)
