"""Add per-resolution image pricing fields.

Revision ID: b6c1f2a9d7e4
Revises: 9a4d2f3c1b10
Create Date: 2026-03-02
"""

from alembic import op
import sqlalchemy as sa


revision = "b6c1f2a9d7e4"
down_revision = "9a4d2f3c1b10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "system_settings",
        sa.Column(
            "image_price_cny_1k",
            sa.Numeric(12, 2),
            nullable=False,
            server_default="1.5",
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "image_price_cny_2k",
            sa.Numeric(12, 2),
            nullable=False,
            server_default="1.5",
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "image_price_cny_4k",
            sa.Numeric(12, 2),
            nullable=False,
            server_default="1.5",
        ),
    )


def downgrade() -> None:
    op.drop_column("system_settings", "image_price_cny_4k")
    op.drop_column("system_settings", "image_price_cny_2k")
    op.drop_column("system_settings", "image_price_cny_1k")

