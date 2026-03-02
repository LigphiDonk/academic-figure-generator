"""Admin endpoints: system settings + user management."""

from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestException, NotFoundException
from app.core.security import encrypt_api_key, hash_password
from app.dependencies import get_current_admin_user, get_db
from app.models.system_settings import SystemSettings
from app.models.usage import UsageLog
from app.models.user import User
from app.schemas.admin import (
    AdminBalanceUpdate,
    AdminCreditUpdate,
    AdminUserCreate,
    AdminUserResponse,
    AdminUserUpdate,
)
from app.schemas.admin_usage import AdminUsageDailyPoint, AdminUsageSummary
from app.schemas.system_settings import SystemSettingsResponse, SystemSettingsUpdate

router = APIRouter(prefix="/admin", tags=["Admin"])


def _current_billing_period() -> str:
    from datetime import datetime  # noqa: PLC0415

    return datetime.utcnow().strftime("%Y-%m")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_or_create_settings(db: AsyncSession) -> SystemSettings:
    """Return the single SystemSettings row, creating it if absent."""
    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    settings = result.scalar_one_or_none()
    if settings is None:
        settings = SystemSettings(id=1)
        db.add(settings)
        await db.flush()
        await db.refresh(settings)
    return settings


def _settings_to_response(s: SystemSettings) -> SystemSettingsResponse:
    return SystemSettingsResponse(
        claude_api_key_set=s.claude_api_key_enc is not None,
        claude_api_base_url=s.claude_api_base_url,
        claude_model=s.claude_model,
        nanobanana_api_key_set=s.nanobanana_api_key_enc is not None,
        nanobanana_api_base_url=s.nanobanana_api_base_url,
        nanobanana_model=s.nanobanana_model,
        image_price_cny=float(s.image_price_cny),
        image_price_cny_1k=float(s.image_price_cny_1k),
        image_price_cny_2k=float(s.image_price_cny_2k),
        image_price_cny_4k=float(s.image_price_cny_4k),
        usd_cny_rate=float(s.usd_cny_rate),
        claude_input_usd_per_million=float(s.claude_input_usd_per_million),
        claude_output_usd_per_million=float(s.claude_output_usd_per_million),
    )


def _user_to_admin_response(user: User) -> AdminUserResponse:
    return AdminUserResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        is_active=user.is_active,
        is_admin=user.is_admin,
        balance_cny=float(user.balance_cny),
        nanobanana_images_quota=user.nanobanana_images_quota,
        claude_tokens_quota=user.claude_tokens_quota,
        created_at=user.created_at,
        updated_at=user.updated_at if hasattr(user, "updated_at") else None,
    )


# ---------------------------------------------------------------------------
# System Settings Endpoints
# ---------------------------------------------------------------------------


