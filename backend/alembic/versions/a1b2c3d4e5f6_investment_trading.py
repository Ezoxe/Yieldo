"""investment environment: venues, mandate, decisions, orders, audit chain

Revision ID: a1b2c3d4e5f6
Revises: e4a7c1d9b2f6
Create Date: 2026-09-20 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'e4a7c1d9b2f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Eight new tables, no backfill and no change to any existing one.

    The investment environment is additive: a household that never opens it
    carries eight empty tables and nothing else. There is deliberately no data
    migration here -- there is no finance row that could be reinterpreted as a
    trading row, and inventing one would be inventing a position.

    **Every default in this migration is the restrictive one**, matching the
    models: a `trading_policies` row created by this schema authorises no
    instrument (`allowed_symbols` empty), risks nothing (every ceiling at
    zero), and watches rather than trades (`autonomy = 'observer'`). A
    permissive default here would be a live mandate created by an upgrade.
    """
    op.create_table(
        "trading_venues",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("venue", sa.String(length=24), nullable=False),
        sa.Column("mode", sa.String(length=8), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("api_key_encrypted", sa.Text(), nullable=True),
        sa.Column("api_secret_encrypted", sa.Text(), nullable=True),
        sa.Column("base_url", sa.String(length=500), nullable=True),
        sa.Column("slippage_bps", sa.Integer(), server_default=sa.text("10"), nullable=False),
        sa.Column("price_source", sa.String(length=12), server_default=sa.text("'venue'"), nullable=False),
        sa.Column("sandbox_step", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_check_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_check_ok", sa.Boolean(), nullable=True),
        sa.Column("last_check_message", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "venue", "mode", name="uq_trading_venue_user_venue_mode"),
    )
    op.create_index(op.f("ix_trading_venues_user_id"), "trading_venues", ["user_id"])

    op.create_table(
        "trading_policies",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("max_position_cents", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("max_exposure_cents", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("max_order_notional_cents", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("max_daily_loss_cents", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("min_cash_buffer_cents", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("min_order_notional_cents", sa.Integer(), server_default=sa.text("1000"), nullable=False),
        sa.Column("max_drawdown_bps", sa.Integer(), server_default=sa.text("1000"), nullable=False),
        sa.Column("max_orders_per_day", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("allowed_symbols", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("allow_short", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("allow_leverage", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("allow_limit_orders", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        sa.Column("minimum_conviction", sa.Integer(), server_default=sa.text("6"), nullable=False),
        sa.Column("minimum_probability_bps", sa.Integer(), server_default=sa.text("5500"), nullable=False),
        sa.Column("max_volatility_bps", sa.Integer(), server_default=sa.text("1500"), nullable=False),
        sa.Column("full_conviction_share_bps", sa.Integer(), server_default=sa.text("10000"), nullable=False),
        sa.Column("autonomy", sa.String(length=16), server_default=sa.text("'observer'"), nullable=False),
        sa.Column("armed_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("halted", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("halted_reason", sa.Text(), nullable=True),
        sa.Column("halted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("halted_by", sa.String(length=16), nullable=True),
        sa.Column("counters_on", sa.Date(), nullable=True),
        sa.Column("orders_today", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("realised_pnl_today_cents", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_trading_policy_user"),
    )
    op.create_index(op.f("ix_trading_policies_user_id"), "trading_policies", ["user_id"])

    op.create_table(
        "decision_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=16), nullable=False),
        sa.Column("endpoint_url", sa.String(length=500), nullable=True),
        sa.Column("model_name", sa.String(length=200), nullable=True),
        sa.Column("api_key_encrypted", sa.Text(), nullable=True),
        sa.Column("timeout_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_decision_settings_user"),
    )
    op.create_index(op.f("ix_decision_settings_user_id"), "decision_settings", ["user_id"])

    op.create_table(
        "trading_accounts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("mode", sa.String(length=8), nullable=False),
        sa.Column("currency", sa.String(length=3), server_default=sa.text("'EUR'"), nullable=False),
        sa.Column("cash_cents", sa.Integer(), nullable=False),
        sa.Column("initial_cash_cents", sa.Integer(), nullable=False),
        sa.Column("peak_equity_cents", sa.Integer(), nullable=False),
        sa.Column("counters_on", sa.Date(), nullable=True),
        sa.Column("orders_today", sa.Integer(), nullable=False),
        sa.Column("realised_pnl_today_cents", sa.Integer(), nullable=False),
        sa.Column("realised_pnl_total_cents", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "mode", name="uq_trading_account_user_mode"),
    )
    op.create_index(op.f("ix_trading_accounts_user_id"), "trading_accounts", ["user_id"])

    op.create_table(
        "trading_positions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("mode", sa.String(length=8), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("quantity", sa.String(length=64), nullable=False),
        sa.Column("average_price_cents", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "mode", "symbol", name="uq_trading_position_user_mode_symbol"),
    )
    op.create_index(op.f("ix_trading_positions_user_id"), "trading_positions", ["user_id"])
    op.create_index(op.f("ix_trading_positions_symbol"), "trading_positions", ["symbol"])

    op.create_table(
        "trade_decisions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("mode", sa.String(length=8), nullable=False),
        sa.Column("venue_id", sa.Integer(), nullable=True),
        sa.Column("provider", sa.String(length=16), nullable=False),
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("features", sa.JSON(), nullable=False),
        sa.Column("windows", sa.JSON(), nullable=False),
        sa.Column("context", sa.JSON(), nullable=False),
        sa.Column("questions", sa.JSON(), nullable=False),
        sa.Column("answers", sa.JSON(), nullable=False),
        sa.Column("reference_price_cents", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column("rule", sa.String(length=48), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("risk_verdict", sa.JSON(), nullable=True),
        sa.Column("inputs_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["venue_id"], ["trading_venues.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_trade_decisions_user_id"), "trade_decisions", ["user_id"])
    op.create_index(op.f("ix_trade_decisions_run_id"), "trade_decisions", ["run_id"])
    op.create_index(op.f("ix_trade_decisions_symbol"), "trade_decisions", ["symbol"])
    op.create_index(op.f("ix_trade_decisions_outcome"), "trade_decisions", ["outcome"])
    op.create_index(op.f("ix_trade_decisions_venue_id"), "trade_decisions", ["venue_id"])
    op.create_index(op.f("ix_trade_decisions_created_at"), "trade_decisions", ["created_at"])

    op.create_table(
        "trade_orders",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("decision_id", sa.Integer(), nullable=True),
        sa.Column("venue_id", sa.Integer(), nullable=True),
        sa.Column("mode", sa.String(length=8), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("side", sa.String(length=8), nullable=False),
        sa.Column("order_type", sa.String(length=8), nullable=False),
        sa.Column("quantity", sa.String(length=64), nullable=False),
        sa.Column("requested_quantity", sa.String(length=64), nullable=False),
        sa.Column("limit_price_cents", sa.Integer(), nullable=True),
        sa.Column("reference_price_cents", sa.Integer(), nullable=False),
        sa.Column("notional_cents", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("idempotency_key", sa.String(length=64), nullable=False),
        sa.Column("external_id", sa.String(length=120), nullable=True),
        sa.Column("filled_quantity", sa.String(length=64), nullable=True),
        sa.Column("average_price_cents", sa.Integer(), nullable=True),
        sa.Column("cost_cents", sa.Integer(), nullable=False),
        sa.Column("realised_pnl_cents", sa.Integer(), nullable=False),
        sa.Column("rule", sa.String(length=48), nullable=True),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["decision_id"], ["trade_decisions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["venue_id"], ["trading_venues.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "idempotency_key", name="uq_trade_order_idempotency"),
    )
    op.create_index(op.f("ix_trade_orders_user_id"), "trade_orders", ["user_id"])
    op.create_index(op.f("ix_trade_orders_decision_id"), "trade_orders", ["decision_id"])
    op.create_index(op.f("ix_trade_orders_venue_id"), "trade_orders", ["venue_id"])
    op.create_index(op.f("ix_trade_orders_symbol"), "trade_orders", ["symbol"])
    op.create_index(op.f("ix_trade_orders_status"), "trade_orders", ["status"])
    op.create_index(op.f("ix_trade_orders_mode"), "trade_orders", ["mode"])
    op.create_index(op.f("ix_trade_orders_created_at"), "trade_orders", ["created_at"])

    op.create_table(
        "trade_audit_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("actor", sa.String(length=12), nullable=False),
        sa.Column("previous_hash", sa.String(length=64), nullable=False),
        sa.Column("entry_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "sequence", name="uq_trade_audit_user_sequence"),
    )
    op.create_index(op.f("ix_trade_audit_events_user_id"), "trade_audit_events", ["user_id"])
    op.create_index(op.f("ix_trade_audit_events_kind"), "trade_audit_events", ["kind"])
    op.create_index(op.f("ix_trade_audit_events_created_at"), "trade_audit_events", ["created_at"])


def downgrade() -> None:
    """Drop all eight, children first.

    A downgrade DESTROYS the audit chain along with the decisions it attests
    to. That is unavoidable -- there is nowhere else to put them -- and it is
    why an operator should export the journal
    (`GET /api/invest/oversight/journal`) before downgrading past this
    revision. Nothing in the finance half of the application is touched either
    way.
    """
    op.drop_table("trade_audit_events")
    op.drop_table("trade_orders")
    op.drop_table("trade_decisions")
    op.drop_table("trading_positions")
    op.drop_table("trading_accounts")
    op.drop_table("decision_settings")
    op.drop_table("trading_policies")
    op.drop_table("trading_venues")
