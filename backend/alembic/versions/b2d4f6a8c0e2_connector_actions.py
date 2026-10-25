"""connector actions

Revision ID: b2d4f6a8c0e2
Revises: a1c3e5f7b9d1
Create Date: 2026-10-25 00:00:01.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b2d4f6a8c0e2'
down_revision: Union[str, Sequence[str], None] = 'a1c3e5f7b9d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """One new table, no backfill: the connector has done nothing yet."""
    op.create_table(
        "connector_actions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("tool", sa.String(length=64), nullable=False),
        sa.Column("args", sa.JSON(), nullable=False),
        sa.Column("approval_id", sa.String(length=64), nullable=True),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_connector_actions_user_id"), "connector_actions", ["user_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_connector_actions_user_id"), table_name="connector_actions")
    op.drop_table("connector_actions")
