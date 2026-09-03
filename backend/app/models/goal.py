from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Goal(Base):
    """A savings goal, as design §4.1 describes it: "intitulé, montant cible,
    échéance, montant déjà constitué, priorité".

    **`priority` is lower-is-more-urgent**, defaulting to 100 so a goal created
    without one sorts after every goal that was given one. `engines/goal.py`
    funds goals *sequentially* in this order -- the whole measured capacity to
    the most urgent goal until it completes, then the next -- because applying
    the household's one capacity to every goal in parallel would tell the user
    all five finish at once, which is arithmetically impossible and is the kind
    of confident-looking falsehood this project keeps finding in review.

    `saved_cents` is declared, not measured. Yieldo cannot tell which euros in
    a savings account belong to which goal; only the user knows.
    """

    __tablename__ = "goals"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    target_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    saved_cents: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    # Échéance souhaitée. Optional: a goal without a deadline is still a goal,
    # and `engines/goal.py` reports `on_track = None` rather than inventing one.
    due_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    priority: Mapped[int] = mapped_column(
        Integer, default=100, server_default=text("100"), nullable=False
    )
    archived: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("0"), nullable=False
    )
