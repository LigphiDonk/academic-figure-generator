"""Schemas for payment / top-up endpoints."""

from datetime import datetime

from pydantic import BaseModel, Field


class PaymentCreate(BaseModel):
    """Request: create a new top-up order."""

    amount_cny: float = Field(..., gt=0, description="Top-up amount in CNY (max 2 decimals)")


class PaymentCreateResponse(BaseModel):
    """Response: newly created order with redirect URL."""

    order_id: str
    pay_url: str
    amount_cny: float
    amount_credits: float


class PaymentStatusResponse(BaseModel):
    """Response: order status query."""

    order_id: str
    out_trade_no: str
    amount_cny: float
    amount_credits: float
    status: str
    created_at: datetime


class PaymentHistoryItem(BaseModel):
    """Single item in payment history list."""

    order_id: str
    out_trade_no: str
    amount_cny: float
    amount_credits: float
    status: str
    created_at: datetime


class PaymentConfigResponse(BaseModel):
    """Public config: whether EasyPay is enabled + exchange rate."""

    configured: bool
    credits_per_cny: float | None = None
