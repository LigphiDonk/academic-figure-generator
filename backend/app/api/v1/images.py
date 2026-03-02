"""Image generation, retrieval, editing, and SSE status streaming endpoints."""

import asyncio
import json
import logging
import mimetypes
from urllib.parse import quote
from uuid import UUID
from decimal import Decimal

from fastapi import APIRouter, Depends, Form, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.config import get_settings
from app.core.exceptions import (
    BadRequestException,
    ForbiddenException,
    NotFoundException,
)
from app.dependencies import get_current_active_user, get_db, get_storage_service
from app.models.image import Image
from app.models.project import Project
from app.models.prompt import Prompt
from app.models.system_settings import SystemSettings
from app.models.user import User
from app.schemas.image import (
    ImageDirectGenerateRequest,
    ImageGenerateRequest,
    ImageResponse,
    ImageStatusResponse,
)
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

router = APIRouter(prefix="", tags=["Images"])


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


async def _get_owned_image(
    image_id: UUID, user: User, db: AsyncSession
) -> Image:
    result = await db.execute(select(Image).where(Image.id == image_id))
    image: Image | None = result.scalar_one_or_none()
    if image is None:
        raise NotFoundException("Image not found")
    if image.user_id != user.id:
        raise ForbiddenException("Not your image")
    return image


def _image_to_response(image: Image, download_url: str | None = None) -> ImageResponse:
    return ImageResponse(
        id=image.id,
        prompt_id=image.prompt_id,
        project_id=image.project_id,
        resolution=image.resolution,
        aspect_ratio=image.aspect_ratio,
        color_scheme=image.color_scheme,
        storage_path=image.storage_path,
        file_size_bytes=image.file_size_bytes,
        width_px=image.width_px,
        height_px=image.height_px,
        generation_status=image.generation_status,
        generation_duration_ms=image.generation_duration_ms,
        generation_error=image.generation_error,
        retry_count=image.retry_count,
        download_url=download_url,
        created_at=image.created_at,
    )


def _normalize_object_name(storage_path: str, bucket: str) -> str:
    """Normalize stored path to a MinIO object name.

    Backward compatible with older values that were stored as "<bucket>/<object>".
    """
    p = storage_path.lstrip("/")
    prefix = f"{bucket}/"
    if p.startswith(prefix):
        return p[len(prefix) :]
    return p

async def _ensure_nanobanana_key_available(user: User, db: AsyncSession) -> None:
    """Fail fast if neither BYOK nor platform NanoBanana key is configured."""
    settings = get_settings()
    if user.nanobanana_api_key_enc:
        return
    if settings.NANOBANANA_API_KEY:
        return
    system_key = (
        await db.execute(
            select(SystemSettings.nanobanana_api_key_enc).where(SystemSettings.id == 1)
        )
    ).scalar_one_or_none()
    if system_key:
        return
    raise BadRequestException(
        "未配置图片生成 Key：请在服务器环境变量设置 NANOBANANA_API_KEY，"
        "或在管理员系统设置中配置系统 Key，"
        "或在用户设置中填写 BYOK（NanoBanana API Key）。"
    )

