"""Generalize prompt AI provider fields from Claude-specific names.

Revision ID: f6a7b8c9d0e1
Revises: e1f2a3b4c5d6
Create Date: 2026-03-25
"""

from alembic import op
import sqlalchemy as sa


revision = "f6a7b8c9d0e1"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "prompt_ai_provider",
            sa.String(length=50),
            nullable=False,
            server_default="anthropic",
            comment="User-selected Prompt AI provider",
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "prompt_ai_model",
            sa.String(length=100),
            nullable=True,
            comment="User-selected Prompt AI model",
        ),
    )
    op.alter_column(
        "users",
        "claude_api_key_enc",
        existing_type=sa.Text(),
        existing_nullable=True,
        new_column_name="prompt_ai_api_key_enc",
    )
    op.alter_column(
        "users",
        "claude_api_base_url",
        existing_type=sa.String(length=500),
        existing_nullable=True,
        new_column_name="prompt_ai_api_base_url",
    )
    op.alter_column(
        "users",
        "claude_tokens_quota",
        existing_type=sa.Integer(),
        existing_nullable=False,
        new_column_name="prompt_ai_tokens_quota",
    )

    op.add_column(
        "system_settings",
        sa.Column(
            "prompt_ai_provider",
            sa.String(length=50),
            nullable=False,
            server_default="anthropic",
            comment="System default Prompt AI provider",
        ),
    )
    op.alter_column(
        "system_settings",
        "claude_api_key_enc",
        existing_type=sa.Text(),
        existing_nullable=True,
        new_column_name="prompt_ai_api_key_enc",
    )
    op.alter_column(
        "system_settings",
        "claude_api_base_url",
        existing_type=sa.String(length=500),
        existing_nullable=True,
        new_column_name="prompt_ai_api_base_url",
    )
    op.alter_column(
        "system_settings",
        "claude_model",
        existing_type=sa.String(length=100),
        existing_nullable=True,
        new_column_name="prompt_ai_model",
    )
    op.alter_column(
        "system_settings",
        "claude_input_usd_per_million",
        existing_type=sa.Numeric(10, 4),
        existing_nullable=False,
        new_column_name="prompt_ai_input_usd_per_million",
    )
    op.alter_column(
        "system_settings",
        "claude_output_usd_per_million",
        existing_type=sa.Numeric(10, 4),
        existing_nullable=False,
        new_column_name="prompt_ai_output_usd_per_million",
    )

    op.add_column(
        "prompts",
        sa.Column(
            "generator_provider",
            sa.String(length=50),
            nullable=False,
            server_default="anthropic",
            comment="Prompt generator provider",
        ),
    )
    op.alter_column(
        "prompts",
        "claude_model",
        existing_type=sa.String(length=50),
        existing_nullable=True,
        new_column_name="generator_model",
    )

    op.add_column(
        "usage_logs",
        sa.Column(
            "provider",
            sa.String(length=50),
            nullable=True,
            comment="Prompt AI provider for text generation records",
        ),
    )
    op.alter_column(
        "usage_logs",
        "claude_model",
        existing_type=sa.String(length=50),
        existing_nullable=True,
        new_column_name="model",
    )
    op.execute("UPDATE usage_logs SET api_name = 'prompt_ai' WHERE api_name = 'claude'")
    op.execute(
        "UPDATE usage_logs SET provider = 'anthropic' "
        "WHERE api_name = 'prompt_ai' AND provider IS NULL"
    )


def downgrade() -> None:
    op.execute("UPDATE usage_logs SET api_name = 'claude' WHERE api_name = 'prompt_ai'")
    op.drop_column("usage_logs", "provider")
    op.alter_column(
        "usage_logs",
        "model",
        existing_type=sa.String(length=50),
        existing_nullable=True,
        new_column_name="claude_model",
    )

    op.alter_column(
        "prompts",
        "generator_model",
        existing_type=sa.String(length=50),
        existing_nullable=True,
        new_column_name="claude_model",
    )
    op.drop_column("prompts", "generator_provider")

    op.alter_column(
        "system_settings",
        "prompt_ai_output_usd_per_million",
        existing_type=sa.Numeric(10, 4),
        existing_nullable=False,
        new_column_name="claude_output_usd_per_million",
    )
    op.alter_column(
        "system_settings",
        "prompt_ai_input_usd_per_million",
        existing_type=sa.Numeric(10, 4),
        existing_nullable=False,
        new_column_name="claude_input_usd_per_million",
    )
    op.alter_column(
        "system_settings",
        "prompt_ai_model",
        existing_type=sa.String(length=100),
        existing_nullable=True,
        new_column_name="claude_model",
    )
    op.alter_column(
        "system_settings",
        "prompt_ai_api_base_url",
        existing_type=sa.String(length=500),
        existing_nullable=True,
        new_column_name="claude_api_base_url",
    )
    op.alter_column(
        "system_settings",
        "prompt_ai_api_key_enc",
        existing_type=sa.Text(),
        existing_nullable=True,
        new_column_name="claude_api_key_enc",
    )
    op.drop_column("system_settings", "prompt_ai_provider")

    op.alter_column(
        "users",
        "prompt_ai_tokens_quota",
        existing_type=sa.Integer(),
        existing_nullable=False,
        new_column_name="claude_tokens_quota",
    )
    op.alter_column(
        "users",
        "prompt_ai_api_base_url",
        existing_type=sa.String(length=500),
        existing_nullable=True,
        new_column_name="claude_api_base_url",
    )
    op.alter_column(
        "users",
        "prompt_ai_api_key_enc",
        existing_type=sa.Text(),
        existing_nullable=True,
        new_column_name="claude_api_key_enc",
    )
    op.drop_column("users", "prompt_ai_model")
    op.drop_column("users", "prompt_ai_provider")
