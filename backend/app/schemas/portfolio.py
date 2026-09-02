"""Wire shapes for the phase 3 substrate: investment accounts, positions,
lots, and -- for `/api/portfolio`'s valuation route (Task 9) -- the read-only
output shapes mirroring `engines.portfolio`'s own dataclasses.

`PricePoint`, `ApiKey` and `QuotaWindow` get no `*In`/`*Patch` schemas here:
none of the three is directly user-editable (a price point is written by a
provider fetch, an api key and its quota window by Task 6's own dedicated,
masking-aware schemas) -- see each model's docstring in `app/models/`.

`Instrument` gets an `*In` (`InstrumentIn`) but deliberately no `*Patch`:
Task 9's `POST /api/portfolio/instruments` is a find-or-create, keyed on
`(symbol, asset_class)` -- creating a genuinely new one is how a user starts
tracking a symbol nobody here has priced before, but an EXISTING instrument
is shared, unowned reference data (see `models.Instrument`'s own docstring)
and is never edited in place through this API.
"""

from datetime import date, datetime

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


class InstrumentIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=200)
    asset_class: str
    currency: str = Field(min_length=3, max_length=3)
    is_fractionable: bool = False


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


# --- GET /api/portfolio/valuation -- mirrors engines.portfolio's own
# dataclasses field for field (`model_config = from_attributes` validates
# straight off them, so there is exactly one place each figure is named).


class PriceQuoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    price_cents: int
    as_of: date
    fetched_at: datetime
    source: str
    is_stale: bool


class PositionValuationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    position_id: int
    account_id: int
    symbol: str
    name: str
    asset_class: str
    currency: str
    quantity: str
    cost_basis_cents: int
    price: PriceQuoteOut | None
    price_unavailable_reason: str | None
    market_value_cents: int | None
    unrealised_gain_cents: int | None
    fx_unavailable_reason: str | None
    market_value_reporting_cents: int | None
    cost_basis_reporting_cents: int | None
    unrealised_gain_reporting_cents: int | None


class WeightedGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    value_cents: int
    weight: float


class PortfolioTotalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    market_value_cents: int
    cost_basis_cents: int
    unrealised_gain_cents: int
    positions_total: int
    positions_valued: int
    positions_missing_price: int
    positions_missing_fx: int


class PortfolioValuationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    reporting_currency: str
    positions: list[PositionValuationOut]
    total: PortfolioTotalOut
    weight_by_instrument: list[WeightedGroupOut]
    weight_by_asset_class: list[WeightedGroupOut]
    weight_by_currency: list[WeightedGroupOut]
