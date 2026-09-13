"""recurrence dismissals

Revision ID: d8f3b2c7e5a1
Revises: c6d2e9f4a1b7
Create Date: 2026-09-13 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd8f3b2c7e5a1'
down_revision: Union[str, Sequence[str], None] = 'c6d2e9f4a1b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """One new table, no backfill: a dismissal is something the household
    says, and nobody has said anything yet."""
    op.create_table(
        "recurrence_dismissals",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("label_key", sa.String(length=500), nullable=False),
        sa.Column("label", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "label_key", name="uq_recurrence_dismissal_user_key"),
    )
    op.create_index(
        "ix_recurrence_dismissals_user_id", "recurrence_dismissals", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_recurrence_dismissals_user_id", table_name="recurrence_dismissals")
    op.drop_table("recurrence_dismissals")
