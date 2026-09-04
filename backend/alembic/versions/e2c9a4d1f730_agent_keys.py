"""agent access keys

Revision ID: e2c9a4d1f730
Revises: 9c17b3f4d2ae
Create Date: 2026-09-04 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e2c9a4d1f730'
down_revision: Union[str, Sequence[str], None] = '9c17b3f4d2ae'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    One new table, no backfill: an existing household has no agent key, and
    the first read of `GET /api/access-key` issues one. Nothing is created for
    them here, because a key created by a migration would be a key that started
    its twenty-four hours on the day of the deployment rather than on the day
    anyone asked for it.

    `selector` is uniquely indexed because it is the lookup on the
    authentication path: every request carrying a key resolves through it, and
    a table scan there would be a scan on every call. `user_id` is unique
    because exactly one key exists per account at a time — rotating replaces
    the row, so "the current key" is never a question of which of several is
    newest.

    Same foreign key, index and `ondelete="CASCADE"` as `api_keys`,
    `quota_windows`, `llm_settings` and `alert_settings`, for the identical
    isolation reason.
    """
    op.create_table(
        "agent_keys",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("selector", sa.String(length=32), nullable=False),
        sa.Column("secret_encrypted", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_agent_keys_user_id"), "agent_keys", ["user_id"], unique=True)
    op.create_index(op.f("ix_agent_keys_selector"), "agent_keys", ["selector"], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_agent_keys_selector"), table_name="agent_keys")
    op.drop_index(op.f("ix_agent_keys_user_id"), table_name="agent_keys")
    op.drop_table("agent_keys")