async def _get_image_price_cny(db: AsyncSession) -> Decimal:
    """Return current per-image price in CNY (defaults to 1.5)."""
    v = (
        await db.execute(
            select(SystemSettings.image_price_cny).where(SystemSettings.id == 1)
        )
    ).scalar_one_or_none()
    if v is None:
        return Decimal("1.5")
    return Decimal(str(v))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/prompts/{prompt_id}/images/generate",
    response_model=ImageStatusResponse,
    status_code=202,
)
async def generate_image_from_prompt(
    prompt_id: UUID,
    data: ImageGenerateRequest,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate an image from an existing prompt.

    Creates an Image record in pending state and dispatches a Celery task.
    """
    prompt = await _get_owned_prompt(prompt_id, user, db)
    await _ensure_nanobanana_key_available(user, db)

    image_price_cny = await _get_image_price_cny(db)
    if Decimal(str(user.balance_cny)) < image_price_cny:
        raise BadRequestException(
            f"余额不足：当前余额 ¥{float(user.balance_cny):.2f}，"
            f"生成 1 张图片需要 ¥{float(image_price_cny):.2f}。"
        )

    if not prompt.active_prompt:
        raise BadRequestException(
            "Prompt has no text. Generate or edit the prompt first."
        )

    image = Image(
        prompt_id=prompt.id,
        project_id=prompt.project_id,
        user_id=user.id,
        resolution=data.resolution,
        aspect_ratio=data.aspect_ratio,
        color_scheme=data.color_scheme,
        generation_status="pending",
    )
    db.add(image)
    await db.flush()
    await db.refresh(image)

    task = celery_app.send_task(
        "app.tasks.image_tasks.generate_image_task",
        args=[
            str(image.id),
            prompt.active_prompt,
            str(user.id),
            data.resolution,
            data.aspect_ratio,
            data.color_scheme,
            None,  # reference_image_path
            None,  # edit_instruction
        ],
        queue="images",
    )

    # Persist the task id
    image.generation_task_id = task.id
    db.add(image)

    return ImageStatusResponse(
        id=image.id,
        generation_status=image.generation_status,
        generation_task_id=task.id,
    )


@router.post(
    "/images/generate-direct",
    response_model=ImageStatusResponse,
    status_code=202,
)
async def generate_image_direct(
    data: ImageDirectGenerateRequest,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate an image from custom prompt text (no linked Prompt record).

    If project_id is not provided, a default project is auto-created for the user.
    """
    project_id = data.project_id
    await _ensure_nanobanana_key_available(user, db)

    image_price_cny = await _get_image_price_cny(db)
    if Decimal(str(user.balance_cny)) < image_price_cny:
        raise BadRequestException(
            f"余额不足：当前余额 ¥{float(user.balance_cny):.2f}，"
            f"生成 1 张图片需要 ¥{float(image_price_cny):.2f}。"
        )

    if project_id is None:
        # Auto-create or reuse a default project for direct generation
        result = await db.execute(
            select(Project).where(
                Project.user_id == user.id,
                Project.name == "直接生成",
                Project.status == "active",
            )
        )
        project = result.scalar_one_or_none()
        if project is None:
            project = Project(
                user_id=user.id,
                name="直接生成",
                description="通过直接生成模式创建的图片",
            )
            db.add(project)
            await db.flush()
            await db.refresh(project)
        project_id = project.id
    else:
        await _get_owned_project(project_id, user, db)

    image = Image(
        prompt_id=None,
        project_id=project_id,
        user_id=user.id,
        resolution=data.resolution,
        aspect_ratio=data.aspect_ratio,
        color_scheme=data.color_scheme,
        final_prompt_sent=data.prompt,
        generation_status="pending",
    )
    db.add(image)
    await db.flush()
    await db.refresh(image)

    task = celery_app.send_task(
        "app.tasks.image_tasks.generate_image_task",
        args=[
            str(image.id),
            data.prompt,
            str(user.id),
            data.resolution,
            data.aspect_ratio,
            data.color_scheme,
            None,  # reference_image_path
            None,  # edit_instruction
        ],
        queue="images",
    )

    image.generation_task_id = task.id
    db.add(image)

    return ImageStatusResponse(
        id=image.id,
        generation_status=image.generation_status,
        generation_task_id=task.id,
    )


@router.get("/projects/{project_id}/images", response_model=list[ImageResponse])
async def list_project_images(
    project_id: UUID,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """List all images for a project, newest first."""
    await _get_owned_project(project_id, user, db)

    result = await db.execute(
        select(Image)
        .where(Image.project_id == project_id)
        .order_by(Image.created_at.desc())
    )
    images = result.scalars().all()
    return [_image_to_response(img) for img in images]


@router.get("/images/{image_id}", response_model=ImageResponse)
async def get_image(
    image_id: UUID,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
    storage=Depends(get_storage_service),
):
    """Get image metadata and a presigned download URL from MinIO."""
    image = await _get_owned_image(image_id, user, db)

    download_url: str | None = None
    if image.storage_path:
        # Always serve via API so browsers don't need to resolve `minio:9000`.
        download_url = f"{get_settings().API_V1_PREFIX}/images/{image.id}/download"

    return _image_to_response(image, download_url=download_url)


@router.get("/images/{image_id}/download")
async def download_image(
    image_id: UUID,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
    storage=Depends(get_storage_service),
):
    """Download an image file via the API (proxy from MinIO)."""
    image = await _get_owned_image(image_id, user, db)
    if not image.storage_path:
        raise NotFoundException("Image file not available")

    object_name = _normalize_object_name(image.storage_path, storage.bucket)
    file_bytes = storage.download_file(object_name)

    guessed_type, _ = mimetypes.guess_type(object_name)
    media_type = guessed_type or "application/octet-stream"
    filename = object_name.split("/")[-1] or f"{image_id}"

    # Use inline so <img src="..."> can render; browsers can still save via download attribute.
    quoted = quote(filename)
    headers = {"Content-Disposition": f"inline; filename*=UTF-8''{quoted}"}
    return StreamingResponse(iter([file_bytes]), media_type=media_type, headers=headers)


@router.get("/images/{image_id}/status", response_model=ImageStatusResponse)
async def get_image_status(
    image_id: UUID,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Poll an image's generation status."""
    image = await _get_owned_image(image_id, user, db)
    return ImageStatusResponse(
        id=image.id,
        generation_status=image.generation_status,
        generation_task_id=image.generation_task_id,
        generation_error=image.generation_error,
    )


@router.post(
    "/images/{image_id}/edit",
    response_model=ImageStatusResponse,
    status_code=202,
)
async def edit_image(
    image_id: UUID,
    edit_instruction: str = Form(...),
    reference_image: UploadFile = None,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
    storage=Depends(get_storage_service),
):
    """Image-to-image editing.

    Uploads the reference image (or uses the existing image) and dispatches
    a Celery task that sends both the reference and edit instruction to the
    image generation API.
    """
    source_image = await _get_owned_image(image_id, user, db)
    await _ensure_nanobanana_key_available(user, db)

    # Determine the reference image path
    reference_path: str | None = source_image.storage_path
    if reference_image is not None:
        contents = await reference_image.read()
        ref_filename = reference_image.filename or "reference.png"
        reference_path = f"references/{user.id}/{image_id}/{ref_filename}"
        content_type = reference_image.content_type or "image/png"
        storage.upload_file(contents, reference_path, content_type)

    if not reference_path:
        raise BadRequestException(
            "No reference image available. Upload one or use an image that has been generated."
        )

    # Create a new Image record for the edited result
    new_image = Image(
        prompt_id=source_image.prompt_id,
        project_id=source_image.project_id,
        user_id=user.id,
        resolution=source_image.resolution,
        aspect_ratio=source_image.aspect_ratio,
        color_scheme=source_image.color_scheme,
        reference_image_path=reference_path,
        edit_instruction=edit_instruction,
        generation_status="pending",
    )
    db.add(new_image)
    await db.flush()
    await db.refresh(new_image)

    task = celery_app.send_task(
        "app.tasks.image_tasks.generate_image_task",
        args=[
            str(new_image.id),
            source_image.final_prompt_sent or "",
            str(user.id),
            source_image.resolution,
            source_image.aspect_ratio,
            source_image.color_scheme,
            reference_path,  # reference_image_path
            edit_instruction,  # edit_instruction
        ],
        queue="images",
    )

    new_image.generation_task_id = task.id
    db.add(new_image)
    await db.flush()

    return ImageStatusResponse(
        id=new_image.id,
        generation_status=new_image.generation_status,
        generation_task_id=task.id,
    )


# ---------------------------------------------------------------------------
# SSE streaming endpoint
# ---------------------------------------------------------------------------


@router.get("/images/{image_id}/stream")
async def stream_image_status(
    image_id: UUID,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Server-Sent Events endpoint for real-time image generation status.

    Polls the database every 2 seconds and yields SSE events until the
    generation reaches a terminal state (completed or failed).
    """
    # Verify ownership once before starting the stream
    image = await _get_owned_image(image_id, user, db)

    async def event_generator():
        """Yield SSE events until terminal state is reached."""
        from app.dependencies import get_async_session_factory  # noqa: PLC0415

        session_factory = get_async_session_factory()
        terminal_states = {"completed", "failed"}
        last_status: str | None = None

        while True:
            # Use a fresh session for each poll to get current data
            async with session_factory() as session:
                result = await session.execute(
                    select(Image).where(Image.id == image_id)
                )
                current_image: Image | None = result.scalar_one_or_none()

            if current_image is None:
                yield {
                    "event": "error",
                    "data": json.dumps({"error": "Image not found"}),
                }
                break

            current_status = current_image.generation_status

            # Only emit when status changes (or on first poll)
            if current_status != last_status:
                last_status = current_status
                event_data = {
                    "id": str(current_image.id),
                    "status": current_status,
                    "storage_path": current_image.storage_path,
                    "generation_duration_ms": current_image.generation_duration_ms,
                }
                yield {
                    "event": "status",
                    "data": json.dumps(event_data),
                }

                if current_status in terminal_states:
                    # Send a final "done" event so clients know to close
                    yield {
                        "event": "done",
                        "data": json.dumps({"status": current_status}),
                    }
                    break

            await asyncio.sleep(2)

    return EventSourceResponse(event_generator())
