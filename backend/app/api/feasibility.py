"""POST /api/feasibility, GET /api/feasibility/context, and the saved-scenario
routes under /api/feasibility/scenarios (POST, GET, DELETE).

**Why POST for a computation that writes nothing.** The request carries a
purchase, four assumption overrides, an arbitrary list of running-cost items
and an optional LOA quote. As a query string that is twenty-odd parameters,
unreadable in a browser bar and past the length a proxy will reliably pass.
The route is idempotent and side-effect free; only the shape of the input
argues for POST.

The clock is read here and handed to `assess_feasibility` as a parameter. It is
the REAL `date.today()`: nothing in the feasibility engine classifies anything
by staleness, and the horizon must count forward from now -- a purchase planned
"in twelve months" means twelve months from today, not from whenever the last
statement was imported. That is the same reasoning `/api/cashflow/runway` sets
out for itself; it is NOT the ledger-anchored clock `/api/cashflow/forecast`
uses, and the two are separate decisions.

Every measured input is fetched through the helpers that already enforce the
user filter (`api/common.py`) and the ledger-bounds precondition
(`api/goals.observed_months`). `capacity.complete_months` cannot tell a genuine
ledger extent from a requested window, and bounds wider than the data really
covers silently admit a partial month as complete.
"""

import json
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.common import liquid_balance_cents, tx_points
from app.api.goals import observed_months, rate_out
from app.api.history import user_history
from app.db import get_db
from app.engines.capacity import (
    MonthObservation,
    measure_expense_rate,
    measure_income_rate,
    measure_savings_capacity,
)
from app.engines.feasibility import Assumptions, PurchaseRequest, assess_feasibility
from app.engines.levers import CategoryHistory, LoaTerms, build_levers, compare_financing
from app.engines.ownership import (
    DEFAULT_OWNERSHIP_YEARS,
    CostItem,
    defaults_for,
    total_cost_of_ownership,
)
from app.engines.savings import DEFAULT_ANNUAL_RETURN_BPS
from app.models import Category, Debt, Scenario, User
from app.schemas.feasibility import (
    AssumptionsOut,
    CostItemIn,
    CostLineOut,
    EmergencyImpactOut,
    FeasibilityContextOut,
    FeasibilityIn,
    FeasibilityOut,
    FinancingOptionOut,
    FinancingOut,
    ImpactOut,
    LeverOut,
    OwnershipDefaultsOut,
    OwnershipOut,
    ScenarioIn,
    ScenarioOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/feasibility", tags=["feasibility"])

# The one `Scenario.kind` this router ever writes or reads. A row of any other
# kind -- a future simulator's own saved scenario, sharing the same table --
# must never surface here: parsing it through `FeasibilityIn` would either
# raise on a payload shaped for a different question, or silently answer a
# question this endpoint was never asked.
SCENARIO_KIND = "feasibility"

# Declared defaults, not measurements. Echoed back on every response so the
# screen prints the hypothesis beside the figure it produced (design §10).
# Both sit well inside `schemas.feasibility.MAX_LOAN_MONTHS` and the
# `loan_rate_bps` ceiling below -- see that constant's docstring for why the
# bound is not `amortization.MAX_LOAN_MONTHS`.
DEFAULT_LOAN_RATE_BPS = 500
DEFAULT_LOAN_MONTHS = 60


def _existing_debt_payments_cents(db: Session, user_id: int) -> int:
    return sum(
        row.minimum_payment_cents
        for row in db.query(Debt).filter(
            Debt.user_id == user_id, Debt.archived.is_(False)
        ).all()
    )


def _category_history(
    db: Session, user_id: int, months: list[MonthObservation]
) -> list[CategoryHistory]:
    """Each category's spend, per complete observed month, as positive magnitudes.

    Income rows are EXCLUDED rather than netted in -- the same rule
    `aggregate.aggregate_by_category` applies (`aggregate.py:157-158`), and the
    same one `engines/budget.py` refuses a positive `spent_cents` over. A
    category whose refunds exceed its spend in a month would otherwise
    contribute a negative "spend" to a median that is supposed to say what a
    normal month costs.

    Transfers are excluded: moving money to a savings account is not a
    reducible expense.

    Only months in `months` count, so the operator's eight unimported months
    cannot enter a median as zeroes. A month that WAS observed and in which the
    category was simply not spent counts as zero, though -- that is the whole
    difference between "what this costs in a normal month" and "what this costs
    in a month it happens to appear". A rent paid once a quarter has a median
    of nothing, and a screen saying otherwise names a saving that is not there.
    """
    if not months:
        return []
    keys = {month.key for month in months}
    names = {c.id: c.name for c in db.query(Category).filter(
        Category.user_id == user_id).all()}
    totals: dict[int, dict[str, int]] = {}
    for point in tx_points(db, user_id, months[0].start, months[-1].end):
        if point.is_transfer or point.amount_cents >= 0 or point.category_id is None:
            continue
        key = f"{point.on.year}-{point.on.month:02d}"
        if key not in keys:
            continue
        totals.setdefault(point.category_id, dict.fromkeys(sorted(keys), 0))
        totals[point.category_id][key] += -point.amount_cents
    return [
        CategoryHistory(category_id=category_id, name=names.get(category_id, "Sans nom"),
                        monthly_cents=[by_month[key] for key in sorted(by_month)])
        for category_id, by_month in totals.items()
    ]


def _assumptions(db: Session, user: User, payload: FeasibilityIn | None,
                 months: list[MonthObservation]) -> Assumptions:
    income = measure_income_rate(months)
    return Assumptions(
        annual_return_bps=(payload.annual_return_bps if payload
                           and payload.annual_return_bps is not None
                           else DEFAULT_ANNUAL_RETURN_BPS),
        loan_rate_bps=(payload.loan_rate_bps if payload and payload.loan_rate_bps
                       is not None else DEFAULT_LOAN_RATE_BPS),
        loan_months=(payload.loan_months if payload and payload.loan_months
                     is not None else DEFAULT_LOAN_MONTHS),
        ownership_years=(payload.ownership_years if payload and payload.ownership_years
                         is not None else DEFAULT_OWNERSHIP_YEARS),
        # Measured, and null-preserving: a household whose income could not be
        # measured has no debt ratio, and `debt_ratio_bps` refuses accordingly.
        monthly_income_cents=None if income is None else income.median_cents,
        existing_debt_payments_cents=_existing_debt_payments_cents(db, user.id),
    )


def _assumptions_out(assumptions: Assumptions) -> AssumptionsOut:
    return AssumptionsOut(
        annual_return_bps=assumptions.annual_return_bps,
        loan_rate_bps=assumptions.loan_rate_bps,
        loan_months=assumptions.loan_months,
        ownership_years=assumptions.ownership_years,
        monthly_income_cents=assumptions.monthly_income_cents,
        existing_debt_payments_cents=assumptions.existing_debt_payments_cents,
    )


def _ownership_defaults() -> dict[str, OwnershipDefaultsOut]:
    """Every nature's prefilled items, in the shape the POST accepts back.

    Built from `ownership.defaults_for` rather than restated here: one set of
    French averages, in one place, so the form a user edits and the figures the
    engine applies cannot drift apart.
    """
    natures = {}
    for nature in ("vehicle", "property", "other"):
        items, depreciation = defaults_for(nature)
        natures[nature] = OwnershipDefaultsOut(
            items=[CostItemIn(key=item.key, label=item.label,
                              monthly_cents=item.monthly_cents,
                              annual_bps_of_value=item.annual_bps_of_value)
                   for item in items],
            depreciation_bps_per_year=depreciation,
        )
    return natures


@router.get("/context", response_model=FeasibilityContextOut)
def context(user: User = Depends(get_current_user),
            db: Session = Depends(get_db)) -> FeasibilityContextOut:
    """Everything measured, before the user has typed anything."""
    months = observed_months(db, user.id)
    return FeasibilityContextOut(
        capacity=rate_out(measure_savings_capacity(months)),
        expense_rate=rate_out(measure_expense_rate(months)),
        income_rate=rate_out(measure_income_rate(months)),
        months_observed=len(months),
        history=user_history(db, user.id),
        balance_cents=liquid_balance_cents(db, user.id),
        existing_debt_payments_cents=_existing_debt_payments_cents(db, user.id),
        assumptions=_assumptions_out(_assumptions(db, user, None, months)),
        ownership_defaults=_ownership_defaults(),
    )


def _assess(payload: FeasibilityIn, user: User, db: Session) -> FeasibilityOut:
    """Design §6.3, end to end. See the module docstring for the POST and the
    clock. Shared by `POST /api/feasibility` and every scenario read below --
    one computation, in one place, so a scenario's recomputed answer can never
    drift from what asking the same question directly would return."""
    months = observed_months(db, user.id)
    assumptions = _assumptions(db, user, payload, months)
    request = PurchaseRequest(
        target_cents=payload.target_cents, horizon_months=payload.horizon_months,
        down_payment_cents=payload.down_payment_cents, nature=payload.nature,
    )

    default_items, depreciation = defaults_for(payload.nature)
    items = (
        [CostItem(key=i.key, label=i.label, monthly_cents=i.monthly_cents,
                  annual_bps_of_value=i.annual_bps_of_value)
         for i in payload.ownership_items]
        if payload.ownership_items is not None
        else list(default_items)
    )

    # Fetched once and reused: three calls would be three identical aggregate
    # queries, and a figure the response reports must be the same one the
    # engine was handed.
    balance = liquid_balance_cents(db, user.id)

    try:
        report = assess_feasibility(
            request,
            measure_savings_capacity(months),
            measure_expense_rate(months),
            balance,
            assumptions,
            date.today(),
        )
        ownership = total_cost_of_ownership(
            payload.target_cents, assumptions.ownership_years, items, depreciation
        )
        levers = build_levers(report, _category_history(db, user.id, months))
        financing = compare_financing(
            payload.target_cents, payload.down_payment_cents, assumptions,
            None if payload.loa is None else LoaTerms(
                deposit_cents=payload.loa.deposit_cents,
                monthly_cents=payload.loa.monthly_cents,
                months=payload.loa.months,
                residual_cents=payload.loa.residual_cents),
        )
    except ValueError as exc:
        # The engines raise in French already -- the same catch-and-forward
        # idiom `api/analysis.py` uses for `compute_inflation`'s own guard.
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return FeasibilityOut(
        target_cents=request.target_cents, horizon_months=request.horizon_months,
        down_payment_cents=request.down_payment_cents, nature=request.nature,
        horizon_end_on=report.horizon_end_on,
        assumptions=_assumptions_out(assumptions),
        capacity=rate_out(report.capacity),
        capacity_unavailable_reason=report.capacity_unavailable_reason,
        months_observed=len(months), history=user_history(db, user.id),
        balance_cents=balance,
        verdict=report.verdict,
        saved_at_horizon_cents=report.saved_at_horizon_cents,
        saved_at_horizon_low_cents=report.saved_at_horizon_low_cents,
        saved_at_horizon_high_cents=report.saved_at_horizon_high_cents,
        gap_cents=report.gap_cents,
        opportunity_cost_cents=report.opportunity_cost_cents,
        opportunity_horizon_months=report.opportunity_horizon_months,
        ownership=OwnershipOut(
            price_cents=ownership.price_cents, years=ownership.years,
            lines=[CostLineOut(key=line.key, label=line.label,
                               total_cents=line.total_cents,
                               monthly_average_cents=line.monthly_average_cents)
                   for line in ownership.lines],
            depreciation_cents=ownership.depreciation_cents,
            residual_value_cents=ownership.residual_value_cents,
            running_cost_cents=ownership.running_cost_cents,
            total_cost_cents=ownership.total_cost_cents,
            monthly_average_cents=ownership.monthly_average_cents),
        impact=ImpactOut(
            emergency=EmergencyImpactOut(
                runway_months_before=report.impact.emergency.runway_months_before,
                runway_months_after=report.impact.emergency.runway_months_after,
                monthly_burn_cents=report.impact.emergency.monthly_burn_cents,
                unavailable_reason=report.impact.emergency.unavailable_reason),
            liquid_in_five_years_before_cents=report.impact
            .liquid_in_five_years_before_cents,
            liquid_in_five_years_after_cents=report.impact
            .liquid_in_five_years_after_cents,
            liquid_unavailable_reason=report.impact.liquid_unavailable_reason),
        levers=[LeverOut(**lever.__dict__) for lever in levers],
        financing=FinancingOut(
            horizon_months=financing.horizon_months,
            options=[FinancingOptionOut(**option.__dict__)
                     for option in financing.options],
            break_even_rate_bps=financing.break_even_rate_bps,
            break_even_reason=financing.break_even_reason,
            better_kind=financing.better_kind,
            wealth_gap_cents=financing.wealth_gap_cents),
    )


@router.post("", response_model=FeasibilityOut)
def assess(payload: FeasibilityIn, user: User = Depends(get_current_user),
           db: Session = Depends(get_db)) -> FeasibilityOut:
    """Design §6.3, end to end. See the module docstring for the POST and the clock."""
    return _assess(payload, user, db)


# Each scenario read recomputes a full feasibility answer, which walks the
# whole ledger. Ten is generous for a household comparing purchases and keeps
# one page load to ten computations rather than an unbounded number.
MAX_SCENARIOS = 10


def _owned_scenario(db: Session, user: User, scenario_id: int) -> Scenario:
    scenario = db.query(Scenario).filter(
        Scenario.id == scenario_id, Scenario.user_id == user.id,
        Scenario.kind == SCENARIO_KIND).first()
    if scenario is None:
        raise HTTPException(status_code=404, detail="Scénario introuvable")
    return scenario


@router.post("/scenarios", response_model=ScenarioOut,
             status_code=status.HTTP_201_CREATED)
def save_scenario(payload: ScenarioIn, user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)) -> ScenarioOut:
    """Store the QUESTION. The answer is recomputed on every read -- see
    `models.Scenario`'s docstring for why. `payload.request` is already
    validated as a `FeasibilityIn` by FastAPI before this runs, so nothing
    that could not itself answer `POST /api/feasibility` is ever persisted."""
    existing = db.query(Scenario).filter(
        Scenario.user_id == user.id, Scenario.kind == SCENARIO_KIND).count()
    if existing >= MAX_SCENARIOS:
        raise HTTPException(
            status_code=422,
            detail=f"Vous ne pouvez pas enregistrer plus de {MAX_SCENARIOS} "
                   "scénarios. Supprimez-en un pour en ajouter un autre.")
    scenario = Scenario(user_id=user.id, name=payload.name, kind=SCENARIO_KIND,
                        payload=payload.request.model_dump_json())
    db.add(scenario)
    db.commit()
    db.refresh(scenario)
    return ScenarioOut(id=scenario.id, name=scenario.name,
                       created_at=scenario.created_at, request=payload.request,
                       result=_assess(payload.request, user, db))


