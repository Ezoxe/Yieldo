from datetime import UTC, date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TradingAccount(Base):
    """The cash and the counters the mandate is measured against, per mode.

    One row per `(user, mode)`: a household's paper account and its live
    account are different accounts with different money, and merging their
    counters would let a losing morning in the sandbox close the real one.

    **In `paper`, this row IS the account** -- its `cash_cents` is spent and
    credited by `engines/paper_book.apply_fill`, and `POST
    /api/invest/sandbox/reset` puts it back to `initial_cash_cents`.

    **In `live`, the venue owns the money and this row owns the counters.**
    `cash_cents` and `equity_cents` are refreshed from the broker before each
    cycle -- a mirror, never the source. `orders_today`,
    `realised_pnl_today_cents` and `peak_equity_cents` are Yieldo's own, because
    no broker tracks "how many orders has this particular mandate sent today".

    `counters_on` is the day the two counters belong to. The route compares it
    against `date.today()` read at the boundary and resets them when the day
    has turned -- the clock stays at the edge, as everywhere else in this
    codebase, so a test can turn the day over without touching the system
    clock.
    """

    __tablename__ = "trading_accounts"
    __table_args__ = (UniqueConstraint("user_id", "mode", name="uq_trading_account_user_mode"),)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # models.trading_venue.VENUE_MODES
    mode: Mapped[str] = mapped_column(String(8), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), default="EUR", server_default=text("'EUR'"), nullable=False
    )
    cash_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    initial_cash_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Highest equity ever recorded, for the drawdown ceiling. Never lowered
    # except by a sandbox reset.
    peak_equity_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    counters_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    orders_today: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    realised_pnl_today_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    realised_pnl_total_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC), nullable=False,
    )


class TradingPosition(Base):
    """What is held, per mode and per symbol.

    Distinct from phase 3's `Position`, which describes an envelope a household
    declares by hand and values from a price provider. This one is the running
    result of orders this pipeline sent: its `average_price_cents` is a cost
    basis maintained by `engines/paper_book.apply_fill`, and it exists for both
    modes so a live position and a paper position are read by the same code.
    """

    __tablename__ = "trading_positions"
    __table_args__ = (
        UniqueConstraint("user_id", "mode", "symbol", name="uq_trading_position_user_mode_symbol"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    mode: Mapped[str] = mapped_column(String(8), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    # engines.quantity.Quantity as text.
    quantity: Mapped[str] = mapped_column(String(64), nullable=False)
    average_price_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC), nullable=False,
    )
