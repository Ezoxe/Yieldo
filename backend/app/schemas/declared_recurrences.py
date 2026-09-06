from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.engines.recurrence import Periodicity
from app.schemas.patching import not_nullable


class DeclaredRecurrenceIn(BaseModel):
    """A charge or income the household states it has.

    `amount_cents` is signed and may not be zero: the sign is the direction,
    and a zero-amount commitment is a typing slip rather than a declaration.
    For a variable charge it is the household's own estimate -- see
    `engines/schedule.observed_amount` for when, and only when, check-ins are
    allowed to replace it.
    """

    label: str = Field(min_length=1, max_length=120)
    amount_cents: int = Field(description="Signé, en centimes. Négatif : de l'argent qui sort.")
    amount_is_variable: bool = False
    # The engine's own Literal, not a bare string with a validator: a Literal
    # fails as `literal_error`, which `api/errors` already turns into "La
    # périodicité ne fait pas partie des valeurs acceptées." A ValueError from a
    # validator is flattened to "n'est pas valide" and loses its own sentence.
    periodicity: Periodicity
    anchor_on: date
    ends_on: date | None = None
    category_id: int | None = None
    account_id: int | None = None
    active: bool = True
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("label")
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


class DeclaredRecurrencePatch(BaseModel):
    """A correction to a declaration. Omitting a field leaves it alone."""

    label: str | None = Field(default=None, min_length=1, max_length=120)
    amount_cents: int | None = None
    amount_is_variable: bool | None = None
    periodicity: Periodicity | None = None
    anchor_on: date | None = None
    ends_on: date | None = None
    category_id: int | None = None
    account_id: int | None = None
    active: bool | None = None
    notes: str | None = Field(default=None, max_length=2000)

    _no_null = not_nullable(
        "label", "amount_cents", "amount_is_variable", "periodicity", "anchor_on",
        "active",
    )

    @field_validator("amount_cents")
    @classmethod
    def _amount_is_not_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("Le montant ne peut pas être nul")
        return value


class DeclaredRecurrenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    amount_cents: int
    amount_is_variable: bool
    periodicity: Periodicity
    anchor_on: date
    ends_on: date | None
    category_id: int | None
    account_id: int | None
    active: bool
    notes: str | None


class ScheduleCostOut(BaseModel):
    schedule_id: int
    label: str
    # What one occurrence costs. For a variable charge this is the median of
    # the check-ins once there are three of them, and the declared estimate
    # before that -- `amount_basis` says which, and the screen must print it.
    amount_cents: int
    amount_basis: str
    # Zero for a declaration that is inactive or already ended: it is what the
    # household is committed to going forward, not what it once paid.
    annual_cents: int
    observations: int


class OccurrenceOut(BaseModel):
    schedule_id: int
    label: str
    due_on: date
    amount_cents: int
    # "pointed" | "late" | "due" | "upcoming".
    status: str
    paid_on: date | None
    transaction_id: int | None


class CalendarOut(BaseModel):
    date_from: date
    date_to: date
    occurrences: list[OccurrenceOut]
    schedules: list[ScheduleCostOut]
    # Signed and kept apart, never netted: a declared salary must not be
    # allowed to hide a declared rent inside one comfortable figure.
    annual_charges_cents: int
    annual_income_cents: int
    monthly_charges_cents: int
    monthly_income_cents: int
    late_count: int
    pointed_count: int
    # French, non-null whenever the calendar has nothing on it. An empty
    # calendar with no reason reads as "you have no subscriptions".
    notice: str | None


class CheckinIn(BaseModel):
    """Ticking off one due date.

    `amount_cents` omitted means "it cost what the declaration says" -- the
    common case for a fixed subscription, and the one a household should not
    have to retype. Sent, it is what was actually billed, which for a water
    bill is the whole point.
    """

    due_on: date
    amount_cents: int | None = None
    paid_on: date | None = None
    transaction_id: int | None = None

    @field_validator("amount_cents")
    @classmethod
    def _amount_is_not_zero(cls, value: int | None) -> int | None:
        if value == 0:
            raise ValueError("Le montant ne peut pas être nul")
        return value


class CheckinOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    declared_recurrence_id: int
    due_on: date
    amount_cents: int
    paid_on: date
    transaction_id: int | None
