"""POST /api/simulators/credit, /epargne, /immobilier, and GET /api/simulators/context.

Same POST rationale as `/api/feasibility`: a structured input with no side
effect -- as a query string the property payload alone is a dozen-odd
parameters -- and the route is idempotent regardless. Every `ValueError` an
engine raises becomes a French 422 through the same catch-and-forward idiom
`/api/feasibility` already uses.

The property route measures the household's income and existing instalments
itself (`measure_income_rate(observed_months(db, user.id))`,
`_existing_debt_payments_cents`) rather than accepting them from the client,
so the debt ratio it prints is measured, not typed -- the same discipline
`/api/feasibility` already applies to its own assumptions. The credit and
savings simulators are pure computations and read no user data at all, but
sit behind `get_current_user` like every other route in this API.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.feasibility import _existing_debt_payments_cents
from app.api.goals import observed_months
from app.db import get_db
from app.engines.amortization import LoanSchedule, ScheduleRow, build_schedule
from app.engines.capacity import measure_income_rate
from app.engines.property import PropertyRequest, rent_comparison, simulate_property
from app.engines.savings import project_savings
from app.models import User
from app.schemas.simulators import (
    CreditIn,
    CreditOut,
    PropertyIn,
    PropertyOut,
    PropertySimulationOut,
    RentComparisonOut,
    SavingsIn,
    SavingsOut,
    SavingsPointOut,
    ScheduleOut,
    ScheduleRowOut,
    ScheduleYearOut,
    SimulatorContextOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/simulators", tags=["simulators"])


def _row_out(row: ScheduleRow) -> ScheduleRowOut:
    return ScheduleRowOut(
        month=row.month, payment_cents=row.payment_cents,
        interest_cents=row.interest_cents, principal_cents=row.principal_cents,
        remaining_cents=row.remaining_cents,
    )


def _schedule_out(schedule: LoanSchedule) -> ScheduleOut:
    return ScheduleOut(
        principal_cents=schedule.principal_cents, annual_rate_bps=schedule.annual_rate_bps,
        months=schedule.months, monthly_payment_cents=schedule.monthly_payment_cents,
        total_paid_cents=schedule.total_paid_cents,
        total_interest_cents=schedule.total_interest_cents,
        rows=[_row_out(row) for row in schedule.rows],
    )


def _yearly_rollup(rows: list[ScheduleRow]) -> list[ScheduleYearOut]:
    """Twelve rows per bar -- what `charts/AmortizationChart.tsx` draws.

    A presentation concern, computed here rather than in the engine: the
    engine has no business knowing a chart wants twenty bars instead of 240.
    The last group may hold fewer than twelve rows when the term is not a
    whole number of years, or when the loan was repaid early -- summed the
    same way regardless, so the parts still sum back to the whole.
    """
    years: list[ScheduleYearOut] = []
    for start in range(0, len(rows), 12):
        chunk = rows[start:start + 12]
        years.append(ScheduleYearOut(
            year=start // 12 + 1,
            interest_cents=sum(row.interest_cents for row in chunk),
            principal_cents=sum(row.principal_cents for row in chunk),
            remaining_cents=chunk[-1].remaining_cents,
        ))
    return years


@router.get("/context", response_model=SimulatorContextOut)
def context(user: User = Depends(get_current_user),
            db: Session = Depends(get_db)) -> SimulatorContextOut:
    """The measured income and existing instalments, so the property
    simulator's debt ratio prefills from data rather than a guess."""
    months = observed_months(db, user.id)
    income = measure_income_rate(months)
    return SimulatorContextOut(
        monthly_income_cents=None if income is None else income.median_cents,
        existing_debt_payments_cents=_existing_debt_payments_cents(db, user.id),
        months_observed=len(months),
    )


@router.post("/credit", response_model=CreditOut)
def simulate_credit(payload: CreditIn,
                    user: User = Depends(get_current_user)) -> CreditOut:
    try:
        schedule = build_schedule(
            payload.principal_cents, payload.annual_rate_bps, payload.months)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return CreditOut(
        principal_cents=schedule.principal_cents, annual_rate_bps=schedule.annual_rate_bps,
        months=schedule.months, monthly_payment_cents=schedule.monthly_payment_cents,
        total_paid_cents=schedule.total_paid_cents,
        total_interest_cents=schedule.total_interest_cents,
        rows=[_row_out(row) for row in schedule.rows],
        years=_yearly_rollup(schedule.rows),
    )


