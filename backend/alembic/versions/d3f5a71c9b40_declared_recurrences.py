"""Recurrences a household declares, and the due dates it ticks off.

`engines/recurrence.py` reads rhythms off the past. It needs three occurrences
before it will speak and it refuses any charge whose amount wanders -- which is
every water and electricity bill there is. Both refusals are right for a
detector; both leave the household unable to say "I pay this, on this day,
every month" about a bill it knows perfectly well it has.

Two tables. A declaration states the fact; a check-in ticks off one of its due
dates and carries the amount actually billed, which for a variable charge is
exactly what the declaration could not know.

The unique constraint on (declared_recurrence_id, due_on) is the load-bearing
one: pointing the same due date twice is the same act, and a second row would
double that month in every total.

Revision ID: d3f5a71c9b40
Revises: c8e2f1a54d90
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d3f5a71c9b40"
down_revision: str | Sequence[str] | None = "c8e2f1a54d90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "declared_recurrences",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("account_id", sa.Integer(), nullable=True),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("amount_is_variable", sa.Boolean(), nullable=False,
                  server_default=sa.text("0")),
        sa.Column("periodicity", sa.String(length=16), nullable=False),
        sa.Column("anchor_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("notes", sa.String(length=2000), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_declared_recurrences_user_id", "declared_recurrences", ["user_id"])
    op.create_index(
        "ix_declared_recurrence_user", "declared_recurrences", ["user_id", "active"]
    )

    op.create_table(
        "recurrence_checkins",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("declared_recurrence_id", sa.Integer(), nullable=False),
        sa.Column("due_on", sa.Date(), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("paid_on", sa.Date(), nullable=False),
        sa.Column("transaction_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["declared_recurrence_id"], ["declared_recurrences.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["transaction_id"], ["transactions.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "declared_recurrence_id", "due_on", name="uq_checkin_recurrence_due"
        ),
    )
    op.create_index("ix_recurrence_checkins_user_id", "recurrence_checkins", ["user_id"])
    op.create_index(
        "ix_recurrence_checkins_declared_recurrence_id",
        "recurrence_checkins",
        ["declared_recurrence_id"],
    )


def downgrade() -> None:
    op.drop_table("recurrence_checkins")
    op.drop_table("declared_recurrences")
