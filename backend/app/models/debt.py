from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

DEBT_KINDS = (
    "mortgage", "auto", "consumer", "student", "credit_card", "personal", "other",
)


class Debt(Base):
    """One outstanding credit, as design §4.1 describes it: "capital restant dû,
    taux, mensualité, durée, type".

    **`principal_cents` is a POSITIVE magnitude**, and this is the one
    deliberate exception to the negative-means-outflow convention that governs
    `transactions.amount_cents` and every engine downstream of it. A debt is an
    amount *owed*, quoted the way the lender's statement quotes it, and the
    payoff engine subtracts payments from it. Storing it negative would put a
    sign flip in every comparison in `engines/debt.py` and in every screen.
    `engines/debt.DebtInput` restates the same contract at the engine boundary.

    Declared, not derived. Yieldo has no way to recognise a consumer loan from
    a statement line, and design §6.1's correction ("les moteurs travaillent
    désormais sur les transactions réelles quand elles existent, avec repli sur
    les valeurs déclarées sinon") is exactly this case: there is nothing to
    measure, so the user tells us.
    """

    __tablename__ = "debts"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(
        String(24), default="consumer", server_default=text("'consumer'"), nullable=False
    )
    # Capital restant dû, positive. See the class docstring.
    principal_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    # Taux débiteur annuel, in basis points: 490 is 4,90 %/an. Never a float.
    annual_rate_bps: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    # Mensualité contractuelle. The payoff engine treats the sum of these plus
    # any extra as a constant monthly budget -- that is what makes a snowball a
    # snowball rather than a series of unrelated repayments.
    minimum_payment_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    # Durée restante déclarée. Optional and purely informative: the payoff
    # engine derives its own horizon from the capital, the rate and the budget,
    # and does not read this. Kept because design §4.1 lists it and because a
    # user comparing Yieldo's answer with their bank's needs to see both.
    term_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    opened_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Archived rather than deleted, like `accounts`: a repaid debt is part of
    # the household's history.
    archived: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("0"), nullable=False
    )