@router.post("/epargne", response_model=SavingsOut)
def simulate_savings(payload: SavingsIn,
                     user: User = Depends(get_current_user)) -> SavingsOut:
    try:
        projection = project_savings(
            payload.initial_cents, payload.monthly_cents,
            payload.annual_rate_bps, payload.months)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return SavingsOut(
        initial_cents=projection.initial_cents, monthly_cents=projection.monthly_cents,
        annual_rate_bps=projection.annual_rate_bps, months=projection.months,
        final_cents=projection.final_cents, contributed_cents=projection.contributed_cents,
        interest_cents=projection.interest_cents,
        points=[
            SavingsPointOut(month=point.month, contributed_cents=point.contributed_cents,
                            interest_cents=point.interest_cents,
                            balance_cents=point.balance_cents)
            for point in projection.points
        ],
    )


@router.post("/immobilier", response_model=PropertyOut)
def simulate_property_route(payload: PropertyIn, user: User = Depends(get_current_user),
                            db: Session = Depends(get_db)) -> PropertyOut:
    months = observed_months(db, user.id)
    income = measure_income_rate(months)
    existing_debt = _existing_debt_payments_cents(db, user.id)
    request = PropertyRequest(
        price_cents=payload.price_cents, down_payment_cents=payload.down_payment_cents,
        notary_bps=payload.notary_bps, loan_rate_bps=payload.loan_rate_bps,
        loan_months=payload.loan_months, insurance_bps_per_year=payload.insurance_bps_per_year,
        monthly_charges_cents=payload.monthly_charges_cents,
        annual_property_tax_cents=payload.annual_property_tax_cents,
        # Measured, not typed. See the module docstring.
        monthly_income_cents=None if income is None else income.median_cents,
        existing_debt_payments_cents=existing_debt,
    )
    try:
        simulation = simulate_property(request)
        comparison = (
            None if payload.monthly_rent_cents is None
            else rent_comparison(
                simulation, payload.monthly_rent_cents, payload.years,
                payload.annual_return_bps, payload.appreciation_bps_per_year)
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return PropertyOut(
        simulation=PropertySimulationOut(
            price_cents=simulation.price_cents, notary_fees_cents=simulation.notary_fees_cents,
            acquisition_cost_cents=simulation.acquisition_cost_cents,
            down_payment_cents=simulation.down_payment_cents,
            down_payment_short_cents=simulation.down_payment_short_cents,
            borrowed_cents=simulation.borrowed_cents,
            schedule=_schedule_out(simulation.schedule),
            monthly_insurance_cents=simulation.monthly_insurance_cents,
            monthly_charges_cents=simulation.monthly_charges_cents,
            monthly_property_tax_cents=simulation.monthly_property_tax_cents,
            monthly_effort_cents=simulation.monthly_effort_cents,
            total_interest_cents=simulation.total_interest_cents,
            total_cost_cents=simulation.total_cost_cents,
            debt_ratio_bps=simulation.debt_ratio_bps,
            debt_ratio_exceeded=simulation.debt_ratio_exceeded,
        ),
        rent_comparison=None if comparison is None else RentComparisonOut(
            horizon_months=comparison.horizon_months, capped_reason=comparison.capped_reason,
            monthly_rent_cents=comparison.monthly_rent_cents,
            buyer_property_value_cents=comparison.buyer_property_value_cents,
            buyer_remaining_loan_cents=comparison.buyer_remaining_loan_cents,
            buyer_wealth_cents=comparison.buyer_wealth_cents,
            renter_wealth_cents=comparison.renter_wealth_cents,
            difference_cents=comparison.difference_cents,
            better_kind=comparison.better_kind,
        ),
        measured_monthly_income_cents=request.monthly_income_cents,
        existing_debt_payments_cents=existing_debt,
    )
