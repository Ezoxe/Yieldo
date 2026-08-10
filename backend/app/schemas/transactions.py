from datetime import date

from pydantic import BaseModel, ConfigDict, Field


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


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    total: int
    limit: int
    offset: int


class TransactionPatch(BaseModel):
    category_id: int | None = None
    notes: str | None = Field(default=None, max_length=2000)
    is_transfer: bool | None = None
    tags: list[str] | None = None


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


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    parent_id: int | None = None
    kind: str = "expense"
    color: str = "#7ee2d6"
    icon: str = "circle"
    monthly_budget_cents: int | None = None


class CategoryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    color: str | None = None
    icon: str | None = None
    monthly_budget_cents: int | None = None
