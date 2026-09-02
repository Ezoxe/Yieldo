"""allocation targets

Revision ID: bf18816b285c
Revises: 5fa05f976fab
Create Date: 2026-09-02 14:02:11.480316

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'bf18816b285c'
down_revision: Union[str, Sequence[str], None] = '5fa05f976fab'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    One new table, no backfill: nothing in an existing database can become a
    target allocation. A target is a household's own declared intention, so
    it carries `user_id` with the same foreign key, index and
    `ondelete="CASCADE"` every other business table in this app uses -- see
    `app/models/allocation_target.py`.

    `target_bps` has no `server_default`: it has no ORM default either, and
    a target with no declared share is not a thing -- 0 % would be a
    declaration, not an absence.
    """
    op.create_table(
        "allocation_targets",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("asset_class", sa.String(length=24), nullable=False),
        sa.Column("target_bps", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "asset_class",
                            name="uq_allocation_target_user_asset_class"),
    )
    op.create_index(
        op.f("ix_allocation_targets_user_id"), "allocation_targets", ["user_id"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_allocation_targets_user_id"), table_name="allocation_targets")
    op.drop_table("allocation_targets")
