from pydantic import BaseModel


class UsageSummary(BaseModel):
    billing_period: str
    balance_cny: float
    claude_tokens_used: int
    claude_calls: int
    nanobanana_images: int
    period_spend_cny: float
    total_spend_cny: float


class UsageHistoryPoint(BaseModel):
    date: str
    claude_tokens: int
    nanobanana_images: int
    cost_cny: float


class UsageBreakdown(BaseModel):
    api_name: str
    total_calls: int
    success_count: int
    failure_count: int
    total_tokens: int | None
    total_cost_cny: float
    avg_duration_ms: float


class UsageHistoryResponse(BaseModel):
    period: str
    data: list[UsageHistoryPoint]
