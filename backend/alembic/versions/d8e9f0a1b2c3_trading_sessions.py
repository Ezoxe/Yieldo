"""the simulated trading day

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-09-21 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd8e9f0a1b2c3'
down_revision: Union[str, Sequence[str], None] = 'c7d8e9f0a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """One new table, and two nullable columns on `trade_decisions` so a
    decision can say which day and which step it belongs to. No backfill: a
    decision taken before this revision belongs to no day, and NULL says so."""
    op.create_table(
        "trading_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("venue_id", sa.Integer(),
                  sa.ForeignKey("trading_venues.id", ondelete="SET NULL"), nullable=True),
        sa.Column("mode", sa.String(length=8), nullable=False),
        sa.Column("seed", sa.Integer(), nullable=False),
        sa.Column("steps", sa.Integer(), nullable=False),
        sa.Column("interval_minutes", sa.Integer(), nullable=False),
        sa.Column("completed_steps", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("stop_requested", sa.Boolean(), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("provider", sa.String(length=16), nullable=False),
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("initial_cash_cents", sa.Integer(), nullable=False),
        sa.Column("final_equity_cents", sa.Integer(), nullable=True),
        sa.Column("realised_pnl_cents", sa.Integer(), nullable=False),
        sa.Column("unrealised_pnl_cents", sa.Integer(), nullable=False),
        sa.Column("max_drawdown_bps", sa.Integer(), nullable=False),
        sa.Column("orders", sa.Integer(), nullable=False),
        sa.Column("decisions", sa.Integer(), nullable=False),
        sa.Column("points", sa.JSON(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_trading_sessions_user_id", "trading_sessions", ["user_id"])

    with op.batch_alter_table("trade_decisions") as batch:
        batch.add_column(sa.Column("session_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("session_step", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_trade_decisions_session_id_trading_sessions", "trading_sessions",
            ["session_id"], ["id"], ondelete="SET NULL",
        )
        batch.create_index("ix_trade_decisions_session_id", ["session_id"])


def downgrade() -> None:
    with op.batch_alter_table("trade_decisions") as batch:
        batch.drop_index("ix_trade_decisions_session_id")
        batch.drop_constraint(
            "fk_trade_decisions_session_id_trading_sessions", type_="foreignkey"
        )
        batch.drop_column("session_step")
        batch.drop_column("session_id")
    op.drop_index("ix_trading_sessions_user_id", table_name="trading_sessions")
    op.drop_table("trading_sessions")
