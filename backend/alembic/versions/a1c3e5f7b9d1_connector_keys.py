"""connector keys

Revision ID: a1c3e5f7b9d1
Revises: e8a0c2d4f6b8
Create Date: 2026-10-25 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a1c3e5f7b9d1'
down_revision: Union[str, Sequence[str], None] = 'e8a0c2d4f6b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """One new table, no backfill: a household has no connector key until it
    creates one in Réglages → Connexions. `selector` is uniquely indexed
    because it is the lookup on every connector call; `user_id` is unique
    because creating a key replaces the previous one."""
    op.create_table(
        "connector_keys",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("selector", sa.String(length=32), nullable=False),
        sa.Column("secret_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_connector_keys_user_id"), "connector_keys", ["user_id"], unique=True)
    op.create_index(op.f("ix_connector_keys_selector"), "connector_keys", ["selector"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_connector_keys_selector"), table_name="connector_keys")
    op.drop_index(op.f("ix_connector_keys_user_id"), table_name="connector_keys")
    op.drop_table("connector_keys")
