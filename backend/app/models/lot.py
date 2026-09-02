from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Lot(Base):
    """One acquisition: this many units, at this cost per unit, on this date.

    This is the atom design's Task 2 brief names explicitly: "a lot is an
    acquisition: quantity, unit cost in cents, date". A `Position`'s current
    holding is the sum of its lots' `quantity`; its cost basis is the sum of
    `quantity * unit_cost_cents` across them (`engines.quantity.value_cents`,
    rounded once over the total -- never once per lot, see that module).

    `quantity` is `engines.quantity.Quantity` rendered to a string
    (`str(quantity)`) -- never a float, never `Numeric` (SQLite's NUMERIC
    affinity round-trips through a Python `float`, which is exactly the
    corruption this column exists to avoid; see `engines/quantity.py`'s
    module docstring). `String(64)` comfortably covers a sign, forty integer
    digits and eighteen decimal ones -- far beyond any real holding -- while
    still being a fixed, generous bound rather than an unbounded `Text`.

    `unit_cost_cents` is money -- integer cents, per unit, matching every
    other monetary column in this app. It is deliberately NOT the lot's
    total cost: multiplying it back out happens once, at read time, through
    `value_cents`, so there is exactly one place in the whole application
    that rounds a lot's value to the cent.
    """

    __tablename__ = "lots"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    position_id: Mapped[int] = mapped_column(
        ForeignKey("positions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # engines.quantity.Quantity, as `str(quantity)` -- parsed back with
    # engines.quantity.parse(). Never a float.
    quantity: Mapped[str] = mapped_column(String(64), nullable=False)
    unit_cost_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    acquired_on: Mapped[date] = mapped_column(Date, nullable=False)
