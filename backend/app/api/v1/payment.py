"""Payment endpoints: Linux DO credits top-up via EasyPay protocol."""

import hashlib
import json
import logging
import random
import string
import time
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestException, NotFoundException
from app.core.security import decrypt_api_key
from app.dependencies import get_current_active_user, get_db
from app.models.payment_order import PaymentOrder
from app.models.system_settings import SystemSettings
from app.models.user import User
from app.schemas.payment import (
    PaymentConfigResponse,
    PaymentCreate,
    PaymentCreateResponse,
    PaymentHistoryItem,
    PaymentStatusResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payment", tags=["Payment"])

EPAY_SUBMIT_URL = "https://credit.linux.do/epay/pay/submit.php"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_settings(db: AsyncSession) -> SystemSettings:
    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    settings = result.scalar_one_or_none()
    if settings is None:
        raise BadRequestException("系统设置未初始化")
    return settings


def _epay_sign(params: dict, key: str) -> str:
    """EasyPay MD5 signature: sort non-empty fields (exclude sign/sign_type), concat with key."""
    filtered = {
        k: v
        for k, v in params.items()
        if v not in ("", None) and k not in ("sign", "sign_type")
    }
    sorted_str = "&".join(f"{k}={filtered[k]}" for k in sorted(filtered.keys()))
    return hashlib.md5(f"{sorted_str}{key}".encode()).hexdigest()


def _verify_epay_sign(params: dict, key: str) -> bool:
    """Verify the callback signature."""
    sign = params.get("sign", "")
    expected = _epay_sign(params, key)
    return sign == expected


def _generate_trade_no() -> str:
    ts = int(time.time())
    rand = "".join(random.choices(string.digits, k=6))
    return f"PAY-{ts}-{rand}"


# ---------------------------------------------------------------------------
# Public: payment config (no auth needed)
# ---------------------------------------------------------------------------


@router.get("/config", response_model=PaymentConfigResponse)
async def get_payment_config(db: AsyncSession = Depends(get_db)):
    """Return whether EasyPay is configured and the exchange rate."""
    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    settings = result.scalar_one_or_none()
    if settings is None or not settings.epay_pid or not settings.epay_key_enc:
        return PaymentConfigResponse(configured=False)
    return PaymentConfigResponse(
        configured=True,
        credits_per_cny=float(settings.linuxdo_credits_per_cny),
    )


# ---------------------------------------------------------------------------
# POST /payment/create — create order and redirect to Linux DO
# ---------------------------------------------------------------------------


@router.post("/create", response_model=PaymentCreateResponse)
async def create_payment(
    body: PaymentCreate,
    request: Request,
    current_user=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a top-up order and return the Linux DO payment URL."""
    settings = await _get_settings(db)

    if not settings.epay_pid or not settings.epay_key_enc:
        raise BadRequestException("积分支付未配置，请联系管理员")

    epay_key = decrypt_api_key(settings.epay_key_enc)
    credits_per_cny = settings.linuxdo_credits_per_cny

    amount_cny = Decimal(str(body.amount_cny)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    amount_credits = (amount_cny * credits_per_cny).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )

    out_trade_no = _generate_trade_no()

    # Persist order
    order = PaymentOrder(
        user_id=current_user.id,
        out_trade_no=out_trade_no,
        amount_cny=amount_cny,
        amount_credits=amount_credits,
        status="pending",
    )
    db.add(order)
    await db.flush()
    await db.refresh(order)

    # Derive base URL from the incoming request
    base_url = str(request.base_url).rstrip("/")
    api_prefix = "/api/v1"
    notify_url = f"{base_url}{api_prefix}/payment/notify"
    return_url = f"{base_url}{api_prefix}/payment/return"

    # Build EasyPay request params
    params = {
        "pid": settings.epay_pid,
        "type": "epay",
        "out_trade_no": out_trade_no,
        "notify_url": notify_url,
        "return_url": return_url,
        "name": f"充值 ¥{amount_cny}",
        "money": str(amount_credits),
    }

    # Sign
    params["sign"] = _epay_sign(params, epay_key)
    params["sign_type"] = "MD5"

    # Submit to Linux DO
    pay_url = ""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                EPAY_SUBMIT_URL,
                data=params,
                follow_redirects=False,
            )

        if resp.status_code in (301, 302):
            pay_url = resp.headers.get("Location", "")
        else:
            # Try to extract error from response body
            error_msg = resp.text[:200] if resp.text else "未知错误"
            logger.error("EasyPay submit failed: status=%s body=%s", resp.status_code, error_msg)
            raise BadRequestException(f"支付创建失败: {error_msg}")
    except httpx.HTTPError as exc:
        logger.error("EasyPay HTTP error: %s", exc)
        raise BadRequestException("无法连接积分支付服务") from exc

    if not pay_url:
        raise BadRequestException("支付创建失败：未获取到支付链接")

    return PaymentCreateResponse(
        order_id=str(order.id),
        pay_url=pay_url,
        amount_cny=float(amount_cny),
        amount_credits=float(amount_credits),
    )


# ---------------------------------------------------------------------------
# GET /payment/notify — async callback from Linux DO (public)
# ---------------------------------------------------------------------------


@router.get("/notify", response_class=PlainTextResponse)
async def payment_notify(request: Request, db: AsyncSession = Depends(get_db)):
    """EasyPay async notification callback. Returns plain 'success' or 'fail'."""
    params = dict(request.query_params)

    settings = await _get_settings(db)
    if not settings.epay_key_enc:
        return PlainTextResponse("fail")

    epay_key = decrypt_api_key(settings.epay_key_enc)

    if not _verify_epay_sign(params, epay_key):
        logger.warning("EasyPay notify: invalid signature, params=%s", params)
        return PlainTextResponse("fail")

    trade_status = params.get("trade_status", "")
    if trade_status != "TRADE_SUCCESS":
        return PlainTextResponse("fail")

    out_trade_no = params.get("out_trade_no", "")
    result = await db.execute(
        select(PaymentOrder).where(PaymentOrder.out_trade_no == out_trade_no)
    )
    order = result.scalar_one_or_none()
    if order is None:
        logger.warning("EasyPay notify: order not found, out_trade_no=%s", out_trade_no)
        return PlainTextResponse("fail")

    # Idempotent: already paid
    if order.status == "paid":
        return PlainTextResponse("success")

    # Update order
    order.status = "paid"
    order.trade_no = params.get("trade_no")
    order.paid_at = datetime.now(timezone.utc)
    order.notify_data = json.dumps(params, ensure_ascii=False)

    # Credit user balance
    user_result = await db.execute(select(User).where(User.id == order.user_id))
    user = user_result.scalar_one_or_none()
    if user is not None:
        user.balance_cny = Decimal(str(user.balance_cny)) + order.amount_cny
        db.add(user)

    db.add(order)
    await db.flush()

    logger.info(
        "Payment completed: order=%s user=%s amount=¥%s",
        order.out_trade_no,
        order.user_id,
        order.amount_cny,
    )

    return PlainTextResponse("success")


# ---------------------------------------------------------------------------
# GET /payment/return — browser redirect after payment
# ---------------------------------------------------------------------------


@router.get("/return")
async def payment_return():
    """Browser redirect after Linux DO payment. Redirect to usage page."""
    return RedirectResponse(url="/usage?payment=success", status_code=302)


# ---------------------------------------------------------------------------
# GET /payment/status/{order_id} — poll order status (auth required)
# ---------------------------------------------------------------------------


@router.get("/status/{order_id}", response_model=PaymentStatusResponse)
async def get_payment_status(
    order_id: str,
    current_user=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Get status of a specific payment order (current user only)."""
    result = await db.execute(
        select(PaymentOrder).where(
            PaymentOrder.id == order_id,
            PaymentOrder.user_id == current_user.id,
        )
    )
    order = result.scalar_one_or_none()
    if order is None:
        raise NotFoundException("订单不存在")

    return PaymentStatusResponse(
        order_id=str(order.id),
        out_trade_no=order.out_trade_no,
        amount_cny=float(order.amount_cny),
        amount_credits=float(order.amount_credits),
        status=order.status,
        created_at=order.created_at,
    )


# ---------------------------------------------------------------------------
# GET /payment/history — list user's payment history (auth required)
# ---------------------------------------------------------------------------


@router.get("/history", response_model=list[PaymentHistoryItem])
async def get_payment_history(
    current_user=Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """List current user's payment history (newest first)."""
    result = await db.execute(
        select(PaymentOrder)
        .where(PaymentOrder.user_id == current_user.id)
        .order_by(PaymentOrder.created_at.desc())
        .limit(50)
    )
    orders = result.scalars().all()
    return [
        PaymentHistoryItem(
            order_id=str(o.id),
            out_trade_no=o.out_trade_no,
            amount_cny=float(o.amount_cny),
            amount_credits=float(o.amount_credits),
            status=o.status,
            created_at=o.created_at,
        )
        for o in orders
    ]
