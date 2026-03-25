"""Usage tracking and billing analytics service."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.usage import UsageLog

logger = logging.getLogger(__name__)


def _current_billing_period() -> str:
    """Return the current billing period string in YYYY-MM format."""
    return datetime.now(UTC).strftime("%Y-%m")


class UsageService:
    """Track API usage, provide billing summaries and breakdowns."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # Log a usage entry
    # ------------------------------------------------------------------

    async def log_usage(
        self,
        user_id: UUID,
        project_id: UUID | None = None,
        api_name: str = "prompt_ai",
        *,
        provider: str | None = None,
        api_endpoint: str | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        model: str | None = None,
        resolution: str | None = None,
        aspect_ratio: str | None = None,
        request_duration_ms: int | None = None,
        status_code: int | None = None,
        is_success: bool = True,
        error_message: str | None = None,
        estimated_cost_usd: Decimal | None = None,
        key_source: str = "platform",
    ) -> UsageLog:
        """Create a new usage log entry.

        Parameters
        ----------
        user_id:
            The user who initiated the request.
        project_id:
            Optional project the request is associated with.
        api_name:
            ``"prompt_ai"`` or ``"nanobanana"``.
        key_source:
            ``"platform"`` (system key) or ``"byok"`` (user's own key).

        Returns
        -------
        UsageLog
            The persisted log record.
        """
        billing_period = _current_billing_period()

        entry = UsageLog(
            user_id=user_id,
            project_id=project_id,
            api_name=api_name,
            provider=provider,
            api_endpoint=api_endpoint,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            model=model,
            resolution=resolution,
            aspect_ratio=aspect_ratio,
            request_duration_ms=request_duration_ms,
            status_code=status_code,
            is_success=is_success,
            error_message=error_message,
            estimated_cost_usd=estimated_cost_usd,
            billing_period=billing_period,
            key_source=key_source,
        )
        self.db.add(entry)
        await self.db.flush()
        await self.db.refresh(entry)

        logger.debug(
            "Usage logged: user=%s api=%s success=%s cost=%s",
            user_id,
            api_name,
            is_success,
            estimated_cost_usd,
        )
        return entry

    # ------------------------------------------------------------------
    # Summary for current or specified billing period
    # ------------------------------------------------------------------

    async def get_summary(
        self,
        user_id: UUID,
        billing_period: str | None = None,
    ) -> dict:
        """Get an aggregated usage summary for a billing period.

        Returns
        -------
        dict
            Keys: ``billing_period``, ``total_requests``, ``successful_requests``,
            ``failed_requests``, ``total_input_tokens``, ``total_output_tokens``,
            ``total_images``, ``total_cost_usd``.
        """
        period = billing_period or _current_billing_period()

        stmt = (
            select(
                func.count(UsageLog.id).label("total_requests"),
                func.sum(
                    case((UsageLog.is_success == True, 1), else_=0)  # noqa: E712
                ).label("successful_requests"),
                func.sum(
                    case((UsageLog.is_success == False, 1), else_=0)  # noqa: E712
                ).label("failed_requests"),
                func.coalesce(func.sum(UsageLog.input_tokens), 0).label(
                    "total_input_tokens"
                ),
                func.coalesce(func.sum(UsageLog.output_tokens), 0).label(
                    "total_output_tokens"
                ),
                func.sum(
                    case(
                        (UsageLog.api_name == "nanobanana", 1),
                        else_=0,
                    )
                ).label("total_images"),
                func.coalesce(func.sum(UsageLog.estimated_cost_usd), Decimal("0")).label(
                    "total_cost_usd"
                ),
            )
            .where(UsageLog.user_id == user_id, UsageLog.billing_period == period)
        )

        result = await self.db.execute(stmt)
        row = result.one()

        return {
            "billing_period": period,
            "total_requests": row.total_requests or 0,
            "successful_requests": row.successful_requests or 0,
            "failed_requests": row.failed_requests or 0,
            "total_input_tokens": row.total_input_tokens or 0,
            "total_output_tokens": row.total_output_tokens or 0,
            "total_images": row.total_images or 0,
            "total_cost_usd": float(row.total_cost_usd or 0),
        }

    # ------------------------------------------------------------------
    # History trend data
    # ------------------------------------------------------------------

    async def get_history(
        self,
        user_id: UUID,
        period: str = "daily",
        limit: int = 30,
    ) -> list[dict]:
        """Get usage history trend data.

        Parameters
        ----------
        user_id:
            User to query.
        period:
            Grouping period: ``"daily"`` or ``"monthly"``.
        limit:
            Maximum number of period buckets to return.

        Returns
        -------
        list[dict]
            Each dict has ``period_label``, ``request_count``,
            ``token_count``, ``image_count``, ``cost_usd``.
        """
        if period == "monthly":
            # Group by billing_period (YYYY-MM)
            period_col = UsageLog.billing_period
        else:
            # Group by date (YYYY-MM-DD)
            period_col = func.to_char(UsageLog.created_at, "YYYY-MM-DD")

        stmt = (
            select(
                period_col.label("period_label"),
                func.count(UsageLog.id).label("request_count"),
                func.coalesce(
                    func.sum(UsageLog.input_tokens) + func.sum(UsageLog.output_tokens),
                    0,
                ).label("token_count"),
                func.sum(
                    case((UsageLog.api_name == "nanobanana", 1), else_=0)
                ).label("image_count"),
                func.coalesce(func.sum(UsageLog.estimated_cost_usd), Decimal("0")).label(
                    "cost_usd"
                ),
            )
            .where(UsageLog.user_id == user_id)
            .group_by(period_col)
            .order_by(period_col.desc())
            .limit(limit)
        )

        result = await self.db.execute(stmt)
        rows = result.all()

        # Return in chronological order (oldest first)
        history = [
            {
                "period_label": row.period_label,
                "request_count": row.request_count or 0,
                "token_count": row.token_count or 0,
                "image_count": row.image_count or 0,
                "cost_usd": float(row.cost_usd or 0),
            }
            for row in reversed(rows)
        ]
        return history

    # ------------------------------------------------------------------
    # Per-API breakdown
    # ------------------------------------------------------------------

    async def get_breakdown(
        self,
        user_id: UUID,
        billing_period: str | None = None,
    ) -> list[dict]:
        """Get per-API usage breakdown for a billing period.

        Returns
        -------
        list[dict]
            Each dict has ``api_name``, ``request_count``,
            ``successful_count``, ``failed_count``, ``total_input_tokens``,
            ``total_output_tokens``, ``total_cost_usd``,
            ``avg_duration_ms``.
        """
        period = billing_period or _current_billing_period()

        stmt = (
            select(
                UsageLog.api_name.label("api_name"),
                func.count(UsageLog.id).label("request_count"),
                func.sum(
                    case((UsageLog.is_success == True, 1), else_=0)  # noqa: E712
                ).label("successful_count"),
                func.sum(
                    case((UsageLog.is_success == False, 1), else_=0)  # noqa: E712
                ).label("failed_count"),
                func.coalesce(func.sum(UsageLog.input_tokens), 0).label(
                    "total_input_tokens"
                ),
                func.coalesce(func.sum(UsageLog.output_tokens), 0).label(
                    "total_output_tokens"
                ),
                func.coalesce(func.sum(UsageLog.estimated_cost_usd), Decimal("0")).label(
                    "total_cost_usd"
                ),
                func.coalesce(func.avg(UsageLog.request_duration_ms), 0).label(
                    "avg_duration_ms"
                ),
            )
            .where(UsageLog.user_id == user_id, UsageLog.billing_period == period)
            .group_by(UsageLog.api_name)
            .order_by(UsageLog.api_name)
        )

        result = await self.db.execute(stmt)
        rows = result.all()

        return [
            {
                "api_name": row.api_name,
                "request_count": row.request_count or 0,
                "successful_count": row.successful_count or 0,
                "failed_count": row.failed_count or 0,
                "total_input_tokens": row.total_input_tokens or 0,
                "total_output_tokens": row.total_output_tokens or 0,
                "total_cost_usd": float(row.total_cost_usd or 0),
                "avg_duration_ms": round(float(row.avg_duration_ms or 0), 1),
            }
            for row in rows
        ]

    # ------------------------------------------------------------------
    # Quota check helpers
    # ------------------------------------------------------------------

    async def get_tokens_used(
        self, user_id: UUID, billing_period: str | None = None
    ) -> int:
        """Return total tokens (input + output) used in the billing period."""
        period = billing_period or _current_billing_period()

        stmt = (
            select(
                func.coalesce(
                    func.sum(UsageLog.input_tokens) + func.sum(UsageLog.output_tokens),
                    0,
                )
            )
            .where(
                UsageLog.user_id == user_id,
                UsageLog.billing_period == period,
                UsageLog.api_name == "claude",
                UsageLog.is_success == True,  # noqa: E712
            )
        )

        result = await self.db.execute(stmt)
        return result.scalar_one() or 0

    async def get_images_generated(
        self, user_id: UUID, billing_period: str | None = None
    ) -> int:
        """Return total successful image generations in the billing period."""
        period = billing_period or _current_billing_period()

        stmt = (
            select(func.count(UsageLog.id))
            .where(
                UsageLog.user_id == user_id,
                UsageLog.billing_period == period,
                UsageLog.api_name == "nanobanana",
                UsageLog.is_success == True,  # noqa: E712
            )
        )

        result = await self.db.execute(stmt)
        return result.scalar_one() or 0
