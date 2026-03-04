"""Add LinuxDO OAuth fields to system_settings and users.

Revision ID: c3d4e5f6a7b8
Revises: b6c1f2a9d7e4
Create Date: 2026-03-04
"""

from alembic import op
import sqlalchemy as sa


revision = "c3d4e5f6a7b8"
down_revision = "b6c1f2a9d7e4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- system_settings: LinuxDO OAuth config --
    op.add_column(
        "system_settings",
        sa.Column("linuxdo_client_id", sa.String(200), nullable=True),
    )
    op.add_column(
        "system_settings",
        sa.Column("linuxdo_client_secret_enc", sa.Text(), nullable=True),
    )
    op.add_column(
        "system_settings",
        sa.Column("linuxdo_redirect_uri", sa.String(500), nullable=True),
    )

    # -- users: LinuxDO identity fields --
    op.add_column(
        "users",
        sa.Column("linuxdo_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("linuxdo_username", sa.String(100), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("linuxdo_avatar_url", sa.String(500), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("linuxdo_trust_level", sa.Integer(), nullable=True),
    )
    op.create_unique_constraint("uq_users_linuxdo_id", "users", ["linuxdo_id"])
    op.create_index("ix_users_linuxdo_id", "users", ["linuxdo_id"])

    # -- users: make password_hash nullable (OAuth users have no password) --
    op.alter_column(
        "users",
        "password_hash",
        existing_type=sa.String(255),
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "users",
        "password_hash",
        existing_type=sa.String(255),
        nullable=False,
    )
    op.drop_index("ix_users_linuxdo_id", table_name="users")
    op.drop_constraint("uq_users_linuxdo_id", "users", type_="unique")
    op.drop_column("users", "linuxdo_trust_level")
    op.drop_column("users", "linuxdo_avatar_url")
    op.drop_column("users", "linuxdo_username")
    op.drop_column("users", "linuxdo_id")
    op.drop_column("system_settings", "linuxdo_redirect_uri")
    op.drop_column("system_settings", "linuxdo_client_secret_enc")
    op.drop_column("system_settings", "linuxdo_client_id")
