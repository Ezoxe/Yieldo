"""llm settings

Revision ID: 5458e8e862b1
Revises: 035256084eae
Create Date: 2026-09-03 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '5458e8e862b1'
down_revision: Union[str, Sequence[str], None] = '035256084eae'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    One new table, no backfill: nothing in an existing database can become a
    configured language model. `user_id` is `unique` -- at most one row per
    user, matching `app/models/llm_settings.py`'s own docstring -- with the
    same foreign key, index and `ondelete="CASCADE"` `api_keys` and
    `quota_windows` already use, for the identical isolation reason.
    """
    op.create_table(
        "llm_settings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("endpoint_url", sa.String(length=500), nullable=False),
        sa.Column("model_name", sa.String(length=200), nullable=False),
        sa.Column("api_key_encrypted", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_llm_settings_user"),
    )
    op.create_index(op.f("ix_llm_settings_user_id"), "llm_settings", ["user_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_llm_settings_user_id"), table_name="llm_settings")
    op.drop_table("llm_settings")
