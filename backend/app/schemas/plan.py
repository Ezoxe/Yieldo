from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.engines.plan import LEDGER_MODES
from app.models.plan_line import PLAN_KINDS, PLAN_PERIODICITIES
from app.schemas.patching import not_nullable


class PlanLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    amount_cents: int
    kind: str
    category_id: int | None
    account_id: int | None
    periodicity: str
    day_of_month: int
    start_on: date
    end_on: date | None
    match_label: str | None
    active: bool
    origin: str
    notes: str | None


def _check_kind(value: str | None) -> str | None:
    if value is not None and value not in PLAN_KINDS:
        raise ValueError(f"Type de ligne inconnu : {value}")
    return value


def _check_periodicity(value: str | None) -> str | None:
    if value is not None and value not in PLAN_PERIODICITIES:
        raise ValueError(f"Périodicité inconnue : {value}")
    return value


class PlanLineIn(BaseModel):
    """One declared line. See `app/engines/plan.py` for what the two kinds mean.

    An `envelope` must name a category: an allowance with nothing to be drawn
    down against is not an allowance, and `engines/plan._matches` would never
    find a single transaction to subtract from it. The rule is enforced here
    rather than left to be discovered on screen as a line that never moves.
    """

    label: str = Field(min_length=1, max_length=120)
    amount_cents: int
    kind: str = "fixed"
    category_id: int | None = None
    account_id: int | None = None
    periodicity: str = "monthly"
    day_of_month: int = Field(default=1, ge=1, le=31)
    start_on: date
    end_on: date | None = None
    match_label: str | None = Field(default=None, max_length=200)
    active: bool = True
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("kind")
    @classmethod
    def _known_kind(cls, value: str) -> str:
        return _check_kind(value)

    @field_validator("periodicity")
    @classmethod
    def _known_periodicity(cls, value: str) -> str:
        return _check_periodicity(value)

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

    @model_validator(mode="after")
    def _coherent(self) -> "PlanLineIn":
        if self.kind == "envelope":
            if self.category_id is None:
                raise ValueError("Une enveloppe doit porter une catégorie")
            if self.periodicity != "monthly":
                raise ValueError("Une enveloppe est mensuelle")
        if self.end_on is not None and self.end_on < self.start_on:
            raise ValueError("La date de fin précède la date de début")
        return self


class PlanLinePatch(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    amount_cents: int | None = None
    kind: str | None = None
    category_id: int | None = None
    account_id: int | None = None
    periodicity: str | None = None
    day_of_month: int | None = Field(default=None, ge=1, le=31)
    start_on: date | None = None
    end_on: date | None = None
    match_label: str | None = Field(default=None, max_length=200)
    active: bool | None = None
    notes: str | None = Field(default=None, max_length=2000)

    _no_null = not_nullable(
        "label", "amount_cents", "kind", "periodicity", "day_of_month", "start_on", "active",
    )
    @field_validator("kind")
    @classmethod
    def _known_kind(cls, value: str | None) -> str | None:
        return _check_kind(value)

    @field_validator("periodicity")
    @classmethod
    def _known_periodicity(cls, value: str | None) -> str | None:
        return _check_periodicity(value)


class PlanOccurrenceOut(BaseModel):
    """One dated instance of a line, as the plan screen shows it back."""

    line_id: int
    on: date
    amount_cents: int
    label: str
    category_id: int | None
    account_id: int | None


class PlanPreviewOut(BaseModel):
    """What a window looks like under the plan.

    `planned` is every occurrence the plan produces; `remaining` is the part
    the ledger does not already account for -- the difference between the two
    is exactly what "Réel complété" adds to the real figures. Both are returned
    so the screen can say "1 240 € prévus, dont 380 € pas encore passés"
    without recomputing either.
    """

    date_from: date
    date_to: date
    planned: list[PlanOccurrenceOut]
    remaining: list[PlanOccurrenceOut]
    planned_total_cents: int
    remaining_total_cents: int


class LedgerModeOut(BaseModel):
    mode: str


class LedgerModeIn(BaseModel):
    mode: str

    @field_validator("mode")
    @classmethod
    def _known(cls, value: str) -> str:
        if value not in LEDGER_MODES:
            raise ValueError(f"Mode de lecture inconnu : {value}")
        return value


class PlanFromRecurrencesOut(BaseModel):
    """What accepting the detected subscriptions actually created.

    `created` is the lines written; `skipped` counts the detected recurrences
    that already had a line matching them, so accepting twice does not double
    the plan.
    """

    created: list[PlanLineOut]
    skipped: int

