"""engines/outlook: the balance day by day, its band, its low point, its scenarios."""

from datetime import date, timedelta

from app.engines.capacity import MonthlyEntry, MonthObservation
from app.engines.forecast import ResidualModel, ResidualMonth
from app.engines.outlook import (
    Adjustment,
    apply_adjustments,
    month_profile_bps,
    outlook_keys,
    project_outlook,
    uniform_profile_bps,
)
from app.engines.outlook_sources import KnownEvent

AS_OF = date(2026, 8, 31)
UNIFORM = uniform_profile_bps()


def _event(on, cents, label="x", source="detected", series=None):
    return KnownEvent(on=on, amount_cents=cents, label=label, source=source,
                      series=series or f"{source}:{label}", category_id=None)


def _model(centre, variance_per_month, keys, status="measured"):
    months = [
        ResidualMonth(key=key, centre_cents=centre, seasonal=False,
                      cumulative_variance=float(variance_per_month * (index + 1)))
        for index, key in enumerate(keys)
    ]
    return ResidualModel(status=status, months=months, observed=12,
                         pooled_scale_cents=100, seasonal_scale_cents=None)


def _project(events=(), model=None, horizon_days=61, opening=100_000, threshold=0,
             profile=UNIFORM, as_of=AS_OF):
    return project_outlook(opening_balance_cents=opening, as_of=as_of, horizon_days=horizon_days,
                           events=list(events), model=model, profile_bps=profile,
                           threshold_cents=threshold)


# -- Known events alone ------------------------------------------------------------


def test_without_a_variable_part_the_days_add_up_the_known_events():
    outlook = _project(events=[_event(date(2026, 9, 5), -92_000),
                               _event(date(2026, 9, 28), 261_000)])
    day = {entry.on: entry for entry in outlook.days}
    assert day[date(2026, 9, 4)].p50_cents == 100_000
    assert day[date(2026, 9, 5)].p50_cents == 8_000
    assert day[date(2026, 9, 28)].p50_cents == 269_000
    assert all(entry.p10_cents == entry.p50_cents == entry.p90_cents for entry in outlook.days)
    assert outlook.band is False
    assert "Pas assez d'historique" in outlook.band_unavailable_reason


def test_the_projection_starts_the_day_after_as_of_and_ends_on_the_horizon():
    outlook = _project(horizon_days=30)
    assert outlook.days[0].on == AS_OF + timedelta(days=1)
    assert outlook.days[-1].on == AS_OF + timedelta(days=30)
    assert outlook.horizon_end == AS_OF + timedelta(days=30)


# -- The variable part -------------------------------------------------------------


def test_a_full_month_spends_exactly_its_centre():
    keys = outlook_keys(AS_OF, AS_OF + timedelta(days=61))
    outlook = _project(model=_model(-300_000, 0, keys, status="flat"))
    end_of_september = next(entry for entry in outlook.days if entry.on == date(2026, 9, 30))
    assert end_of_september.p50_cents == 100_000 - 300_000


def test_a_uniform_profile_spends_the_centre_evenly():
    keys = outlook_keys(AS_OF, AS_OF + timedelta(days=61))
    outlook = _project(model=_model(-300_000, 0, keys, status="flat"))
    mid = next(entry for entry in outlook.days if entry.on == date(2026, 9, 15))
    assert abs(mid.p50_cents - (100_000 - 150_000)) <= 10_000


def test_the_first_month_counts_only_what_is_left_of_it():
    as_of = date(2026, 9, 15)
    keys = outlook_keys(as_of, as_of + timedelta(days=30))
    outlook = _project(model=_model(-300_000, 0, keys, status="flat"), as_of=as_of,
                       horizon_days=15)
    last = outlook.days[-1]
    assert last.on == date(2026, 9, 30)
    spent = 100_000 - last.p50_cents
    assert 140_000 <= spent <= 160_000


def test_the_band_widens_with_distance_and_never_narrows():
    keys = outlook_keys(AS_OF, AS_OF + timedelta(days=120))
    outlook = _project(model=_model(-100_000, 40_000_000, keys), horizon_days=120)
    widths = [entry.p90_cents - entry.p10_cents for entry in outlook.days]
    assert widths == sorted(widths)
    assert widths[-1] > widths[0]
    assert outlook.band is True
    assert outlook.band_unavailable_reason is None


def test_a_flat_variable_part_is_exact_and_says_it_has_no_band():
    keys = outlook_keys(AS_OF, AS_OF + timedelta(days=61))
    outlook = _project(model=_model(-100_000, 0, keys, status="flat"))
    assert outlook.band is False
    assert "ne varient pas" in outlook.band_unavailable_reason


# -- The household's own month ------------------------------------------------------


