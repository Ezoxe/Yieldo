import json
from datetime import date

from sqlalchemy import BigInteger, Date, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class NetWorthSnapshot(Base):
    """One day's balance sheet — assets, debts, and how the assets split.

    The same discipline as `HealthSnapshot`: written at most once per user
    per day, on read, so a later visit can draw the line the household
    actually walked rather than recompute a past date from today's inputs (a
    price fetched today is not the price of last month).

    Both amounts are `BigInteger NOT NULL`: a household with nothing owns
    zero and owes zero, which is a measurement, not an absence — unlike a
    health score, there is no day on which net worth cannot be measured, so
    there is no refusing day and no nullable column.

    `breakdown` is JSON in a `Text` column, like `HealthSnapshot.components`
    and for the same reason: read back whole, never queried into.
    """

    __tablename__ = "net_worth_snapshots"
    __table_args__ = (
        UniqueConstraint("user_id", "taken_on", name="uq_net_worth_snapshot_user_taken_on"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    taken_on: Mapped[date] = mapped_column(Date, nullable=False)
    assets_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    debts_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    breakdown: Mapped[str] = mapped_column(Text, nullable=False)

    @property
    def net_cents(self) -> int:
        return self.assets_cents - self.debts_cents

    def breakdown_pairs(self) -> list[tuple[str, int]]:
        return [(str(key), int(value)) for key, value in json.loads(self.breakdown)]