@router.get("/settings", response_model=SystemSettingsResponse)
async def get_system_settings(
    _admin=Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current system-wide API settings (admin only)."""
    settings = await _get_or_create_settings(db)
    return _settings_to_response(settings)


@router.put("/settings", response_model=SystemSettingsResponse)
async def update_system_settings(
    data: SystemSettingsUpdate,
    _admin=Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Update system-wide API settings (admin only)."""
    settings = await _get_or_create_settings(db)
    updates = data.model_dump(exclude_unset=True)

    # Handle API key encryption separately
    if "claude_api_key" in updates:
        raw_key = updates.pop("claude_api_key")
        if raw_key:
            settings.claude_api_key_enc = encrypt_api_key(raw_key)
        else:
            settings.claude_api_key_enc = None

    if "nanobanana_api_key" in updates:
        raw_key = updates.pop("nanobanana_api_key")
        if raw_key:
            settings.nanobanana_api_key_enc = encrypt_api_key(raw_key)
        else:
            settings.nanobanana_api_key_enc = None

    # Apply remaining scalar updates (base URLs, model)
    for field, value in updates.items():
        setattr(settings, field, value)

    db.add(settings)
    await db.flush()
    await db.refresh(settings)
    return _settings_to_response(settings)


# ---------------------------------------------------------------------------
# User Management Endpoints
# ---------------------------------------------------------------------------


@router.get("/users", response_model=list[AdminUserResponse])
async def list_users(
    _admin=Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """List all users (admin only)."""
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()
    return [_user_to_admin_response(u) for u in users]


@router.get("/usage/summary", response_model=AdminUsageSummary)
async def get_admin_usage_summary(
    billing_period: str | None = None,
    _admin=Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Site-wide usage summary (admin only)."""
    period = billing_period or _current_billing_period()

    # totals
    total_users = int((await db.execute(select(func.count(User.id)))).scalar_one())
    total_balance = float((await db.execute(select(func.coalesce(func.sum(User.balance_cny), 0)))).scalar_one())

    period_cost = float(
        (
            await db.execute(
                select(func.coalesce(func.sum(UsageLog.estimated_cost_cny), 0)).where(
                    UsageLog.billing_period == period
                )
            )
        ).scalar_one()
    )
    total_cost = float(
        (await db.execute(select(func.coalesce(func.sum(UsageLog.estimated_cost_cny), 0)))).scalar_one()
    )

    period_images = int(
        (
            await db.execute(
                select(func.count(UsageLog.id)).where(
                    UsageLog.billing_period == period,
                    UsageLog.api_name == "nanobanana",
                    UsageLog.is_success.is_(True),
                )
            )
        ).scalar_one()
    )

    period_tokens = int(
        (
            await db.execute(
                select(
                    func.coalesce(func.sum(UsageLog.input_tokens + UsageLog.output_tokens), 0)
                ).where(
                    UsageLog.billing_period == period,
                    UsageLog.api_name == "claude",
                )
            )
        ).scalar_one()
    )

    # daily last 30 points (all time)
    date_trunc = func.date_trunc("day", UsageLog.created_at)
    rows = (
        await db.execute(
            select(
                date_trunc.label("d"),
                func.coalesce(func.sum(UsageLog.estimated_cost_cny), 0).label("cost"),
                func.count(case((UsageLog.api_name == "nanobanana", 1))).label("images"),
                func.coalesce(
                    func.sum(
                        case(
                            (UsageLog.api_name == "claude", UsageLog.input_tokens + UsageLog.output_tokens),
                            else_=0,
                        )
                    ),
                    0,
                ).label("tokens"),
            )
            .group_by("d")
            .order_by(func.max(date_trunc).desc())
            .limit(30)
        )
    ).all()

    daily = [
        AdminUsageDailyPoint(
            date=r.d.date(),
            cost_cny=float(r.cost or 0),
            images=int(r.images or 0),
            claude_tokens=int(r.tokens or 0),
        )
        for r in reversed(rows)
        if r.d is not None
    ]

    return AdminUsageSummary(
        billing_period=period,
        total_users=total_users,
        total_balance_cny=round(total_balance, 2),
        period_cost_cny=round(period_cost, 6),
        total_cost_cny=round(total_cost, 6),
        period_images=period_images,
        period_claude_tokens=period_tokens,
        daily=daily,
    )


@router.post("/users", response_model=AdminUserResponse, status_code=201)
async def create_user(
    data: AdminUserCreate,
    _admin=Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new user (admin only)."""
    # Check duplicate email
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none() is not None:
        raise BadRequestException("该邮箱已被注册")

    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        display_name=data.display_name,
        is_admin=data.is_admin,
        nanobanana_images_quota=data.nanobanana_images_quota,
        balance_cny=Decimal(str(data.balance_cny)),
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return _user_to_admin_response(user)


@router.get("/users/{user_id}", response_model=AdminUserResponse)
async def get_user(
    user_id: UUID,
    _admin=Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single user's info (admin only)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise NotFoundException("用户不存在")
    return _user_to_admin_response(user)


@router.put("/users/{user_id}", response_model=AdminUserResponse)
async def update_user(
    user_id: UUID,
    data: AdminUserUpdate,
    admin=Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a user's info (admin only)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise NotFoundException("用户不存在")

    updates = data.model_dump(exclude_unset=True)

    # Prevent admin from demoting themselves
    if str(user.id) == str(admin.id) and "is_admin" in updates and not updates["is_admin"]:
        raise BadRequestException("不能取消自己的管理员权限")

    # Prevent admin from deactivating themselves
    if str(user.id) == str(admin.id) and "is_active" in updates and not updates["is_active"]:
        raise BadRequestException("不能禁用自己的账户")

    for field, value in updates.items():
        setattr(user, field, value)

    db.add(user)
    await db.flush()
    await db.refresh(user)
    return _user_to_admin_response(user)


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: UUID,
    admin=Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a user (admin only). Cannot delete self."""
    if str(user_id) == str(admin.id):
        raise BadRequestException("不能删除自己的账户")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise NotFoundException("用户不存在")

    await db.delete(user)
    await db.flush()


@router.post("/users/{user_id}/credits", response_model=AdminUserResponse)
async def adjust_credits(
    user_id: UUID,
    data: AdminCreditUpdate,
    _admin=Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Adjust a user's image generation credits (admin only).

    Positive delta = add credits, negative delta = subtract credits.
    """
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise NotFoundException("用户不存在")

    new_quota = user.nanobanana_images_quota + data.delta
    if new_quota < 0:
        raise BadRequestException(
            f"额度不足：当前额度 {user.nanobanana_images_quota}，"
            f"无法减少 {abs(data.delta)}"
        )

    user.nanobanana_images_quota = new_quota
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return _user_to_admin_response(user)


@router.post("/users/{user_id}/balance", response_model=AdminUserResponse)
async def adjust_balance(
    user_id: UUID,
    data: AdminBalanceUpdate,
    _admin=Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Adjust a user's unified balance (CNY) (admin only).

    Positive delta = add balance, negative delta = subtract balance.
    """
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise NotFoundException("用户不存在")

    new_balance = Decimal(str(user.balance_cny)) + Decimal(str(data.delta_cny))
    if new_balance < 0:
        raise BadRequestException(
            f"余额不足：当前余额 ¥{float(user.balance_cny):.2f}，"
            f"无法减少 ¥{abs(float(data.delta_cny)):.2f}"
        )

    user.balance_cny = new_balance
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return _user_to_admin_response(user)
