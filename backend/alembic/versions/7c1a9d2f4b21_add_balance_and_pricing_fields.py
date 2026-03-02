"""Add unified balance + pricing fields.

Revision ID: 7c1a9d2f4b21
Revises: 3d2c0c0b0b2e
Create Date: 2026-03-02
"""

from alembic import op
import sqlalchemy as sa


revision = "7c1a9d2f4b21"
down_revision = "3d2c0c0b0b2e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Users: unified balance (CNY)
    op.add_column(
        "users",
        sa.Column("balance_cny", sa.Numeric(12, 2), nullable=False, server_default="0"),
    )

    # System pricing
    op.add_column(
        "system_settings",
        sa.Column("image_price_cny", sa.Numeric(12, 2), nullable=False, server_default="1.5"),
    )
    op.add_column(
        "system_settings",
        sa.Column("usd_cny_rate", sa.Numeric(10, 4), nullable=False, server_default="7.2"),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "claude_input_usd_per_million",
            sa.Numeric(10, 4),
            nullable=False,
            server_default="3.0",
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "claude_output_usd_per_million",
            sa.Numeric(10, 4),
            nullable=False,
            server_default="15.0",
        ),
    )

    # Usage logs: store CNY cost directly
    op.add_column(
        "usage_logs",
        sa.Column("estimated_cost_cny", sa.Numeric(12, 6), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("usage_logs", "estimated_cost_cny")
    op.drop_column("system_settings", "claude_output_usd_per_million")
    op.drop_column("system_settings", "claude_input_usd_per_million")
    op.drop_column("system_settings", "usd_cny_rate")
    op.drop_column("system_settings", "image_price_cny")
    op.drop_column("users", "balance_cny")

