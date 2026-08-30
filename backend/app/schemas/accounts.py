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
    include_in_net_worth: bool | None = None
    archived: bool | None = None

    _no_null = not_nullable("name", "include_in_net_worth", "archived")


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
