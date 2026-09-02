"""Wire shapes for the phase 3 substrate: investment accounts, positions and
lots. `/api/portfolio` (Task 9) is not built yet -- these are the shapes it
will use, defined now alongside the tables they mirror.

`Instrument`, `PricePoint`, `ApiKey` and `QuotaWindow` get no `*In`/`*Patch`
schemas here: none of the four is directly user-editable in this phase (an
instrument is created by the market layer, a price point by a provider
fetch, an api key and its quota window by Task 6's own dedicated,
masking-aware schemas) -- see each model's docstring in `app/models/`.
"""

from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.engines import quantity
from app.schemas.patching import not_nullable


def _quantity_field_validator() -> classmethod:
    """A lot's quantity, through `engines.quantity.parse` -- so a malformed
    or non-positive amount is refused here, at the wire boundary, rather
    than reaching the database. Returns the CANONICAL (18-decimal-place)
    string, not the caller's raw text, so `Lot.quantity` is always stored in
    the one normalised form regardless of how the request spelled it
    ("0.005" and "0.0050" both become "0.005000000000000000").
    """

    def _check(_cls, value: str) -> str:
        parsed = quantity.parse(value)
        if parsed.value <= 0:
            raise ValueError(
                "La quantité d'un lot doit être strictement positive : un lot est "
                "une acquisition, jamais une cession."
            )
        return str(parsed)

    return field_validator("quantity")(classmethod(_check))


class InstrumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    symbol: str
    name: str
    asset_class: str
    currency: str
    is_fractionable: bool


class InvestmentAccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    opened_on: date | None = None


class InvestmentAccountPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: str | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    # opened_on stays out of the guard below: it is the one nullable column
    # on InvestmentAccount, and clearing it (an unknown opening date) is a
    # legitimate edit.
    opened_on: date | None = None
    archived: bool | None = None

    _no_null = not_nullable("name", "kind", "currency", "archived")


class InvestmentAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    kind: str
    currency: str
    opened_on: date | None
    archived: bool


class PositionIn(BaseModel):
    investment_account_id: int
    instrument_id: int


class PositionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    investment_account_id: int
    instrument_id: int


class LotIn(BaseModel):
    position_id: int
    # engines.quantity.Quantity, as text -- never a float on the wire either.
    quantity: str
    unit_cost_cents: int = Field(ge=0)
    acquired_on: date

    _valid_quantity = _quantity_field_validator()


class LotPatch(BaseModel):
    # position_id is deliberately not patchable: moving a lot to a different
    # position is a new acquisition record, not an edit of this one.
    quantity: str | None = None
    unit_cost_cents: int | None = Field(default=None, ge=0)
    acquired_on: date | None = None

    _no_null = not_nullable("quantity", "unit_cost_cents", "acquired_on")
    _valid_quantity = _quantity_field_validator()


class LotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    position_id: int
    quantity: str
    unit_cost_cents: int
    acquired_on: date
