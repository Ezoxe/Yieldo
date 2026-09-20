from datetime import UTC, datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# `refused`   the mandate said no. The order exists as a record of what was
#             not sent -- a refusal nobody can see is a refusal nobody can audit.
# `pending`   sent, not yet filled (a limit order away from the market).
# `filled`    executed, wholly or in part; `filled_quantity` says which.
# `cancelled` withdrawn before filling.
# `failed`    the venue rejected it or could not be reached; `failure_reason` says which.
ORDER_STATES = ("refused", "pending", "filled", "cancelled", "failed")

ORDER_SIDES = ("buy", "sell")
ORDER_TYPES = ("market", "limit")


class TradeOrder(Base):
    """One order, including the ones that were never sent.

    **A refused order is still a row.** The mandate refusing an order is the
    single most important thing this feature does, and a refusal kept only in a
    log line is one nobody can review, count or replay. `status="refused"`
    carries the rule and the sentence that produced it.

    **`idempotency_key` is not decoration.** A network timeout on `place_order`
    leaves the caller unable to tell a lost request from a lost response, and
    guessing wrong buys twice with real money. The key is generated before the
    call, unique per user, sent to every venue that accepts one (all three
    real ones do), and checked here before a retry can create a second row.
    That is why it is a UNIQUE constraint rather than a comment.

    `quantity` and `filled_quantity` are `engines.quantity.Quantity` rendered
    to text, exactly like `Lot.quantity` -- never a float, never `Numeric`.
    Money is integer cents throughout.
    """

    __tablename__ = "trade_orders"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_trade_order_idempotency"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # None for an order a person placed by hand from the screen; set for every
    # order the pipeline produced.
    decision_id: Mapped[int | None] = mapped_column(
        ForeignKey("trade_decisions.id", ondelete="SET NULL"), index=True, nullable=True
    )
    venue_id: Mapped[int | None] = mapped_column(
        ForeignKey("trading_venues.id", ondelete="SET NULL"), index=True, nullable=True
    )
    # Duplicated from the venue so an order keeps saying which side of the
    # wall it was on even if the venue row is later deleted.
    mode: Mapped[str] = mapped_column(String(8), index=True, nullable=False)

    symbol: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    side: Mapped[str] = mapped_column(String(8), nullable=False)
    order_type: Mapped[str] = mapped_column(String(8), nullable=False)
    # engines.quantity.Quantity as text.
    quantity: Mapped[str] = mapped_column(String(64), nullable=False)
    # What the model asked for before the mandate reduced it, when it did.
    # Kept so "réduit" is a visible fact rather than an inference.
    requested_quantity: Mapped[str] = mapped_column(String(64), nullable=False)
    limit_price_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reference_price_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    notional_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # One of ORDER_STATES.
    status: Mapped[str] = mapped_column(String(12), index=True, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(64), nullable=False)
    # The venue's own identifier, once it has one.
    external_id: Mapped[str | None] = mapped_column(String(120), nullable=True)

    filled_quantity: Mapped[str | None] = mapped_column(String(64), nullable=True)
    average_price_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # What execution cost beyond the mid price: spread crossed plus slippage.
    # Shown on the sandbox so a strategy is judged after its costs.
    cost_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    realised_pnl_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # The risk rule that refused it, or the venue failure cause. Stable id.
    rule: Mapped[str | None] = mapped_column(String(48), nullable=True)
    # French, shown verbatim.
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), index=True, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC), nullable=False,
    )
