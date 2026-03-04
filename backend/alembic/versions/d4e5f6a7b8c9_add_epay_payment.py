"""Add EasyPay fields to system_settings and create payment_orders table.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-03-04
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- system_settings: EasyPay config --
    op.add_column(
        "system_settings",
        sa.Column("epay_pid", sa.String(200), nullable=True),
    )
    op.add_column(
        "system_settings",
        sa.Column("epay_key_enc", sa.Text(), nullable=True),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "linuxdo_credits_per_cny",
            sa.Numeric(10, 4),
            nullable=False,
            server_default="1.0000",
        ),
    )

    # -- payment_orders table --
    op.create_table(
        "payment_orders",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("out_trade_no", sa.String(64), nullable=False),
        sa.Column("trade_no", sa.String(64), nullable=True),
        sa.Column("amount_cny", sa.Numeric(12, 2), nullable=False),
        sa.Column("amount_credits", sa.Numeric(12, 2), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notify_data", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_payment_orders_user_id", "payment_orders", ["user_id"])
    op.create_index(
        "ix_payment_orders_out_trade_no",
        "payment_orders",
        ["out_trade_no"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_payment_orders_out_trade_no", table_name="payment_orders")
    op.drop_index("ix_payment_orders_user_id", table_name="payment_orders")
    op.drop_table("payment_orders")
    op.drop_column("system_settings", "linuxdo_credits_per_cny")
    op.drop_column("system_settings", "epay_key_enc")
    op.drop_column("system_settings", "epay_pid")
