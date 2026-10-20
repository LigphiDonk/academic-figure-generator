"""Prompt generation and management endpoints — personal-use (no auth, no Celery)."""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestException, NotFoundException
from app.dependencies import get_db
from app.models.document import Document
from app.models.project import Project
from app.models.prompt import Prompt
from app.schemas.prompt import (
    PromptGenerateRequest,
    PromptResponse,
    PromptStatusResponse,
    PromptUpdate,
)
from app.services.claude_code_service import ClaudeCodeService
from app.services.prompt_service import PromptService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="", tags=["Prompts"])


async def _get_project(project_id: str, db: AsyncSession) -> Project:
    result = await db.execute(select(Project).where(Project.id == project_id))
    project: Project | None = result.scalar_one_or_none()
    if project is None or project.status == "deleted":
        raise NotFoundException("Project not found")
    return project


def _prompt_to_response(p: Prompt) -> PromptResponse:
    return PromptResponse(
        id=p.id,
        project_id=p.project_id,
        document_id=p.document_id,
        figure_number=p.figure_number,
        title=p.title,
        original_prompt=p.original_prompt,
        edited_prompt=p.edited_prompt,
        active_prompt=p.active_prompt,
        suggested_figure_type=p.suggested_figure_type,
        suggested_aspect_ratio=p.suggested_aspect_ratio,
        source_sections=p.source_sections,
        claude_model=p.claude_model,
        generation_status=p.generation_status,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


@router.post(
    "/projects/{project_id}/prompts/generate",
    response_model=list[PromptResponse],
    status_code=201,
)
async def generate_prompts(
    project_id: str,
    data: PromptGenerateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate figure prompts via Claude Agent SDK (synchronous).

    Requires at least one parsed document attached to the project.
    """
    project = await _get_project(project_id, db)

    # Find the most recent completed document
    result = await db.execute(
        select(Document)
        .where(
            Document.project_id == project.id,
            Document.parse_status == "completed",
        )
        .order_by(Document.created_at.desc())
        .limit(1)
    )
    document: Document | None = result.scalar_one_or_none()
    if document is None:
        raise BadRequestException(
            "No parsed document found for this project. Upload a document first."
        )

    # Get sections
    sections = document.sections or []
    if data.section_indices:
        sections = [s for i, s in enumerate(sections) if i in data.section_indices]

    if not sections:
        raise BadRequestException("No sections available for prompt generation.")

    # Resolve color scheme
    from app.core.prompts.color_schemes import PRESET_COLOR_SCHEMES  # noqa: PLC0415

    color_scheme = data.custom_colors or PRESET_COLOR_SCHEMES.get(data.color_scheme, {})

    # Call Claude via Agent SDK
    claude_service = ClaudeCodeService()
    result_data = await claude_service.generate_figure_prompts(
        sections=sections,
        color_scheme=color_scheme,
        paper_field=project.paper_field,
        figure_types=data.figure_types,
        user_request=data.user_request,
        max_figures=data.max_figures,
        use_web_references=data.use_web_references,
    )

    figures = result_data.get("figures", [])
    if not figures:
        raise BadRequestException("Claude did not generate any figure prompts. Try again.")

    # Save to DB
    prompt_service = PromptService(db)
    prompts = await prompt_service.create_prompts_from_figures(
        project_id=project.id,
        document_id=document.id,
        figures=figures,
        claude_model="claude-agent-sdk",
    )

    logger.info(
        "Generated %d prompts for project %s in %d ms",
        len(prompts),
        project.id,
        result_data.get("duration_ms", 0),
    )

    return [_prompt_to_response(p) for p in prompts]


@router.get("/projects/{project_id}/prompts", response_model=list[PromptResponse])
async def list_project_prompts(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    await _get_project(project_id, db)
    result = await db.execute(
        select(Prompt)
        .where(Prompt.project_id == project_id)
        .order_by(Prompt.figure_number.asc())
    )
    return [_prompt_to_response(p) for p in result.scalars().all()]


@router.get("/prompts/{prompt_id}", response_model=PromptResponse)
async def get_prompt(
    prompt_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Prompt).where(Prompt.id == prompt_id))
    prompt: Prompt | None = result.scalar_one_or_none()
    if prompt is None:
        raise NotFoundException("Prompt not found")
    return _prompt_to_response(prompt)


@router.put("/prompts/{prompt_id}", response_model=PromptResponse)
async def update_prompt(
    prompt_id: str,
    data: PromptUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Prompt).where(Prompt.id == prompt_id))
    prompt: Prompt | None = result.scalar_one_or_none()
    if prompt is None:
        raise NotFoundException("Prompt not found")

    prompt.edited_prompt = data.edited_prompt
    db.add(prompt)
    await db.flush()
    await db.refresh(prompt)
    return _prompt_to_response(prompt)


@router.get("/prompts/{prompt_id}/status", response_model=PromptStatusResponse)
async def get_prompt_status(
    prompt_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Prompt).where(Prompt.id == prompt_id))
    prompt: Prompt | None = result.scalar_one_or_none()
    if prompt is None:
        raise NotFoundException("Prompt not found")
    return PromptStatusResponse(
        id=prompt.id,
        generation_status=prompt.generation_status,
    )
