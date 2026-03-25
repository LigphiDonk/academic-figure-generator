"""Authentication endpoints: register, login, refresh, profile, LinuxDO OAuth."""

import logging

import httpx
from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestException, NotFoundException
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decrypt_api_key,
    encrypt_api_key,
    hash_password,
    verify_password,
    verify_token,
)
from app.dependencies import get_current_active_user, get_db
from app.models.system_settings import SystemSettings
from app.models.user import User
from app.schemas.nanobanana import NanoBananaModelsProbeRequest, NanoBananaModelsResponse
from app.schemas.prompt_ai import PromptAIModelsProbeRequest, PromptAIModelsResponse
from app.schemas.auth import (
    ChangePassword,
    TokenRefresh,
    TokenResponse,
    UserLogin,
    UserRegister,
    UserResponse,
    UserUpdate,
)
from app.services.prompt_ai_service import (
    PromptAIConfigLayer,
    PromptAIService,
    get_env_prompt_ai_config_layer,
    resolve_prompt_ai_settings,
)
from app.services.nanobanana_service import (
    NanoBananaConfigLayer,
    NanoBananaService,
    get_env_nanobanana_config_layer,
    resolve_nanobanana_settings,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _user_to_response(user: User) -> UserResponse:
    """Map a User ORM object to UserResponse, computing derived fields."""
    return UserResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        is_active=user.is_active,
        is_admin=user.is_admin,
        default_color_scheme=user.default_color_scheme,
        default_resolution=user.default_resolution,
        default_aspect_ratio=user.default_aspect_ratio,
        prompt_ai_provider=user.prompt_ai_provider,
        prompt_ai_api_key_set=user.prompt_ai_api_key_enc is not None,
        prompt_ai_model=user.prompt_ai_model,
        nanobanana_api_key_set=user.nanobanana_api_key_enc is not None,
        nanobanana_model=user.nanobanana_model,
        paddleocr_api_key_set=user.paddleocr_token_enc is not None,
        prompt_ai_api_base_url=user.prompt_ai_api_base_url,
        nanobanana_api_base_url=user.nanobanana_api_base_url,
        paddleocr_server_url=user.paddleocr_server_url,
        prompt_ai_tokens_quota=user.prompt_ai_tokens_quota,
        nanobanana_images_quota=user.nanobanana_images_quota,
        linuxdo_id=user.linuxdo_id,
        linuxdo_username=user.linuxdo_username,
        linuxdo_avatar_url=user.linuxdo_avatar_url,
        created_at=user.created_at,
    )


def _build_tokens(user_id: str) -> tuple[str, str]:
    """Create an access + refresh token pair for the given user id."""
    data = {"sub": str(user_id)}
    return create_access_token(data), create_refresh_token(data)


async def _get_system_prompt_ai_layer(db: AsyncSession) -> PromptAIConfigLayer:
    """读取系统级 Prompt AI 配置。"""
    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    settings = result.scalar_one_or_none()
    if settings is None:
        return PromptAIConfigLayer()

    return PromptAIConfigLayer(
        provider=settings.prompt_ai_provider,
        api_key=decrypt_api_key(settings.prompt_ai_api_key_enc)
        if settings.prompt_ai_api_key_enc
        else None,
        api_base_url=settings.prompt_ai_api_base_url,
        model=settings.prompt_ai_model,
    )


