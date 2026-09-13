"""net worth snapshots

Revision ID: c6d2e9f4a1b7
Revises: a5e71d0c46b3
Create Date: 2026-09-13 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c6d2e9f4a1b7'
down_revision: Union[str, Sequence[str], None] = 'a5e71d0c46b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """One new table, no backfill: a snapshot is a measurement taken on a
    day, and there is no honest way to invent the ones nobody took. Same
    foreign key, index and cascade as `health_snapshots`, and the same
    uniqueness on `(user_id, taken_on)`.
    """
    op.create_table(
        "net_worth_snapshots",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("taken_on", sa.Date(), nullable=False),
        sa.Column("assets_cents", sa.BigInteger(), nullable=False),
        sa.Column("debts_cents", sa.BigInteger(), nullable=False),
        sa.Column("breakdown", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "taken_on", name="uq_net_worth_snapshot_user_taken_on"),
    )
    op.create_index(
        "ix_net_worth_snapshots_user_id", "net_worth_snapshots", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_net_worth_snapshots_user_id", table_name="net_worth_snapshots")
    op.drop_table("net_worth_snapshots")
