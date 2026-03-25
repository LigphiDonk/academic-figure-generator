"""Add user-level NanoBanana model override.

Revision ID: a8b9c0d1e2f3
Revises: f6a7b8c9d0e1
Create Date: 2026-03-25
"""

from alembic import op
import sqlalchemy as sa


revision = "a8b9c0d1e2f3"
down_revision = "f6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "nanobanana_model",
            sa.String(length=100),
            nullable=True,
            comment="User-selected NanoBanana model",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "nanobanana_model")