async def _get_system_nanobanana_layer(db: AsyncSession) -> NanoBananaConfigLayer:
    """读取系统级 NanoBanana 配置。"""
    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    settings = result.scalar_one_or_none()
    if settings is None:
        return NanoBananaConfigLayer()

    return NanoBananaConfigLayer(
        api_key=decrypt_api_key(settings.nanobanana_api_key_enc)
        if settings.nanobanana_api_key_enc
        else None,
        api_base_url=settings.nanobanana_api_base_url,
        model=settings.nanobanana_model,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/register", response_model=UserResponse, status_code=201)
async def register(
    data: UserRegister,
    db: AsyncSession = Depends(get_db),
):
    """Register a new user account."""
    # Check for existing email
    result = await db.execute(select(User).where(User.email == data.email))
    if result.scalar_one_or_none() is not None:
        raise BadRequestException("Email already registered")

    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        display_name=data.display_name,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return _user_to_response(user)


@router.post("/login", response_model=TokenResponse)
async def login(
    data: UserLogin,
    db: AsyncSession = Depends(get_db),
):
    """Authenticate with email + password and receive JWT tokens."""
    result = await db.execute(select(User).where(User.email == data.email))
    user: User | None = result.scalar_one_or_none()

    if user is None or not user.password_hash or not verify_password(data.password, user.password_hash):
        raise BadRequestException("Invalid email or password")

    if not user.is_active:
        raise BadRequestException("Account is deactivated")

    access, refresh = _build_tokens(user.id)
    return TokenResponse(access_token=access, refresh_token=refresh)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    data: TokenRefresh,
    db: AsyncSession = Depends(get_db),
):
    """Exchange a valid refresh token for a new token pair."""
    try:
        payload = verify_token(data.refresh_token)
    except Exception as exc:
        raise BadRequestException("Invalid or expired refresh token") from exc

    if payload.get("type") != "refresh":
        raise BadRequestException("Token is not a refresh token")

    user_id = payload.get("sub")
    if user_id is None:
        raise BadRequestException("Invalid token payload")

    # Verify user still exists and is active
    result = await db.execute(select(User).where(User.id == user_id))
    user: User | None = result.scalar_one_or_none()
    if user is None:
        raise NotFoundException("User not found")
    if not user.is_active:
        raise BadRequestException("Account is deactivated")

    access, new_refresh = _build_tokens(user.id)
    return TokenResponse(access_token=access, refresh_token=new_refresh)


@router.get("/me", response_model=UserResponse)
async def get_me(
    user: User = Depends(get_current_active_user),
):
    """Return the current authenticated user's profile."""
    return _user_to_response(user)


