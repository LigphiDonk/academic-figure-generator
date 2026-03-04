"""Prompt generation and management endpoints."""

from uuid import UUID
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    BadRequestException,
    ForbiddenException,
    NotFoundException,
)
from app.dependencies import get_current_active_user, get_db
from app.models.document import Document
from app.models.project import Project
from app.models.prompt import Prompt
from app.models.user import User
from app.schemas.common import TaskStatusResponse
from app.schemas.prompt import (
    PromptGenerateRequest,
    PromptResponse,
    PromptStatusResponse,
    PromptUpdate,
)
from app.tasks.celery_app import celery_app

router = APIRouter(prefix="", tags=["Prompts"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_owned_project(
    project_id: UUID, user: User, db: AsyncSession
) -> Project:
    result = await db.execute(select(Project).where(Project.id == project_id))
    project: Project | None = result.scalar_one_or_none()
    if project is None or project.status == "deleted":
        raise NotFoundException("Project not found")
    if project.user_id != user.id:
        raise ForbiddenException("Not your project")
    return project


async def _get_owned_prompt(
    prompt_id: UUID, user: User, db: AsyncSession
) -> Prompt:
    result = await db.execute(select(Prompt).where(Prompt.id == prompt_id))
    prompt: Prompt | None = result.scalar_one_or_none()
    if prompt is None:
        raise NotFoundException("Prompt not found")
    if prompt.user_id != user.id:
        raise ForbiddenException("Not your prompt")
    return prompt


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/projects/{project_id}/prompts/generate",
    response_model=TaskStatusResponse,
    status_code=202,
)
async def generate_prompts(
    project_id: UUID,
    data: PromptGenerateRequest,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger asynchronous prompt generation for a project.

    Requires at least one parsed document attached to the project.
    Returns a Celery task ID for status polling.
    """
    project = await _get_owned_project(project_id, user, db)

    if Decimal(str(user.balance_cny)) <= Decimal("0"):
        raise BadRequestException(
            f"余额不足：当前余额 ¥{float(user.balance_cny):.2f}。"
            "请联系管理员充值后再生成提示词。"
        )

    # Find the most recent completed document for this project
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
            "No parsed document found for this project. Upload and wait for parsing first."
        )

    # Dispatch Celery task
    task = celery_app.send_task(
        "app.tasks.prompt_tasks.generate_prompts_task",
        args=[str(project.id), str(document.id), str(user.id)],
        kwargs={
            "section_indices": data.section_indices,
            "color_scheme": data.color_scheme,
            "custom_colors": data.custom_colors,
            "figure_types": data.figure_types,
            "user_request": data.user_request,
            "max_figures": data.max_figures,
            "template_mode": data.template_mode,
        },
        queue="prompts",
    )

    return TaskStatusResponse(task_id=task.id, status="pending")


@router.get("/projects/{project_id}/prompts", response_model=list[PromptResponse])
async def list_project_prompts(
    project_id: UUID,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """List all prompts for a project, ordered by figure number."""
    await _get_owned_project(project_id, user, db)

    result = await db.execute(
        select(Prompt)
        .where(Prompt.project_id == project_id)
        .order_by(Prompt.figure_number.asc())
    )
    prompts = result.scalars().all()

    return [
        PromptResponse(
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
        for p in prompts
    ]


@router.get("/prompts/{prompt_id}", response_model=PromptResponse)
async def get_prompt(
    prompt_id: UUID,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single prompt's detail."""
    prompt = await _get_owned_prompt(prompt_id, user, db)
    return PromptResponse(
        id=prompt.id,
        project_id=prompt.project_id,
        document_id=prompt.document_id,
        figure_number=prompt.figure_number,
        title=prompt.title,
        original_prompt=prompt.original_prompt,
        edited_prompt=prompt.edited_prompt,
        active_prompt=prompt.active_prompt,
        suggested_figure_type=prompt.suggested_figure_type,
        suggested_aspect_ratio=prompt.suggested_aspect_ratio,
        source_sections=prompt.source_sections,
        claude_model=prompt.claude_model,
        generation_status=prompt.generation_status,
        created_at=prompt.created_at,
        updated_at=prompt.updated_at,
    )


@router.put("/prompts/{prompt_id}", response_model=PromptResponse)
async def update_prompt(
    prompt_id: UUID,
    data: PromptUpdate,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Update the user-edited prompt text."""
    prompt = await _get_owned_prompt(prompt_id, user, db)
    prompt.edited_prompt = data.edited_prompt
    db.add(prompt)
    await db.flush()
    await db.refresh(prompt)

    return PromptResponse(
        id=prompt.id,
        project_id=prompt.project_id,
        document_id=prompt.document_id,
        figure_number=prompt.figure_number,
        title=prompt.title,
        original_prompt=prompt.original_prompt,
        edited_prompt=prompt.edited_prompt,
        active_prompt=prompt.active_prompt,
        suggested_figure_type=prompt.suggested_figure_type,
        suggested_aspect_ratio=prompt.suggested_aspect_ratio,
        source_sections=prompt.source_sections,
        claude_model=prompt.claude_model,
        generation_status=prompt.generation_status,
        created_at=prompt.created_at,
        updated_at=prompt.updated_at,
    )


@router.get("/prompts/{prompt_id}/status", response_model=PromptStatusResponse)
async def get_prompt_status(
    prompt_id: UUID,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Poll a prompt's generation status."""
    prompt = await _get_owned_prompt(prompt_id, user, db)
    return PromptStatusResponse(
        id=prompt.id,
        generation_status=prompt.generation_status,
        generation_task_id=prompt.generation_task_id,
    )
