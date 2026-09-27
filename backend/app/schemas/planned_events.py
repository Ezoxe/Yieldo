from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.patching import not_nullable

# Said by the route rather than a validator: `api.errors` rewrites a validator's
# message by its type, and this refusal must name its remedy.
ZERO_AMOUNT = "Un montant nul n'est pas un événement : indiquez ce qui entre ou ce qui sort."
_BLANK = "Le libellé ne peut pas être vide"


def _clean_label(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        raise ValueError(_BLANK)
    return stripped


class PlannedEventIn(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    due_on: date
    # Signed: negative is money leaving.
    amount_cents: int
    account_id: int | None = None
    category_id: int | None = None
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("label")
    @classmethod
    def _label_is_not_blank(cls, value: str) -> str | None:
        return _clean_label(value)


class PlannedEventPatch(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    due_on: date | None = None
    amount_cents: int | None = None
    account_id: int | None = None
    category_id: int | None = None
    notes: str | None = Field(default=None, max_length=2000)

    _no_null = not_nullable("label", "due_on", "amount_cents")

    @field_validator("label")
    @classmethod
    def _label_is_not_blank(cls, value: str | None) -> str | None:
        return _clean_label(value)


class PlannedEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    due_on: date
    amount_cents: int
    account_id: int | None
    category_id: int | None
    notes: str | None
    created_at: datetime
