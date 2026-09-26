"""the installation's own settings

Revision ID: b4d6f8a0c2e4
Revises: a3c5e7f9b1d2
Create Date: 2026-09-26 00:00:01.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b4d6f8a0c2e4'
down_revision: Union[str, Sequence[str], None] = 'a3c5e7f9b1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """One row at most, written the first time the administrator chooses.
    Until then registration follows YIELDO_REGISTRATION_OPEN."""
    op.create_table(
        "instance_settings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("registration_open", sa.Boolean(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("instance_settings")
