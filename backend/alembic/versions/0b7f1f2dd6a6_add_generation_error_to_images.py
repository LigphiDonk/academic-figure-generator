"""Add generation_error to images.

Revision ID: 0b7f1f2dd6a6
Revises: 5e5d8670cbfe
Create Date: 2026-03-01
"""

from alembic import op
import sqlalchemy as sa


revision = "0b7f1f2dd6a6"
down_revision = "5e5d8670cbfe"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("images", sa.Column("generation_error", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("images", "generation_error")

