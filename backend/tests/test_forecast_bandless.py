"""A projection with no band, for the two households that could not have one.

Found by the audit: on an eighteen-month ledger whose every charge is a
detected recurrence, the Trésorerie screen showed nothing at all. The refusal
was honest -- with no non-recurring rows there is no dispersion to measure --
but its consequence was perverse: **the more regular a household is, the less
that screen serves it**, and a household whose every euro is a standing order
is exactly the one whose cash flow is most knowable.

Two causes, two different sentences, one shape: the months are projected and
`balance_p10 == balance_p50 == balance_p90`, so no ribbon can be drawn and
nothing pretends one was measured.
"""

from datetime import date

from app.engines.capacity import MonthObservation
from app.engines.forecast import (
    MIN_MONTHS_FOR_FORECAST,
    ResidualHistory,
    project_cashflow,
)
from app.engines.recurrence import Recurrence

TODAY = date(2026, 8, 26)


def _recurrence(label: str, amount_cents: int, day: int = 3) -> Recurrence:
    return Recurrence(
        label_key=label.lower(), label=label, category_id=None,
        periodicity="monthly", occurrences=18,
        first_on=date(2025, 3, day), last_on=date(2026, 8, day),
        median_interval_days=30, amount_cents=amount_cents,
        amount_spread_cents=0, annual_cents=amount_cents * 12,
        observed_span_days=518, annualisable=True,
        expected_next_on=date(2026, 9, day), status="active",
        confidence="confirmed", price_change=None,
    )


def _month(key: str, start: date, end: date, net: int) -> MonthObservation:
    return MonthObservation(key=key, start=start, end=end, inflow_cents=max(0, net),
                            outflow_cents=min(0, net), net_cents=net, count=1)


RENT = _recurrence("PRLV LOYER", -78_000)
SALARY = _recurrence("VIR SALAIRE", 298_000, day=1)


# --- Everything is recurring: project the known charges, and say so ----------

def test_a_household_whose_every_charge_is_recurring_still_gets_a_projection():
    report = project_cashflow(
        balance_cents=500_000,
        history=ResidualHistory(observations=[], ledger_months_observed=18),
        recurrences=[RENT, SALARY],
        today=TODAY,
        horizon_months=3,
    )

    assert report.insufficient_reason is None
    assert len(report.months) == 3
    # 2 980 - 780 = 2 200 EUR a month, and the balance follows it.
    assert report.months[0].recurring_cents == 220_000
    assert report.months[0].balance_p50_cents == 720_000
    assert report.months[2].balance_p50_cents == 1_160_000


def test_that_projection_carries_no_band_and_says_why():
    report = project_cashflow(
        balance_cents=500_000,
        history=ResidualHistory(observations=[], ledger_months_observed=18),
        recurrences=[RENT, SALARY],
        today=TODAY,
        horizon_months=3,
    )

    for month in report.months:
        assert month.balance_p10_cents == month.balance_p50_cents
        assert month.balance_p90_cents == month.balance_p50_cents
    assert report.band_unavailable_reason is not None
    assert report.recurring_only is True
    # The scales are what a band would have been built from. Nothing was
    # measured, so nothing is published -- never a zero standing in for one.
    assert report.pooled_scale_cents == 0
    assert report.seasonal_scale_cents is None


def test_the_projection_excludes_the_variable_part_and_names_the_omission():
    """It is a projection of the KNOWN charges, not of the month. Presenting it
    as the whole month would be the confident-looking falsehood the refusal was
    there to prevent."""
    report = project_cashflow(
        balance_cents=500_000,
        history=ResidualHistory(observations=[], ledger_months_observed=18),
        recurrences=[RENT, SALARY],
        today=TODAY,
        horizon_months=3,
    )

    assert all(month.residual_cents == 0 for month in report.months)
    assert "récurrentes" in report.band_unavailable_reason
    assert "marge d'erreur" in report.band_unavailable_reason


def test_a_short_ledger_still_refuses_outright():
    """The other cause, and it is unchanged: too few months of statements is a
    thing the reader can fix by importing more, and a projection built on two
    months would be the invention this engine exists to refuse."""
    report = project_cashflow(
        balance_cents=500_000,
        history=ResidualHistory(observations=[], ledger_months_observed=2),
        recurrences=[RENT, SALARY],
        today=TODAY,
        horizon_months=3,
    )

    assert report.months == []
    assert report.insufficient_reason is not None
    assert str(MIN_MONTHS_FOR_FORECAST) in report.insufficient_reason


def test_a_long_ledger_with_nothing_to_project_still_refuses():
    """No residual AND no recurrence is not a regular household, it is an empty
    one. There is nothing to draw."""
    report = project_cashflow(
        balance_cents=500_000,
        history=ResidualHistory(observations=[], ledger_months_observed=18),
        recurrences=[],
        today=TODAY,
        horizon_months=3,
    )

    assert report.months == []
    assert report.insufficient_reason is not None


# --- A measurable residual that never moves ---------------------------------

def _flat_history(months: int, net: int) -> ResidualHistory:
    observations = []
    for index in range(months):
        year = 2025 + (2 + index) // 12
        month = (2 + index) % 12 + 1
        last = 28
        observations.append(_month(
            f"{year}-{month:02d}", date(year, month, 1), date(year, month, last), net,
        ))
    return ResidualHistory(observations=observations, ledger_months_observed=months)


def test_a_residual_that_never_varies_is_projected_without_a_band():
    """It used to refuse. But a residual measured over twelve months that comes
    out cent-exact is not unmeasurable -- it is measured, and it is flat. The
    projection is exact; what does not exist is a margin of error."""
    report = project_cashflow(
        balance_cents=500_000,
        history=_flat_history(12, -40_000),
        recurrences=[RENT, SALARY],
        today=TODAY,
        horizon_months=3,
    )

    assert report.insufficient_reason is None
    assert len(report.months) == 3
    assert report.recurring_only is False
    assert all(month.residual_cents == -40_000 for month in report.months)
    assert report.months[0].balance_p50_cents == 500_000 + 220_000 - 40_000
    for month in report.months:
        assert month.balance_p10_cents == month.balance_p50_cents == month.balance_p90_cents
    assert "ne varient pas" in report.band_unavailable_reason


def test_a_residual_that_does_vary_keeps_its_band():
    """The control. Nothing above may touch the ordinary case."""
    observations = _flat_history(12, -40_000).observations
    moved = [
        MonthObservation(key=o.key, start=o.start, end=o.end,
                         inflow_cents=o.inflow_cents, outflow_cents=o.outflow_cents,
                         net_cents=o.net_cents + (index % 5) * 3_000, count=1)
        for index, o in enumerate(observations)
    ]
    report = project_cashflow(
        balance_cents=500_000,
        history=ResidualHistory(observations=moved, ledger_months_observed=12),
        recurrences=[RENT, SALARY],
        today=TODAY,
        horizon_months=3,
    )

    assert report.band_unavailable_reason is None
    assert report.recurring_only is False
    assert report.months[0].balance_p10_cents < report.months[0].balance_p50_cents
    assert report.months[0].balance_p90_cents > report.months[0].balance_p50_cents
