"""A simulated trading day: a run of consecutive sandbox steps against one
model, from a replayable starting point, with its capital curve.

The sandbox market is deterministic by `(symbol, index)`, so a day is fully
described by its `seed` (the starting index) and its `steps`. The same seed
replays the same prices under another model or another mandate -- that is
what makes « Laya contre les règles » a comparison rather than two anecdotes.

`points` is a JSON list, one entry per completed step (`step`, `equity_cents`,
`cash_cents`, `exposure_cents`, `orders`). A day is at most a few hundred
steps, so the list stays small; the prices themselves are NOT stored -- they
are recomputed from the seed by `trading/sandbox.py` whenever a screen asks.

Paper only: a day resets the sandbox account before it starts, and there is
no path from here to a live order book.
"""

from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

SESSION_STATUSES = ("running", "finished", "stopped", "failed")

DEFAULT_STEPS = 78
DEFAULT_INTERVAL_MINUTES = 5
MIN_STEPS = 4
MAX_STEPS = 240


class TradingSession(Base):
    __tablename__ = "trading_sessions"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    venue_id: Mapped[int | None] = mapped_column(
        ForeignKey("trading_venues.id", ondelete="SET NULL"), nullable=True
    )
    mode: Mapped[str] = mapped_column(String(8), default="paper", nullable=False)

    # The sandbox index the day starts at; `seed + steps` is where it ends.
    seed: Mapped[int] = mapped_column(Integer, nullable=False)
    steps: Mapped[int] = mapped_column(Integer, default=DEFAULT_STEPS, nullable=False)
    interval_minutes: Mapped[int] = mapped_column(
        Integer, default=DEFAULT_INTERVAL_MINUTES, nullable=False
    )
    completed_steps: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # One of SESSION_STATUSES.
    status: Mapped[str] = mapped_column(String(12), default="running", nullable=False)
    # Set by the screen; read by the runner between two steps.
    stop_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # The French sentence of a failure, or None.
    message: Mapped[str | None] = mapped_column(Text, nullable=True)

    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    model: Mapped[str] = mapped_column(String(200), default="", nullable=False)

    initial_cash_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    final_equity_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    realised_pnl_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    unrealised_pnl_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_drawdown_bps: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    orders: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    decisions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    points: Mapped[list] = mapped_column(JSON, default=list, nullable=False)

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
