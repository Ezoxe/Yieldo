"""the rules' second opinion beside a model's decision

Revision ID: c7d8e9f0a1b2
Revises: a1b2c3d4e5f6
Create Date: 2026-09-21 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c7d8e9f0a1b2'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """One nullable JSON column on `trade_decisions`, no backfill: a decision
    taken before this revision has no second opinion, and NULL says so. The
    audit chain hashes nothing from this column, so every sealed entry stays
    verifiable."""
    with op.batch_alter_table("trade_decisions") as batch:
        batch.add_column(sa.Column("second_opinion", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("trade_decisions") as batch:
        batch.drop_column("second_opinion")
