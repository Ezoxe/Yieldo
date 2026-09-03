from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

CHALLENGE_STATES = ("proposed", "accepted", "rejected")


class Challenge(Base):
    """A data-derived proposal, design §6.2's "défis dérivés des données" --
    "trois abonnements à 34 €/mois inutilisés depuis six mois",
    "ramener Restaurants au niveau de 2025 libère 87 €/mois".

    **Proposed by `engines/challenge.py` (Task 4), never by the user.** There
    is no user-authored "create a challenge" action: every row starts life
    from a measurement Yieldo already made -- an unused subscription, a
    category above its own past level, an anomaly, a budget repeatedly
    overrun -- and `title`/`detail` are that engine's French sentence, already
    carrying "the figure that justifies it and the months it was measured
    over" (design constraint, Task 4's brief). A challenge Yieldo cannot
    quantify is never proposed, so no row here is ever a decorative badge with
    nothing measurable behind it -- the phase's closing rule.

    **`target_cents` and `category_id` are both nullable** because not every
    challenge kind has a single figure or a single category: an anomaly
    challenge quotes one transaction's amount and may have no category at
    all, while a category-level challenge quotes a monthly figure AND names
    the category. `category_id` uses `ondelete="SET NULL"`, exactly like
    `Transaction.category_id`: a category the user later deletes must not
    delete the challenge that once referenced it.

    **`state` starts at `"proposed"` and moves to `"accepted"` or
    `"rejected"` at most once** -- `decided_on` is set the same moment `state`
    leaves `"proposed"`, and stays `None` until then. `measured_cents` /
    `measured_on` are the OUTCOME, filled in later by
    `engines/challenge.measure_outcome` once a full month has elapsed after
    acceptance -- never at accept time, since nothing has happened yet to
    measure. "Not enough elapsed time" is that function's own answer while
    they are still `None`, not a zero standing in for an unmeasured result.
    """

    __tablename__ = "challenges"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Which measurement produced this proposal -- e.g. "unused_subscription",
    # "category_above_past_level", "anomaly", "budget_overrun". `engines/
    # challenge.py` (Task 4) owns the vocabulary; this column only stores it.
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # The full French sentence: the figure and the months it was measured
    # over. Unbounded, unlike `title`, since a fully-justified sentence does
    # not fit a fixed display-label length the way a title does.
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    target_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    proposed_on: Mapped[date] = mapped_column(Date, nullable=False)
    # One of CHALLENGE_STATES.
    state: Mapped[str] = mapped_column(
        String(16), default="proposed", server_default=text("'proposed'"), nullable=False
    )
    decided_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    # The outcome, filled in a month after acceptance. See the class
    # docstring: both stay `None` until `measure_outcome` has something real
    # to report, never 0 standing in for "not measured yet".
    measured_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    measured_on: Mapped[date | None] = mapped_column(Date, nullable=True)