@router.get("/scenarios", response_model=list[ScenarioOut])
def list_scenarios(user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> list[ScenarioOut]:
    """Every saved scenario, each recomputed against the CURRENT ledger.

    The stored payload is re-validated through `FeasibilityIn` rather than
    trusted: the database is not an input this code controls, and a row that no
    longer parses -- edited by hand, or written by a schema version this one
    has moved past -- must surface as a French error naming the scenario,
    rather than a 500 that takes the whole list down with it.
    """
    out: list[ScenarioOut] = []
    for row in db.query(Scenario).filter(
            Scenario.user_id == user.id, Scenario.kind == SCENARIO_KIND
    ).order_by(Scenario.id).all():
        try:
            request = FeasibilityIn.model_validate(json.loads(row.payload))
        except (ValueError, TypeError) as exc:
            raise HTTPException(
                status_code=422,
                detail=f"Le scénario « {row.name} » n'est plus lisible et doit "
                       "être supprimé puis recréé.") from exc
        out.append(ScenarioOut(id=row.id, name=row.name, created_at=row.created_at,
                               request=request, result=_assess(request, user, db)))
    return out


@router.delete("/scenarios/{scenario_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_scenario(scenario_id: int, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)) -> None:
    """A hard delete, unlike debts and goals: a scenario holds no history worth
    keeping -- it is a question, and the same question can be asked again."""
    db.delete(_owned_scenario(db, user, scenario_id))
    db.commit()