def _month(key, start, end):
    return MonthObservation(key=key, start=start, end=end, inflow_cents=0,
                            outflow_cents=0, net_cents=0, count=0)


def test_a_household_that_spends_early_has_a_profile_that_rises_early():
    months, rows = [], []
    for index in range(8):
        month = index + 1
        start = date(2025, month, 1)
        end = date(2025, month + 1, 1) - timedelta(days=1)
        months.append(_month(f"2025-{month:02d}", start, end))
        rows.append(MonthlyEntry(on=date(2025, month, 2), amount_cents=-80_000))
        rows.append(MonthlyEntry(on=date(2025, month, 25), amount_cents=-20_000))
    profile = month_profile_bps(rows, months)
    assert profile[0] == 0
    assert profile[-1] == 10_000
    assert list(profile) == sorted(profile)
    assert profile[5] >= 7_500
    assert profile[20] < 10_000


def test_below_six_months_the_profile_is_uniform():
    months = [_month("2025-01", date(2025, 1, 1), date(2025, 1, 31))]
    rows = [MonthlyEntry(on=date(2025, 1, 2), amount_cents=-80_000)]
    assert month_profile_bps(rows, months) == uniform_profile_bps()


# -- The low point and the risk -----------------------------------------------------


def _month_of_bills():
    return [_event(date(2026, 9, 5), -92_000, "loyer"),
            _event(date(2026, 9, 28), 261_000, "salaire"),
            _event(date(2026, 10, 5), -92_000, "loyer"),
            _event(date(2026, 10, 28), 261_000, "salaire")]


def test_the_low_point_is_the_lowest_median_day():
    outlook = _project(events=_month_of_bills(), opening=95_000)
    assert outlook.low_point.on == date(2026, 9, 5)
    assert outlook.low_point.p50_cents == 3_000


def test_the_three_risk_levels():
    keys = outlook_keys(AS_OF, AS_OF + timedelta(days=61))
    wide = _model(0, 900_000_000, keys)
    assert _project(events=_month_of_bills(), opening=95_000, model=wide).risk == "possible"
    assert _project(events=_month_of_bills(), opening=500_000, model=wide).risk == "none"
    assert _project(events=_month_of_bills(), opening=50_000).risk == "probable"


def test_the_threshold_decides_the_first_breach():
    outlook = _project(events=_month_of_bills(), opening=95_000, threshold=5_000)
    assert outlook.first_breach_on == date(2026, 9, 5)
    assert outlook.risk == "probable"
    assert outlook.threshold_cents == 5_000


def test_each_event_carries_the_balance_right_after_its_day():
    outlook = _project(events=_month_of_bills(), opening=95_000)
    rent = next(placed for placed in outlook.events if placed.event.label == "loyer")
    assert rent.balance_after_cents == 3_000


def test_month_ends_are_read_off_the_days():
    outlook = _project(events=_month_of_bills(), opening=95_000)
    september = next(month for month in outlook.months if month.key == "2026-09")
    last_day = next(entry for entry in outlook.days if entry.on == date(2026, 9, 30))
    assert september.p50_cents == last_day.p50_cents
    assert september.low_on == date(2026, 9, 5)


def test_the_variable_part_is_quoted_per_day():
    keys = outlook_keys(AS_OF, AS_OF + timedelta(days=61))
    outlook = _project(model=_model(-300_000, 0, keys, status="flat"))
    assert outlook.variable_daily_cents == -10_000


# -- Et si… ----------------------------------------------------------------------


def test_a_one_off_adjustment_adds_an_event():
    events = apply_adjustments(_month_of_bills(), [
        Adjustment(kind="one_off", on=date(2026, 9, 20), label="Vacances", amount_cents=-180_000)])
    added = [event for event in events if event.source == "scenario"]
    assert [(event.on, event.amount_cents, event.label) for event in added] == [
        (date(2026, 9, 20), -180_000, "Vacances")]


def test_cancelling_a_series_drops_its_charges_from_the_given_day():
    events = apply_adjustments(_month_of_bills(), [
        Adjustment(kind="cancel", on=date(2026, 10, 1), series="detected:loyer")])
    assert [event.on for event in events if event.label == "loyer"] == [date(2026, 9, 5)]


def test_changing_an_amount_reprices_the_series_from_the_given_day():
    events = apply_adjustments(_month_of_bills(), [
        Adjustment(kind="change_amount", on=date(2026, 10, 1), series="detected:salaire",
                   amount_cents=240_000)])
    salaries = [(event.on, event.amount_cents) for event in events if event.label == "salaire"]
    assert salaries == [(date(2026, 9, 28), 261_000), (date(2026, 10, 28), 240_000)]
