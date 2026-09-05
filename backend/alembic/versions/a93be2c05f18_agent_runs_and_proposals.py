"""agent runs, steps and proposals

Revision ID: a93be2c05f18
Revises: f1c30a94b7d2
Create Date: 2026-09-05 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a93be2c05f18"
down_revision: Union[str, Sequence[str], None] = "f1c30a94b7d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Three new tables, no backfill, and nothing anywhere else touched. A
    household that never asks the agent anything has no runs and no proposals,
    and every screen behaves exactly as it did.

    `agent_proposals.run_id` is `SET NULL` rather than `CASCADE`, unlike every
    other foreign key in this schema: the run is the audit trail behind a
    proposal, and losing the trail must not silently delete a decision a
    household already made. `agent_steps.run_id` IS `CASCADE` — a step without
    its run is not evidence of anything.

    Indexed on `user_id` for the isolation every read path depends on, and on
    `run_id` because rendering a run means fetching its steps in order.
    """
    op.create_table(
        "agent_runs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("question", sa.String(length=2000), nullable=False),
        sa.Column("state", sa.String(length=16), server_default="running", nullable=False),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("notice", sa.Text(), nullable=True),
        sa.Column("steps_used", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_agent_runs_user_id"), "agent_runs", ["user_id"], unique=False)

    op.create_table(
        "agent_steps",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_agent_steps_run_id"), "agent_steps", ["run_id"], unique=False)

    op.create_table(
        "agent_proposals",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=True),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("evidence", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("before", sa.JSON(), nullable=False),
        sa.Column("state", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("applied_summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("affected", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_agent_proposals_user_id"), "agent_proposals", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_agent_proposals_run_id"), "agent_proposals", ["run_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema.

    All three go. Nothing outside them was written — an applied proposal's
    effect stays applied, because it was applied through the ordinary routes
    and is ordinary data now.
    """
    op.drop_index(op.f("ix_agent_proposals_run_id"), table_name="agent_proposals")
    op.drop_index(op.f("ix_agent_proposals_user_id"), table_name="agent_proposals")
    op.drop_table("agent_proposals")
    op.drop_index(op.f("ix_agent_steps_run_id"), table_name="agent_steps")
    op.drop_table("agent_steps")
    op.drop_index(op.f("ix_agent_runs_user_id"), table_name="agent_runs")
    op.drop_table("agent_runs")
