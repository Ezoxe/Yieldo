"""Wire shapes for `/api/alerts`. Design §12, phase 4 plan Task 10.

Every alert carries its three sentences as three separate fields --
`measured`, `period`, `clears_when` -- rather than one paragraph, because a
screen that receives them merged can never lay them out apart, and a reader
then cannot tell a measurement from a remedy. `engines/alert.py`'s module
docstring holds the reason.

`AlertSettingsOut.balance_floor_cents` is `int | None`, and the `None` is
load-bearing: it means no floor has ever been stored, which is a different
instruction from a floor of 0. Nothing in this module ever coerces one into
the other.
"""

from datetime import date

from pydantic import BaseModel


class AlertOut(BaseModel):
    kind: str
    severity: str
    severity_label: str
    key: str
    title: str
    measured: str
    period: str
    clears_when: str
    amount_cents: int | None
    on: date | None


class ConditionStateOut(BaseModel):
    kind: str
    label: str
    # False means the condition could not be measured at all. Read `detail`
    # before `alert_count`, which is 0 either way.
    measured: bool
    detail: str
    alert_count: int
    # Subjects deliberately not judged, each carrying its own French cause --
    # an expected debit falling in a month no statement covers lands here, and
    # is neither an alert nor a clean result.
    withheld: list[str]


class CoverageOut(BaseModel):
    first_on: date | None
    last_on: date | None
    covered_months: list[str]
    # Months INSIDE [first_on, last_on] holding no imported transaction.
    missing_months: list[str]


class AlertSettingsIn(BaseModel):
    # Explicit `null` clears the stored floor; it is never read as 0.
    balance_floor_cents: int | None = None


class AlertSettingsOut(BaseModel):
    balance_floor_cents: int | None


class AlertReportOut(BaseModel):
    alerts: list[AlertOut]
    # Exactly five, in `engines.alert.ALERT_KINDS` order.
    conditions: list[ConditionStateOut]
    coverage: CoverageOut
    settings: AlertSettingsOut
    # French, set exactly when the ledger's span holds unimported months.
    notice: str | None
    # The ledger's last transaction date, so the screen can say how fresh the
    # data behind every figure is -- the contract `api/recurrences.py` and
    # `api/cashflow.py` already established for their own stale-ledger case.
    ledger_last_on: date | None
