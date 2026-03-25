"""Prompt management service."""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ForbiddenException, NotFoundException
from app.models.prompt import Prompt

logger = logging.getLogger(__name__)


class PromptService:
    """CRUD and status queries for AI-generated figure prompts."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # List prompts by project
    # ------------------------------------------------------------------

    async def get_prompts_by_project(
        self, project_id: UUID, user_id: UUID
    ) -> list[Prompt]:
        """Return all prompts belonging to a project, ordered by figure_number.

        Raises ForbiddenException if the user does not own the project's prompts.
        (Ownership is enforced by filtering on user_id.)
        """
        stmt = (
            select(Prompt)
            .where(Prompt.project_id == project_id, Prompt.user_id == user_id)
            .order_by(Prompt.figure_number)
        )
        result = await self.db.execute(stmt)
        prompts = list(result.scalars().all())
        return prompts

    # ------------------------------------------------------------------
    # Get single prompt
    # ------------------------------------------------------------------

    async def get_prompt(self, prompt_id: UUID, user_id: UUID) -> Prompt:
        """Fetch a single prompt by ID, verifying ownership.

        Raises NotFoundException if the prompt does not exist.
        Raises ForbiddenException if the user does not own it.
        """
        stmt = select(Prompt).where(Prompt.id == prompt_id)
        result = await self.db.execute(stmt)
        prompt: Prompt | None = result.scalar_one_or_none()

        if prompt is None:
            raise NotFoundException(f"Prompt {prompt_id} not found")

        if prompt.user_id != user_id:
            raise ForbiddenException("You do not have access to this prompt")

        return prompt

    # ------------------------------------------------------------------
    # Update edited prompt
    # ------------------------------------------------------------------

    async def update_prompt(
        self, prompt_id: UUID, user_id: UUID, edited_prompt: str
    ) -> Prompt:
        """Update the ``edited_prompt`` field (user's manual edit).

        The ``active_prompt`` hybrid property on the model will automatically
        prefer edited_prompt over original_prompt when set.
        """
        prompt = await self.get_prompt(prompt_id, user_id)
        prompt.edited_prompt = edited_prompt
        await self.db.flush()
        await self.db.refresh(prompt)

        logger.info(
            "Prompt %s updated by user %s (edited_prompt length=%d)",
            prompt_id,
            user_id,
            len(edited_prompt),
        )
        return prompt

    # ------------------------------------------------------------------
    # Prompt generation status
    # ------------------------------------------------------------------

    async def get_prompt_status(self, prompt_id: UUID, user_id: UUID) -> dict:
        """Return the generation status and Celery task ID for a prompt.

        Returns
        -------
        dict
            ``{"prompt_id": UUID, "generation_status": str, "task_id": str | None}``
        """
        prompt = await self.get_prompt(prompt_id, user_id)
        return {
            "prompt_id": prompt.id,
            "generation_status": prompt.generation_status,
            "task_id": prompt.generation_task_id,
        }

    # ------------------------------------------------------------------
    # Batch create (used by Celery tasks after Prompt AI responds)
    # ------------------------------------------------------------------

    async def create_prompts_from_figures(
        self,
        project_id: UUID,
        user_id: UUID,
        document_id: UUID | None,
        figures: list[dict],
        generator_provider: str = "anthropic",
        generator_model: str | None = None,
        task_id: str | None = None,
    ) -> list[Prompt]:
        """Create Prompt records from a list of AI-generated figure dicts.

        Parameters
        ----------
        project_id:
            The parent project.
        user_id:
            The owning user.
        document_id:
            Optional source document.
        figures:
            List of figure dicts as returned by ``PromptAIService``.
        generator_provider:
            Provider name used for generation.
        generator_model:
            Model name used for generation.
        task_id:
            Celery task ID for status tracking.

        Returns
        -------
        list[Prompt]
            The newly created Prompt ORM instances.
        """
        prompts: list[Prompt] = []

        for fig in figures:
            prompt = Prompt(
                project_id=project_id,
                document_id=document_id,
                user_id=user_id,
                figure_number=fig.get("figure_number", len(prompts) + 1),
                title=fig.get("title"),
                original_prompt=fig.get("prompt"),
                suggested_figure_type=fig.get("suggested_figure_type"),
                suggested_aspect_ratio=fig.get("suggested_aspect_ratio"),
                source_sections={
                    "titles": fig.get("source_section_titles", []),
                    "rationale": fig.get("rationale", ""),
                },
                generator_provider=generator_provider,
                generator_model=generator_model,
                generation_task_id=task_id,
                generation_status="completed",
            )
            self.db.add(prompt)
            prompts.append(prompt)

        await self.db.flush()

        # Refresh all to get server-generated IDs
        for p in prompts:
            await self.db.refresh(p)

        logger.info(
            "Created %d prompts for project %s (document=%s)",
            len(prompts),
            project_id,
            document_id,
        )
        return prompts

    # ------------------------------------------------------------------
    # Update generation status
    # ------------------------------------------------------------------

    async def update_generation_status(
        self,
        prompt_id: UUID,
        status: str,
        task_id: str | None = None,
    ) -> Prompt:
        """Update the generation_status (and optionally task_id) of a prompt.

        This is intended for internal use by Celery task callbacks.
        No ownership check is performed.
        """
        stmt = select(Prompt).where(Prompt.id == prompt_id)
        result = await self.db.execute(stmt)
        prompt: Prompt | None = result.scalar_one_or_none()

        if prompt is None:
            raise NotFoundException(f"Prompt {prompt_id} not found")

        prompt.generation_status = status
        if task_id is not None:
            prompt.generation_task_id = task_id

        await self.db.flush()
        await self.db.refresh(prompt)
        return prompt
