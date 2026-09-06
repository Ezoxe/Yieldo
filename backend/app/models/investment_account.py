from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

INVESTMENT_ACCOUNT_KINDS = (
    "pea", "pea_pme", "cto", "assurance_vie", "per", "crypto_exchange", "other",
)


class InvestmentAccount(Base):
    """An envelope that holds `Position`s: a PEA, a CTO, an assurance-vie, a
    crypto exchange account.

    Distinct from the phase-1 `Account` (which tracks a cash balance via
    `Transaction`s): an investment account has no ledger of debits and
    credits -- its balance IS the valuation of the positions it holds,
    computed by Task 7 from their lots, never stored here as a total, for
    the same reason a `Position` never stores one (see that model).

    **`opened_on` matters beyond being informative.** Task 12's French tax
    rules key directly off it: PEA's holding-period exemption (5 years) and
    assurance-vie's abatement (8 years) both start counting from the
    envelope's own opening date, not from any individual lot's acquisition
    date. Nullable because a `cto`/`crypto_exchange` account has no such
    rule and the date may genuinely be unknown -- but Task 12 cannot apply
    either exemption to a `pea` or `assurance_vie` row where it is `None`.
    """

    __tablename__ = "investment_accounts"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # One of INVESTMENT_ACCOUNT_KINDS.
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), default="EUR", server_default=text("'EUR'"), nullable=False
    )
    opened_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    archived: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("0"), nullable=False
    )
    # What the household says this envelope holds beyond its declared positions:
    # a fonds euros inside an assurance-vie, a PER, an unlisted contract. There
    # is a real amount in there and no quoted instrument to hang it on, and a
    # `Position` needs an `Instrument`.
    #
    # It is NOT a stored total of the positions -- the class docstring above
    # still holds, and `api/portfolio.get_valuation` reports the two apart so a
    # reader can always see which half was measured from prices. Nullable so an
    # envelope whose positions come to cover everything it holds can stop
    # declaring a second figure rather than counting both for ever.
    declared_value_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The day the figure was read off a statement. A declared amount without a
    # date silently rots into a claim about today; with one, the screen can say
    # how old it is.
    declared_value_on: Mapped[date | None] = mapped_column(Date, nullable=True)
