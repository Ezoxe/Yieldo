from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# See `app/engines/plan.py`'s module docstring for what the two kinds mean and
# why the distinction is the design rather than a detail: a `fixed` line is
# settled all or nothing by a matching payment, an `envelope` is drawn down by
# what has actually been spent against it.
PLAN_KINDS = ("fixed", "envelope")

PLAN_PERIODICITIES = ("weekly", "biweekly", "monthly", "quarterly", "yearly", "one_off")

# Who put the line there. "manual" is the household itself; "recurrence" is a
# line pre-filled from a subscription Yieldo already detected and the household
# then accepted; "agent" is a line a model proposed and a human approved. Kept
# because the three deserve different trust, and because a household reviewing
# its plan is entitled to know which lines it did not write itself.
PLAN_ORIGINS = ("manual", "recurrence", "agent")


class PlanLine(Base):
    """One thing the household already knows about a month that has no
    statement yet: the rent, the phone contract, the streaming subscription.

    **This table is not the ledger, and nothing here is ever a transaction.**
    That separation is the whole point of the feature: a forecast that had to
    be written into `transactions` to be useful would make every "how much did
    I spend" figure depend on which rows someone remembered to delete. The
    ledger stays a record of what happened; this stays a record of what was
    signed. `app/api/common.py` is the one place the two ever meet, and it says
    which of the three modes it is answering in.

    `day_of_month` is meaningless for a weekly, fortnightly or one-off line,
    which are anchored on `start_on` instead. It is kept non-nullable and
    defaulted rather than made conditional: a nullable column that only some
    rows may fill is a second, unwritten schema.

    `match_label` is what a real transaction is recognised by -- see
    `engines/plan._matches`. Left empty, a line falls back to matching on its
    category alone, which is what an envelope always does and what a fixed line
    whose statement label is unpredictable can choose to do.
    """

    __tablename__ = "plan_lines"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    # Signed, in cents, like every amount in this application. Negative is
    # money leaving: a rent is -90000, a salary is +250000.
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(
        String(16), default="fixed", server_default=text("'fixed'"), nullable=False
    )
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    # Optional: a plan line that names no account still has an amount and a
    # date. `engines/plan.as_tx_points` places it on the household's main
    # account so an engine grouping by account can still read it.
    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True
    )
    periodicity: Mapped[str] = mapped_column(
        String(16), default="monthly", server_default=text("'monthly'"), nullable=False
    )
    day_of_month: Mapped[int] = mapped_column(
        Integer, default=1, server_default=text("1"), nullable=False
    )
    start_on: Mapped[date] = mapped_column(Date, nullable=False)
    # None means "still running". A cancelled subscription keeps its row and
    # gets an end date rather than being deleted: past months must keep
    # forecasting the way they actually were.
    end_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    match_label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("1"), nullable=False
    )
    origin: Mapped[str] = mapped_column(
        String(16), default="manual", server_default=text("'manual'"), nullable=False
    )
    notes: Mapped[str | None] = mapped_column(String(2000), nullable=True)
