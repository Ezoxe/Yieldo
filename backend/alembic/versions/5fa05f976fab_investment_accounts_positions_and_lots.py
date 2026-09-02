"""investment accounts, positions and lots

Revision ID: 5fa05f976fab
Revises: 4aa48828b2cb
Create Date: 2026-09-02 09:09:47.609566

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '5fa05f976fab'
down_revision: Union[str, Sequence[str], None] = '4aa48828b2cb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Seven new tables, no backfill: nothing in an existing database can become
    an instrument, an investment account, a position, a lot, a price point,
    an api key or a quota window. `server_default` is set on every NOT NULL
    column with an ORM default, matching d1a4c9e77b02 and 4aa48828b2cb.

    Tables are created in dependency order: `instruments` and
    `investment_accounts` first (no cross-references between them),
    `positions` next (references both), `lots` and `price_points` after
    (reference `positions` and `instruments` respectively), then the two
    operator-level tables `api_keys` and `quota_windows`, which reference
    nothing.

    `instruments`, `price_points`, `api_keys` and `quota_windows` carry no
    `user_id` -- see `app/models/instrument.py` and `app/models/api_key.py`
    for why: market data and provider credentials are shared by the whole
    self-hosted installation behind ONE quota pool per provider, not
    duplicated per user.
    """
    op.create_table(
        "instruments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("asset_class", sa.String(length=24), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("is_fractionable", sa.Boolean(), nullable=False,
                  server_default=sa.text("0")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("symbol", "asset_class", name="uq_instrument_symbol_asset_class"),
    )

    op.create_table(
        "investment_accounts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False,
                  server_default=sa.text("'EUR'")),
        sa.Column("opened_on", sa.Date(), nullable=True),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_investment_accounts_user_id"), "investment_accounts", ["user_id"], unique=False
    )

    op.create_table(
        "positions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("investment_account_id", sa.Integer(), nullable=False),
        sa.Column("instrument_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["investment_account_id"], ["investment_accounts.id"],
                                ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["instrument_id"], ["instruments.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("investment_account_id", "instrument_id",
                            name="uq_position_account_instrument"),
    )
    op.create_index(op.f("ix_positions_user_id"), "positions", ["user_id"], unique=False)
    op.create_index(op.f("ix_positions_investment_account_id"), "positions",
                    ["investment_account_id"], unique=False)
    op.create_index(op.f("ix_positions_instrument_id"), "positions", ["instrument_id"],
                    unique=False)

    op.create_table(
        "lots",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("position_id", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.String(length=64), nullable=False),
        sa.Column("unit_cost_cents", sa.Integer(), nullable=False),
        sa.Column("acquired_on", sa.Date(), nullable=False),
        sa.ForeignKeyConstraint(["position_id"], ["positions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_lots_user_id"), "lots", ["user_id"], unique=False)
    op.create_index(op.f("ix_lots_position_id"), "lots", ["position_id"], unique=False)

    op.create_table(
        "price_points",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("instrument_id", sa.Integer(), nullable=False),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.Column("price_cents", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["instrument_id"], ["instruments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("instrument_id", "as_of", name="uq_price_point_instrument_as_of"),
    )
    op.create_index(op.f("ix_price_points_instrument_id"), "price_points", ["instrument_id"],
                    unique=False)

    op.create_table(
        "api_keys",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_api_keys_provider"), "api_keys", ["provider"], unique=True)

    op.create_table(
        "quota_windows",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_quota_windows_provider"), "quota_windows", ["provider"], unique=True)


def downgrade() -> None:
    """Downgrade schema. Reverse dependency order of upgrade()."""
    op.drop_index(op.f("ix_quota_windows_provider"), table_name="quota_windows")
    op.drop_table("quota_windows")

    op.drop_index(op.f("ix_api_keys_provider"), table_name="api_keys")
    op.drop_table("api_keys")

    op.drop_index(op.f("ix_price_points_instrument_id"), table_name="price_points")
    op.drop_table("price_points")

    op.drop_index(op.f("ix_lots_position_id"), table_name="lots")
    op.drop_index(op.f("ix_lots_user_id"), table_name="lots")
    op.drop_table("lots")

    op.drop_index(op.f("ix_positions_instrument_id"), table_name="positions")
    op.drop_index(op.f("ix_positions_investment_account_id"), table_name="positions")
    op.drop_index(op.f("ix_positions_user_id"), table_name="positions")
    op.drop_table("positions")

    op.drop_index(op.f("ix_investment_accounts_user_id"), table_name="investment_accounts")
    op.drop_table("investment_accounts")

    op.drop_table("instruments")
