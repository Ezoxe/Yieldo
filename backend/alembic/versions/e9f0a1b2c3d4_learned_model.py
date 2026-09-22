"""the learned decision model's weights

Revision ID: e9f0a1b2c3d4
Revises: d8e9f0a1b2c3
Create Date: 2026-09-22 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e9f0a1b2c3d4'
down_revision: Union[str, Sequence[str], None] = 'd8e9f0a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """One nullable JSON column: the weights of a model the household trained
    itself. NULL for every other provider, and for every row written before."""
    with op.batch_alter_table("decision_settings") as batch:
        batch.add_column(sa.Column("learned_model", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("decision_settings") as batch:
        batch.drop_column("learned_model")
