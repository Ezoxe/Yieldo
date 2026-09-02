from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AllocationTarget(Base):
    """One asset class's target share of this user's portfolio, in basis
    points.

    Phase 3 plan Task 8 gives `engines/allocation.py` its targets as a
    parameter; Task 10 is where they have to come from somewhere, and a
    target allocation is a household's own declared intention -- "60 %
    actions, 40 % obligations" -- not a fact about the world. So, unlike
    `Instrument` and `PricePoint` (see their docstrings), this table carries
    `user_id` with the same foreign key, index and `ondelete="CASCADE"`
    every other business table in this app uses.

    **A row is meaningless on its own.** `engines.allocation.
    validate_targets` refuses a SET that does not sum to exactly 100 %, and
    that invariant spans rows, not columns -- which is why the API replaces
    the whole set in one call (`PUT /api/portfolio/targets`) and why there
    is no per-row PATCH. A single-row edit could only ever leave the set in
    a state the engine would refuse to read back.

    `target_bps` is an integer number of basis points, CLAUDE.md's rates
    convention -- 6 000 is 60,00 %. Never a float, and never a percentage
    with a decimal point: the two digits after the comma ARE the basis
    points.

    Unique on `(user_id, asset_class)`: one target per class per user, so
    "what share should equities be" has exactly one row to answer from.
    The class itself is one of `models.instrument.INSTRUMENT_ASSET_CLASSES`,
    checked at the API boundary against that same tuple -- the dimension
    `engines.portfolio`'s own `weight_by_asset_class` already groups on, so
    a target and the weight it is compared against can never key on
    different vocabularies.
    """

    __tablename__ = "allocation_targets"
    __table_args__ = (
        UniqueConstraint("user_id", "asset_class", name="uq_allocation_target_user_asset_class"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # One of INSTRUMENT_ASSET_CLASSES.
    asset_class: Mapped[str] = mapped_column(String(24), nullable=False)
    # Basis points, 0..10 000. The SET must sum to exactly 10 000 -- an
    # invariant the engine owns and the API enforces on write.
    target_bps: Mapped[int] = mapped_column(Integer, nullable=False)
