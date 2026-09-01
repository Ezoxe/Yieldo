"""health snapshots and challenges

Revision ID: 4aa48828b2cb
Revises: d1a4c9e77b02
Create Date: 2026-09-01 21:03:24.401901

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '4aa48828b2cb'
down_revision: Union[str, Sequence[str], None] = 'd1a4c9e77b02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Two new tables, no backfill: nothing in an existing database can be
    turned into a health snapshot or a challenge. `server_default` is set on
    every NOT NULL column with an ORM default, matching d1a4c9e77b02, so a
    future ALTER on SQLite and any hand-written INSERT behave the same way
    the ORM does.
    """
    op.create_table(
        "health_snapshots",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("taken_on", sa.Date(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("components", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "taken_on", name="uq_health_snapshot_user_taken_on"),
    )
    op.create_index(
        op.f("ix_health_snapshots_user_id"), "health_snapshots", ["user_id"], unique=False
    )

    op.create_table(
        "challenges",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("target_cents", sa.Integer(), nullable=True),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("proposed_on", sa.Date(), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False,
                  server_default=sa.text("'proposed'")),
        sa.Column("decided_on", sa.Date(), nullable=True),
        sa.Column("measured_cents", sa.Integer(), nullable=True),
        sa.Column("measured_on", sa.Date(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_challenges_user_id"), "challenges", ["user_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_challenges_user_id"), table_name="challenges")
    op.drop_table("challenges")
    op.drop_index(op.f("ix_health_snapshots_user_id"), table_name="health_snapshots")
    op.drop_table("health_snapshots")
