from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.history import HistoryOut
from app.schemas.patching import not_nullable


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    date: date
    value_date: date | None
    amount_cents: int
    label_raw: str
    label_clean: str
    category_id: int | None
    category_source: str
    is_transfer: bool
    is_recurring: bool
    notes: str | None
    tags: list[str]
    # Read off `Transaction.manual`, which is itself derived from the absence
    # of an import batch -- see that property for why it is not a column.
    manual: bool


class TransactionIn(BaseModel):
    """An operation the household types in itself.

    `amount_cents` is signed and may not be zero: the sign is the direction
    (negative is money leaving), and a zero-amount movement is a typing slip,
    not a transaction. `category_id` omitted is not the same as no category --
    see `api/transactions.create_transaction`, which runs the household's own
    rules over the label exactly as an import would.
    """

    account_id: int
    date: date
    value_date: date | None = None
    amount_cents: int = Field(description="Signed, in cents. Negative is money out.")
    label_raw: str = Field(min_length=1, max_length=500)
    category_id: int | None = None
    is_transfer: bool = False
    notes: str | None = Field(default=None, max_length=2000)
    tags: list[str] = Field(default_factory=list)

    @field_validator("label_raw")
    @classmethod
    def _label_is_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Le libellé est obligatoire")
        return stripped

    @field_validator("amount_cents")
    @classmethod
    def _amount_is_not_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("Le montant ne peut pas être nul")
        return value


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    total: int
    limit: int
    offset: int
    # How many transactions the date range holds on its own, with every other
    # filter dropped. `total == 0` alone cannot say whether the period is empty
    # or a filter is hiding what is in it; these two figures can.
    period_total: int
    history: HistoryOut | None


class TransactionPatch(BaseModel):
    category_id: int | None = None
    notes: str | None = Field(default=None, max_length=2000)
    is_transfer: bool | None = None
    tags: list[str] | None = None

    _no_null = not_nullable("is_transfer", "tags")


class TransactionPatchOut(TransactionOut):
    learned_rule_id: int | None = None
    backfilled: int = 0


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    parent_id: int | None
    name: str
    slug: str
    kind: str
    color: str
    icon: str
    monthly_budget_cents: int | None
    is_essential: bool


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    parent_id: int | None = None
    kind: str = "expense"
    color: str = "#7ee2d6"
    icon: str = "circle"
    monthly_budget_cents: int | None = None
    is_essential: bool = False


class CategoryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    color: str | None = None
    icon: str | None = None
    monthly_budget_cents: int | None = None
    is_essential: bool | None = None


    _no_null = not_nullable("name", "color", "icon", "is_essential")