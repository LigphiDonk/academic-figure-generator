"""Exercise generation options, conversation ownership, and saved reference output."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import Settings
from app.core.exceptions import ExternalAPIException
from app.models.base import Base
from app.schemas.prompt import PromptGenerateRequest
from app.services.claude_code_service import ClaudeCodeService
from app.services.prompt_service import PromptService
from app.services.reference_search import MCP_URL, TOOLS, USER_AGENT


@pytest.fixture
def settings(monkeypatch):
    monkeypatch.delenv("WEB_REFERENCES_ENABLED", raising=False)
    monkeypatch.delenv("WEB_REFERENCES_TIMEOUT_SECONDS", raising=False)
    value = Settings(_env_file=None)
    monkeypatch.setattr("app.services.claude_code_service.get_settings", lambda: value)
    monkeypatch.delenv("MCP_TOOL_TIMEOUT", raising=False)
    return value


def result_message(text, *, is_error=False):
    return ResultMessage(
        subtype="error_during_execution" if is_error else "success",
        duration_ms=1,
        duration_api_ms=1,
        is_error=is_error,
        num_turns=1,
        session_id="sdk-conversation",
        result=text,
    )


async def generate(service, **kwargs):
    return await service.generate_figure_prompts(
        sections=[{"title": "Methods", "content": "A standard attention layer."}],
        color_scheme={"primary": "#0072B2"},
        **kwargs,
    )


async def test_generation_owns_session_and_persists_references(monkeypatch, settings):
    calls = []
    source = "https://arxiv.org/abs/1706.03762"

    async def query(*, prompt, options):
        assert "Methods" in prompt
        assert options.permission_mode == "acceptEdits"
        assert options.allowed_tools == TOOLS
        assert options.mcp_servers == {
            "figure_references": {
                "type": "http",
                "url": MCP_URL,
                "headers": {"User-Agent": USER_AGENT},
            }
        }
        assert options.env["MCP_TOOL_TIMEOUT"] == "30000"
        assert "never uploaded paper text" in options.system_prompt
        callback = options.hooks["PreToolUse"][0].hooks[0]
        ids = []
        # Search, fetch, follow-up and retry all pass through the production hook.
        for tool in [TOOLS[0], TOOLS[1], TOOLS[0], TOOLS[0]]:
            args = (
                {"urls": [source]}
                if tool == TOOLS[1]
                else {
                    "objective": "Clarify standard attention terminology",
                    "search_queries": ["attention original paper"],
                }
            )
            output = await callback(
                {"tool_name": tool, "tool_input": {**args, "session_id": "model-chosen"}},
                "tool-call",
                SimpleNamespace(),
            )
            updated = output["hookSpecificOutput"]["updatedInput"]
            assert {k: v for k, v in updated.items() if k != "session_id"} == args
            ids.append(updated["session_id"])
            await asyncio.sleep(0)
        assert len(set(ids)) == 1
        UUID(ids[0])
        assert await callback({"tool_name": "Read"}, None, SimpleNamespace()) == {}
        calls.append(ids[0])
        # An intermediate array must not displace the SDK final answer.
        yield AssistantMessage(
            content=[TextBlock(text="I will inspect [references].")], model="test"
        )
        yield result_message(
            json.dumps(
                [
                    {
                        "prompt": "Draw a standard attention layer grounded in Methods.",
                        "source_section_titles": ["Methods"],
                        "rationale": f"Terminology checked against {source}",
                    }
                ]
            )
        )

    monkeypatch.setattr("claude_agent_sdk.query", query)
    service = ClaudeCodeService()
    results = await asyncio.gather(generate(service), generate(service))
    await generate(service)  # New generation on the same service is a new conversation.
    assert len(set(calls)) == 3

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine)() as db:
        saved = await PromptService(db).create_prompts_from_figures(
            project_id="fixture-project", document_id=None, figures=results[0]["figures"]
        )
        assert saved[0].source_sections == {
            "titles": ["Methods"],
            "rationale": f"Terminology checked against {source}",
        }
    await engine.dispose()


@pytest.mark.parametrize("global_enabled,request_enabled", [(False, True), (True, False)])
async def test_disable_controls(monkeypatch, settings, global_enabled, request_enabled):
    settings.WEB_REFERENCES_ENABLED = global_enabled

    async def query(*, prompt, options):
        assert options.mcp_servers == {}
        assert options.allowed_tools == []
        assert options.hooks is None
        assert options.env == {}
        assert "Public scientific references" not in options.system_prompt
        yield result_message('[{"prompt":"Use uploaded sections only."}]')

    monkeypatch.setattr("claude_agent_sdk.query", query)
    assert (await generate(ClaudeCodeService(), use_web_references=request_enabled))["figures"]


async def test_explicit_timeout_preserved(monkeypatch, settings):
    monkeypatch.setenv("MCP_TOOL_TIMEOUT", "1234")

    async def query(*, prompt, options):
        assert options.env["MCP_TOOL_TIMEOUT"] == "1234"
        yield result_message('[{"prompt":"Paper grounded figure."}]')

    monkeypatch.setattr("claude_agent_sdk.query", query)
    await generate(ClaudeCodeService())


@pytest.mark.parametrize("error", [TimeoutError("lookup timeout"), RuntimeError("SDK failure")])
async def test_sdk_failures_surface(monkeypatch, settings, error):
    async def query(**kwargs):
        raise error
        yield  # Make the fixture an async generator.

    monkeypatch.setattr("claude_agent_sdk.query", query)
    with pytest.raises(ExternalAPIException, match=str(error)):
        await generate(ClaudeCodeService())


async def test_sdk_error_result_is_not_success(monkeypatch, settings):
    async def query(**kwargs):
        yield result_message("", is_error=True)

    monkeypatch.setattr("claude_agent_sdk.query", query)
    with pytest.raises(ExternalAPIException, match="error_during_execution"):
        await generate(ClaudeCodeService())


async def test_cancellation_propagates(monkeypatch, settings):
    started = asyncio.Event()
    closed = AsyncMock()

    async def query(**kwargs):
        try:
            started.set()
            await asyncio.Event().wait()
            yield result_message("")
        finally:
            await closed()

    monkeypatch.setattr("claude_agent_sdk.query", query)
    task = asyncio.create_task(generate(ClaudeCodeService()))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    closed.assert_awaited_once()


def test_request_and_settings_defaults(settings):
    assert PromptGenerateRequest().use_web_references is True
    assert PromptGenerateRequest(use_web_references=False).use_web_references is False
    assert settings.WEB_REFERENCES_ENABLED is True
    with pytest.raises(ValueError):
        Settings(_env_file=None, WEB_REFERENCES_TIMEOUT_SECONDS=0)


def test_saved_global_disable(tmp_path, monkeypatch):
    monkeypatch.delenv("WEB_REFERENCES_ENABLED", raising=False)
    config = tmp_path / ".env"
    config.write_text("WEB_REFERENCES_ENABLED=false\nWEB_REFERENCES_TIMEOUT_SECONDS=12\n")
    saved = Settings(_env_file=config)
    assert saved.WEB_REFERENCES_ENABLED is False
    assert saved.WEB_REFERENCES_TIMEOUT_SECONDS == 12


async def test_api_request_disable_and_saved_output(monkeypatch, settings):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.v1.prompts import router
    from app.dependencies import get_db
    from app.models.document import Document
    from app.models.project import Project

    seen = []

    async def query(*, prompt, options):
        seen.append(options)
        assert options.mcp_servers == {}
        yield result_message('[{"prompt":"A paper-grounded diagram.","rationale":"Methods only"}]')

    monkeypatch.setattr("claude_agent_sdk.query", query)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        project = Project(name="Fixture")
        db.add(project)
        await db.flush()
        db.add(
            Document(
                project_id=project.id,
                original_filename="paper.txt",
                file_type="txt",
                file_size_bytes=10,
                storage_path="unused",
                parse_status="completed",
                sections=[{"title": "Methods", "content": "An attention layer."}],
            )
        )
        await db.flush()
        app = FastAPI()
        app.include_router(router, prefix="/api/v1")

        async def dependency():
            yield db

        app.dependency_overrides[get_db] = dependency
        async with AsyncClient(transport=ASGITransport(app), base_url="http://test") as client:
            response = await client.post(
                f"/api/v1/projects/{project.id}/prompts/generate",
                json={"use_web_references": False},
            )
            assert response.status_code == 201, response.text
            assert response.json()[0]["source_sections"]["rationale"] == "Methods only"
        assert len(seen) == 1
    await engine.dispose()
