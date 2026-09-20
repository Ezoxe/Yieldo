from datetime import UTC, date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# What the pipeline is allowed to do with an answer.
#
# `observer`  the model is asked, nothing is ever sent. The decision feed fills
#             up and no order exists.
# `paper`     orders are sent to a `paper` venue.
# `live`      orders are sent to a `live` venue, inside the mandate, and only
#             while `armed_until` is in the future.
#
# There is deliberately no `auto_live_forever`: `live` already expires.
AUTONOMY_MODES = ("observer", "paper", "live")


class TradingPolicy(Base):
    """The mandate: everything the household authorised, in figures.

    One row per user. `engines/trading_risk.Mandate` is built from it at the
    route boundary and every order is measured against it -- see that module
    for what each ceiling means and why a size rule reduces where a permission
    rule refuses.

    **`allowed_symbols` empty means nothing is tradable.** Not everything. The
    permissive reading of an empty whitelist is how an agent ends up holding an
    instrument nobody chose, and the column defaults to empty so a policy row
    created and forgotten authorises no trade at all.

    **`armed_until` is the live gate, and it is a timestamp rather than a
    flag.** A boolean can be left true for a year by someone who meant to try
    something for an afternoon. An arming expires by itself, and re-arming
    takes the confirmation phrase again -- `POST /api/invest/policy/arm`,
    `get_session_user`, so an agent access key can never do it.

    **`halted` is the opposite asymmetry, on purpose.** Stopping is open to any
    credential that can read the account, the agent access key included: a
    supervising agent that spots something wrong must be able to pull the cord
    even though it could never have started the engine. Restarting takes a
    session. That asymmetry is the whole design of
    `api/invest_oversight.halt`.
    """

    __tablename__ = "trading_policies"
    __table_args__ = (UniqueConstraint("user_id", name="uq_trading_policy_user"),)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )

    # --- What may be risked. Cents, inclusive ceilings. -------------------
    max_position_cents: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    max_exposure_cents: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    max_order_notional_cents: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    max_daily_loss_cents: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    min_cash_buffer_cents: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    # The floor under one order after any reduction -- see
    # `engines/trading_risk.Mandate.min_order_notional_cents`. Defaults to 10 €,
    # not 0: a mandate created and never tuned should not be sending
    # twelve-cent orders.
    min_order_notional_cents: Mapped[int] = mapped_column(
        Integer, default=1_000, server_default=text("1000"), nullable=False
    )
    max_drawdown_bps: Mapped[int] = mapped_column(
        Integer, default=1_000, server_default=text("1000"), nullable=False
    )
    max_orders_per_day: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )

    # --- What may be traded. ----------------------------------------------
    # Comma-separated upper-case symbols. A JSON column would be tidier, but
    # this one is edited by hand on screen and read in French error sentences;
    # a text list is what both sides already speak.
    allowed_symbols: Mapped[str] = mapped_column(
        Text, default="", server_default=text("''"), nullable=False
    )
    allow_short: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("0"), nullable=False
    )
    allow_leverage: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("0"), nullable=False
    )
    allow_limit_orders: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("1"), nullable=False
    )

    # --- When an answer is worth acting on (decision/strategy.py). ---------
    minimum_conviction: Mapped[int] = mapped_column(
        Integer, default=6, server_default=text("6"), nullable=False
    )
    minimum_probability_bps: Mapped[int] = mapped_column(
        Integer, default=5_500, server_default=text("5500"), nullable=False
    )
    max_volatility_bps: Mapped[int] = mapped_column(
        Integer, default=1_500, server_default=text("1500"), nullable=False
    )
    full_conviction_share_bps: Mapped[int] = mapped_column(
        Integer, default=10_000, server_default=text("10000"), nullable=False
    )

    # --- How much authority the answer carries. ---------------------------
    # One of AUTONOMY_MODES. `observer` by default: a policy row that exists
    # and was never configured watches, it does not trade.
    autonomy: Mapped[str] = mapped_column(
        String(16), default="observer", server_default=text("'observer'"), nullable=False
    )
    # Live execution is open only while this is in the future. None means never
    # armed.
    armed_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # --- The cord. --------------------------------------------------------
    halted: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("0"), nullable=False
    )
    halted_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    halted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Who pulled it: "household" (a session) or "supervision" (an agent key).
    # Kept because the two mean different things to whoever reads the screen
    # afterwards.
    halted_by: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # --- Counters the mandate reads, reset by the route when the day turns. -
    counters_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    orders_today: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    realised_pnl_today_cents: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC), nullable=False,
    )
