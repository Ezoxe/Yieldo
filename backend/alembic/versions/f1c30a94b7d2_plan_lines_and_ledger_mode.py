"""plan lines and the ledger mode

Revision ID: f1c30a94b7d2
Revises: c4a1e78b2d95
Create Date: 2026-09-05 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f1c30a94b7d2"
down_revision: Union[str, Sequence[str], None] = "c4a1e78b2d95"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Two new tables, no backfill, and deliberately nothing written into
    `transactions`. A household that never opens the plan screen has no plan
    lines and no `plan_settings` row, which `api/plan.py` reads as the `real`
    mode -- the behaviour every screen has had until now. Nothing about an
    existing installation changes on deployment.

    `plan_settings.user_id` is unique for the same reason `llm_settings`'s is:
    there is one answer to "which reading am I in", never one per anything.

    `plan_lines` is indexed on `user_id` alone. Every read of this table is
    "the whole plan for this household" -- the expansion in
    `engines/plan.occurrences` needs every line to decide which fall inside a
    window, so there is no date-ranged query to index for.

    `dedup_hash` on `transactions` was widened from VARCHAR(64) to VARCHAR(80)
    in the model at the same time, to hold the ":n" suffix a deliberately kept
    duplicate carries. No DDL is emitted for it: SQLite does not enforce
    VARCHAR lengths, so the existing column already accepts the wider value and
    an ALTER would be a rebuild of the whole table for nothing.
    """
    op.create_table(
        "plan_lines",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), server_default="fixed", nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("account_id", sa.Integer(), nullable=True),
        sa.Column("periodicity", sa.String(length=16), server_default="monthly", nullable=False),
        sa.Column("day_of_month", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("start_on", sa.Date(), nullable=False),
        sa.Column("end_on", sa.Date(), nullable=True),
        sa.Column("match_label", sa.String(length=200), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        sa.Column("origin", sa.String(length=16), server_default="manual", nullable=False),
        sa.Column("notes", sa.String(length=2000), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_plan_lines_user_id"), "plan_lines", ["user_id"], unique=False)

    op.create_table(
        "plan_settings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("ledger_mode", sa.String(length=16), server_default="real", nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_plan_settings_user"),
    )
    op.create_index(op.f("ix_plan_settings_user_id"), "plan_settings", ["user_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema.

    Both tables go. Nothing outside them was written, so a downgrade loses the
    plan and the mode and touches no transaction.
    """
    op.drop_index(op.f("ix_plan_settings_user_id"), table_name="plan_settings")
    op.drop_table("plan_settings")
    op.drop_index(op.f("ix_plan_lines_user_id"), table_name="plan_lines")
    op.drop_table("plan_lines")
