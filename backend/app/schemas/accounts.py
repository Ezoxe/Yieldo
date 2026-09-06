from datetime import date

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.patching import not_nullable


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    opening_balance_cents: int = 0
    opened_on: date | None = None
    include_in_net_worth: bool = True


class AccountPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    # Correctable, and it was not. A household that typed today's balance as the
    # opening one and then imported five years of history had no way back: the
    # figure fed every balance in the application and no route could change it.
    opening_balance_cents: int | None = None
    opened_on: date | None = None
    include_in_net_worth: bool | None = None
    archived: bool | None = None

    _no_null = not_nullable(
        "name", "opening_balance_cents", "include_in_net_worth", "archived"
    )


class AccountBalanceOut(BaseModel):
    """One account, taken apart: what was declared, what was imported, and what
    the two make together."""

    id: int
    name: str
    kind: str
    # Whether this account counts towards money that could actually be spent
    # next month -- see `api/common.LIQUID_ACCOUNT_KINDS`.
    liquid: bool
    opening_balance_cents: int
    movements_cents: int
    transaction_count: int
    balance_cents: int


class TransferAuditOut(BaseModel):
    """The two legs of every internal transfer, weighed against each other.

    A transfer moves money between two of the household's own accounts, so its
    two legs cancel. The measured rates drop every flagged row while the balance
    keeps them, which means a receipt flagged on one side and an emission left
    unflagged on the other counts as income that was never spent.
    `unmatched_cents` is what the flagged rows fail to cancel by; zero is the
    only value that says nothing is lopsided.
    """

    count: int
    received_cents: int
    # Negative, like every outflow in this codebase.
    sent_cents: int
    unmatched_cents: int


class BalanceBreakdownOut(BaseModel):
    accounts: list[AccountBalanceOut]
    liquid_total_cents: int
    transfers: TransferAuditOut


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    kind: str
    currency: str
    opening_balance_cents: int
    opened_on: date | None
    include_in_net_worth: bool
    archived: bool
