from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Position(Base):
    """One instrument held inside one investment account.

    **Carries NO quantity and NO total.** The position's holding is the sum
    of its `Lot`s' quantities, computed at read time (Task 7); its value is
    that sum times a fetched price, rounded once (`engines.quantity.
    value_cents`). Storing a cached total here would let it drift from the
    lots that are supposed to justify it, and -- the reason this is a hard
    requirement, not a style preference -- would give Task 12's per-lot
    French capital-gains computation nothing to match a disposal against:
    the acquisition it drew down has to still be an identifiable row.

    Unique on `(investment_account_id, instrument_id)`: at most one position
    per instrument per account, so "how many AAPL do I hold in this CTO" has
    exactly one row to sum lots against, never two competing ones.

    `instrument_id` is `ondelete="RESTRICT"`, the one FK in this phase that
    is not CASCADE or SET NULL: `Instrument` is shared, unowned reference
    data (see its docstring), and nothing in this phase ever deletes one --
    RESTRICT means a future accidental attempt fails loudly instead of
    silently erasing another user's holdings of it.
    """

    __tablename__ = "positions"
    __table_args__ = (
        UniqueConstraint(
            "investment_account_id", "instrument_id", name="uq_position_account_instrument"
        ),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    investment_account_id: Mapped[int] = mapped_column(
        ForeignKey("investment_accounts.id", ondelete="CASCADE"), index=True, nullable=False
    )
    instrument_id: Mapped[int] = mapped_column(
        ForeignKey("instruments.id", ondelete="RESTRICT"), index=True, nullable=False
    )
