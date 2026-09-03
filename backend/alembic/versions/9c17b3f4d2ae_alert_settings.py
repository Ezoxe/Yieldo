"""alert settings

Revision ID: 9c17b3f4d2ae
Revises: 5458e8e862b1
Create Date: 2026-09-03 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '9c17b3f4d2ae'
down_revision: Union[str, Sequence[str], None] = '5458e8e862b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    One new table, no backfill, and **`balance_floor_cents` is deliberately
    nullable with no server default**: an existing household has never set a
    floor, and a default of 0 would turn every one of them into a household
    watching for a zero balance -- raising a critical alert on the first
    visit that nobody asked for. See `app/models/alert_settings.py` for why
    `NULL` and `0` must stay distinguishable.

    Same foreign key, index and `ondelete="CASCADE"` as `api_keys`,
    `quota_windows` and `llm_settings`, for the identical isolation reason.
    """
    op.create_table(
        "alert_settings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("balance_floor_cents", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_alert_settings_user"),
    )
    op.create_index(
        op.f("ix_alert_settings_user_id"), "alert_settings", ["user_id"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_alert_settings_user_id"), table_name="alert_settings")
    op.drop_table("alert_settings")
