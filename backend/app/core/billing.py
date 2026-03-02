from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class Pricing:
    image_price_cny: Decimal
    usd_cny_rate: Decimal
    claude_input_usd_per_million: Decimal
    claude_output_usd_per_million: Decimal


def compute_claude_cost_usd(
    input_tokens: int,
    output_tokens: int,
    input_usd_per_million: Decimal,
    output_usd_per_million: Decimal,
) -> Decimal:
    """Compute Claude cost in USD using per-1M token pricing."""
    in_cost = (Decimal(input_tokens) / Decimal(1_000_000)) * input_usd_per_million
    out_cost = (Decimal(output_tokens) / Decimal(1_000_000)) * output_usd_per_million
    return in_cost + out_cost


def usd_to_cny(usd: Decimal, usd_cny_rate: Decimal) -> Decimal:
    if usd_cny_rate <= 0:
        return Decimal("0")
    return usd * usd_cny_rate


def cny_to_usd(cny: Decimal, usd_cny_rate: Decimal) -> Decimal:
    if usd_cny_rate <= 0:
        return Decimal("0")
    return cny / usd_cny_rate

