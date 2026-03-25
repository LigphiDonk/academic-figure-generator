from datetime import date

from pydantic import BaseModel


class AdminUsageDailyPoint(BaseModel):
    date: date
    cost_cny: float
    images: int
    prompt_ai_tokens: int


class AdminUsageSummary(BaseModel):
    billing_period: str
    total_users: int
    total_balance_cny: float
    period_cost_cny: float
    total_cost_cny: float
    period_images: int
    period_prompt_ai_tokens: int
    daily: list[AdminUsageDailyPoint]
