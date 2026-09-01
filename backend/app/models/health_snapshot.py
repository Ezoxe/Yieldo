from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class HealthSnapshot(Base):
    """One day's financial-health score, as `engines/health.py` computed it.

    Design §6.2: "le score et ses composantes suivis dans le temps, avec ce
    qui l'a fait bouger" -- the delta only exists because this table lets a
    later read compare against an earlier row, so a snapshot is written, never
    only held in memory and thrown away at the end of the request.

    **`score` is `Integer NOT NULL`, never nullable.** `engines/health.py`'s
    `HealthScore.score` can be `None` -- fewer than two measurable components
    -- and on that day there is nothing worth logging as history: a row would
    either have to invent a number or carry a nullable column whose meaning
    ("no score today") is indistinguishable from a genuine zero, which is the
    same `None`-as-fallback failure CLAUDE.md rules out. The caller (Task 5)
    writes a row only when `HealthScore.score` is not `None`; on the refusing
    days, there is simply no row for that date, and the read path reports the
    gap the same way `engines/streak.py` reports an unimported month -- as an
    absence, not a zero.

    **`components` is JSON in a `Text` column**, exactly like `Scenario.payload`
    for the identical reason: it is read back whole and re-validated by the
    same Pydantic shape that produced it, never queried into, so a typed JSON
    column would buy nothing.

    **Unique on `(user_id, taken_on)`.** At most one snapshot per user per
    calendar day -- Task 5's "written at most once a day per user, on read"
    is a database constraint here, not only a convention in the router.
    """

    __tablename__ = "health_snapshots"
    __table_args__ = (
        UniqueConstraint("user_id", "taken_on", name="uq_health_snapshot_user_taken_on"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    taken_on: Mapped[date] = mapped_column(Date, nullable=False)
    # 0-100. See the class docstring for why this column is never nullable.
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    # JSON-encoded list of `engines/health.py`'s `HealthComponent`s, as they
    # stood on `taken_on`.
    components: Mapped[str] = mapped_column(Text, nullable=False)