@router.put("/me", response_model=UserResponse)
async def update_me(
    data: UserUpdate,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Update the current user's profile and preferences."""
    updates = data.model_dump(exclude_unset=True)

    # Handle API key encryption separately
    if "prompt_ai_api_key" in updates:
        raw_key = updates.pop("prompt_ai_api_key")
        if raw_key:
            user.prompt_ai_api_key_enc = encrypt_api_key(raw_key)
        else:
            user.prompt_ai_api_key_enc = None

    if "nanobanana_api_key" in updates:
        raw_key = updates.pop("nanobanana_api_key")
        if raw_key:
            user.nanobanana_api_key_enc = encrypt_api_key(raw_key)
        else:
            user.nanobanana_api_key_enc = None

    if "paddleocr_api_key" in updates:
        raw_key = updates.pop("paddleocr_api_key")
        if raw_key:
            user.paddleocr_token_enc = encrypt_api_key(raw_key)
        else:
            user.paddleocr_token_enc = None

    # Apply remaining scalar updates
    for field, value in updates.items():
        setattr(user, field, value)

    db.add(user)
    await db.flush()
    await db.refresh(user)
    return _user_to_response(user)


@router.put("/me/password")
async def change_password(
    data: ChangePassword,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Change the current user's password."""
    if not user.password_hash:
        raise BadRequestException("OAuth 用户无法通过此方式修改密码")

    if not verify_password(data.current_password, user.password_hash):
        raise BadRequestException("当前密码不正确")

    user.password_hash = hash_password(data.new_password)
    db.add(user)
    await db.flush()
    return {"message": "密码修改成功"}


@router.post("/me/prompt-ai/models", response_model=PromptAIModelsResponse)
async def list_my_prompt_ai_models(
    data: PromptAIModelsProbeRequest,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """按当前用户上下文探测 Prompt AI 可用模型列表。"""
    resolved = resolve_prompt_ai_settings(
        user_layer=PromptAIConfigLayer(
            provider=data.prompt_ai_provider or user.prompt_ai_provider,
            api_key=data.prompt_ai_api_key
            or (
                decrypt_api_key(user.prompt_ai_api_key_enc)
                if user.prompt_ai_api_key_enc
                else None
            ),
            api_base_url=(
                data.prompt_ai_api_base_url
                if data.prompt_ai_api_base_url is not None
                else user.prompt_ai_api_base_url
            ),
            model=user.prompt_ai_model,
        ),
        system_layer=await _get_system_prompt_ai_layer(db),
        env_layer=get_env_prompt_ai_config_layer(),
    )

    if not resolved.api_key:
        raise BadRequestException("未找到可用的 Prompt AI API Key，请先填写当前表单或已保存配置。")

    service = PromptAIService(
        provider=resolved.provider,
        api_key=resolved.api_key,
        api_base_url=resolved.api_base_url,
        model=resolved.model,
        max_tokens=resolved.max_tokens,
    )
    models = await service.list_models()
    return PromptAIModelsResponse(
        provider=resolved.provider,
        models=[
            {"id": model.id, "display_name": model.display_name}
            for model in models
        ],
    )


@router.post("/me/nanobanana/models", response_model=NanoBananaModelsResponse)
async def list_my_nanobanana_models(
    data: NanoBananaModelsProbeRequest,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """按当前用户上下文探测 NanoBanana 可用模型列表。"""
    resolved = resolve_nanobanana_settings(
        user_layer=NanoBananaConfigLayer(
            api_key=data.nanobanana_api_key
            or (
                decrypt_api_key(user.nanobanana_api_key_enc)
                if user.nanobanana_api_key_enc
                else None
            ),
            api_base_url=(
                data.nanobanana_api_base_url
                if data.nanobanana_api_base_url is not None
                else user.nanobanana_api_base_url
            ),
            model=user.nanobanana_model,
        ),
        system_layer=await _get_system_nanobanana_layer(db),
        env_layer=get_env_nanobanana_config_layer(),
    )

    if not resolved.api_key:
        raise BadRequestException("未找到可用的 NanoBanana API Key，请先填写当前表单或已保存配置。")

    service = NanoBananaService(
        api_key=resolved.api_key,
        api_base_url=resolved.api_base_url,
        model=resolved.model,
    )
    models = await service.list_models()
    return NanoBananaModelsResponse(
        models=[
            {"id": model.id, "display_name": model.display_name}
            for model in models
        ],
    )


# ---------------------------------------------------------------------------
# Linux DO OAuth Endpoints
# ---------------------------------------------------------------------------

LINUXDO_AUTHORIZE_URL = "https://connect.linux.do/oauth2/authorize"
LINUXDO_TOKEN_URL = "https://connect.linux.do/oauth2/token"
LINUXDO_USER_URL = "https://connect.linux.do/api/user"


async def _get_linuxdo_settings(db: AsyncSession) -> SystemSettings | None:
    """Return SystemSettings if LinuxDO OAuth is configured."""
    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    settings = result.scalar_one_or_none()
    if settings and settings.linuxdo_client_id and settings.linuxdo_client_secret_enc:
        return settings
    return None


@router.get("/linuxdo/status")
async def linuxdo_status(db: AsyncSession = Depends(get_db)):
    """Check if LinuxDO OAuth is configured (public, no auth required)."""
    settings = await _get_linuxdo_settings(db)
    return {"configured": settings is not None}


@router.get("/linuxdo/authorize")
async def linuxdo_authorize(db: AsyncSession = Depends(get_db)):
    """Redirect user to LinuxDO OAuth authorization page."""
    settings = await _get_linuxdo_settings(db)
    if settings is None:
        raise BadRequestException("LinuxDO OAuth 尚未配置")

    redirect_uri = settings.linuxdo_redirect_uri or ""
    authorize_url = (
        f"{LINUXDO_AUTHORIZE_URL}"
        f"?client_id={settings.linuxdo_client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&response_type=code"
    )
    return RedirectResponse(url=authorize_url, status_code=302)


@router.get("/linuxdo/callback")
async def linuxdo_callback(
    code: str = Query(..., description="OAuth authorization code"),
    db: AsyncSession = Depends(get_db),
):
    """Handle LinuxDO OAuth callback: exchange code for token, upsert user, redirect to frontend."""
    settings = await _get_linuxdo_settings(db)
    if settings is None:
        raise BadRequestException("LinuxDO OAuth 尚未配置")

    client_id = settings.linuxdo_client_id
    client_secret = decrypt_api_key(settings.linuxdo_client_secret_enc)
    redirect_uri = settings.linuxdo_redirect_uri or ""

    # Step 1: Exchange authorization code for access token
    async with httpx.AsyncClient(timeout=15.0) as client:
        token_resp = await client.post(
            LINUXDO_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": client_id,
                "client_secret": client_secret,
            },
            headers={"Accept": "application/json"},
        )

    if token_resp.status_code != 200:
        logger.error("LinuxDO token exchange failed: %s %s", token_resp.status_code, token_resp.text)
        raise BadRequestException("LinuxDO 授权码交换失败")

    token_data = token_resp.json()
    oauth_access_token = token_data.get("access_token")
    if not oauth_access_token:
        raise BadRequestException("LinuxDO 返回的 token 无效")

    # Step 2: Fetch user info from LinuxDO
    async with httpx.AsyncClient(timeout=15.0) as client:
        user_resp = await client.get(
            LINUXDO_USER_URL,
            headers={
                "Authorization": f"Bearer {oauth_access_token}",
                "Accept": "application/json",
            },
        )

    if user_resp.status_code != 200:
        logger.error("LinuxDO user info fetch failed: %s %s", user_resp.status_code, user_resp.text)
        raise BadRequestException("获取 LinuxDO 用户信息失败")

    linuxdo_user = user_resp.json()
    linuxdo_id = linuxdo_user.get("id")
    linuxdo_username = linuxdo_user.get("username", "")
    linuxdo_avatar_url = linuxdo_user.get("avatar_url", "")
    linuxdo_trust_level = linuxdo_user.get("trust_level", 0)

    if not linuxdo_id:
        raise BadRequestException("LinuxDO 用户信息缺少 ID")

    # Step 3: Find or create local user by linuxdo_id
    result = await db.execute(select(User).where(User.linuxdo_id == linuxdo_id))
    user: User | None = result.scalar_one_or_none()

    if user is not None:
        # Update existing user info
        user.linuxdo_username = linuxdo_username
        user.linuxdo_avatar_url = linuxdo_avatar_url
        user.linuxdo_trust_level = linuxdo_trust_level
        if not user.display_name:
            user.display_name = linuxdo_username
    else:
        # Create new user (no password, email placeholder)
        user = User(
            email=f"{linuxdo_id}@linuxdo.local",
            password_hash=None,
            display_name=linuxdo_username,
            linuxdo_id=linuxdo_id,
            linuxdo_username=linuxdo_username,
            linuxdo_avatar_url=linuxdo_avatar_url,
            linuxdo_trust_level=linuxdo_trust_level,
        )
        db.add(user)

    await db.flush()
    await db.refresh(user)

    if not user.is_active:
        raise BadRequestException("账户已被禁用")

    # Step 4: Generate JWT tokens
    access, refresh = _build_tokens(user.id)

    # Step 5: Redirect to frontend callback page with tokens
    # Derive frontend origin from redirect_uri (strip /api/v1/auth/linuxdo/callback)
    frontend_origin = redirect_uri.replace("/api/v1/auth/linuxdo/callback", "")
    frontend_callback = (
        f"{frontend_origin}/auth/linuxdo/callback"
        f"?access_token={access}"
        f"&refresh_token={refresh}"
    )
    return RedirectResponse(url=frontend_callback, status_code=302)
