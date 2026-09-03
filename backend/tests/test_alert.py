"""`engines/alert.py` -- the five conditions, and the data that was never measured.

The rule the whole module exists for, and the one most of this file tests:
**no alert fires on data that was not measured.** The operator's ledger spans
2025-01-24 to 2026-01-09 with eight calendar months inside it holding nothing
at all; a subscription that "did not arrive" in one of those months is a hole
in the import, not a missed payment, and saying otherwise is this project's
single most repeated defect.
"""

from datetime import date

import pytest

from app.engines.alert import (
    ALERT_KINDS,
    AnomalyInput,
    AnomalySubject,
    BalanceFloorInput,
    BudgetInput,
    BudgetSubject,
    evaluate_alerts,
    measure_coverage,
)
from app.engines.anomaly import Anomaly
from app.engines.budget import BudgetLine
from app.engines.forecast import ForecastMonth, ForecastReport
from app.engines.recurrence import PriceChange, Recurrence

# The operator's own ledger, month by month: 2025-01, 02, 03, then nothing at
# all until 2025-12 and 2026-01. See seed_fixture.py's MONTH_COUNTS.
OPERATOR_DATES = [
    date(2025, 1, 24), date(2025, 2, 14), date(2025, 3, 20),
    date(2025, 12, 3), date(2026, 1, 9),
]
OPERATOR_COVERAGE = measure_coverage(OPERATOR_DATES)


def _recurrence(**overrides) -> Recurrence:
    base = dict(
        label_key="prelevement sepa free mobile",
        label="PRELEVEMENT SEPA FREE MOBILE",
        category_id=7,
        periodicity="monthly",
        occurrences=4,
        first_on=date(2025, 9, 5),
        last_on=date(2025, 12, 5),
        median_interval_days=30,
        amount_cents=-1999,
        amount_spread_cents=0,
        annual_cents=-23988,
        observed_span_days=91,
        annualisable=True,
        expected_next_on=date(2026, 1, 4),
        status="missing",
        confidence="confirmed",
        price_change=None,
    )
    base.update(overrides)
    return Recurrence(**base)


def _forecast_month(key: str, low: int, mid: int, breached: bool) -> ForecastMonth:
    year, month = (int(part) for part in key.split("-"))
    return ForecastMonth(
        key=key, start=date(year, month, 1), end=date(year, month, 28),
        recurring_cents=-80000, residual_cents=-60000, net_p50_cents=-140000,
        balance_p10_cents=low, balance_p50_cents=mid, balance_p90_cents=mid + 50000,
        below_threshold=breached, seasonal=False,
    )


def _forecast(months: list[ForecastMonth], *, threshold: int = 0,
              breach: str | None = None, reason: str | None = None) -> ForecastReport:
    return ForecastReport(
        months=months, months_observed=3, ledger_months_observed=3,
        seasonality_used=False, recurrences_projected=2,
        pooled_scale_cents=120000, seasonal_scale_cents=None,
        threshold_cents=threshold, first_breach_key=breach,
        opening_balance_cents=-220963, insufficient_reason=reason,
    )


def _empty(**overrides):
    """Every input at its "nothing to judge" value, so each test names only
    the one condition it is about."""
    base = dict(
        today=date(2026, 1, 9),
        coverage=OPERATOR_COVERAGE,
        balance=BalanceFloorInput(floor_cents=None, forecast=None),
        recurrences=[],
        budgets=BudgetInput(month_start=None, lines=()),
        anomalies=AnomalyInput(window=None, scored_groups=0, anomalies=()),
    )
    base.update(overrides)
    return base


def _condition(report, kind):
    return next(item for item in report.conditions if item.kind == kind)


# -- Coverage ---------------------------------------------------------------


def test_the_operators_eight_unimported_months_are_named_as_missing():
    assert OPERATOR_COVERAGE.first_on == date(2025, 1, 24)
    assert OPERATOR_COVERAGE.last_on == date(2026, 1, 9)
    assert OPERATOR_COVERAGE.missing_months == (
        "2025-04", "2025-05", "2025-06", "2025-07",
        "2025-08", "2025-09", "2025-10", "2025-11",
    )
    assert "2025-12" in OPERATOR_COVERAGE.covered_months
    assert "2025-06" not in OPERATOR_COVERAGE.covered_months


def test_an_empty_ledger_has_no_span_and_no_missing_months():
    coverage = measure_coverage([])
    assert coverage.first_on is None
    assert coverage.last_on is None
    assert coverage.covered_months == frozenset()
    assert coverage.missing_months == ()


def test_a_dense_ledger_reports_no_gap():
    coverage = measure_coverage([date(2025, 1, 5), date(2025, 2, 5), date(2025, 3, 5)])
    assert coverage.missing_months == ()


# -- The gap gate, which is the whole point ---------------------------------


def test_a_debit_expected_in_an_unimported_month_is_never_called_a_missed_payment():
    """The defect this module exists to prevent. June 2025 holds nothing, so a
    subscription "missing" there is a hole in the import -- and the sentence
    must name THAT cause, not a payment the household failed to make."""
    lapsed = _recurrence(
        first_on=date(2025, 3, 6), last_on=date(2025, 5, 6),
        expected_next_on=date(2025, 6, 5), occurrences=3,
    )
    report = evaluate_alerts(**_empty(recurrences=[lapsed]))

    assert [alert.kind for alert in report.alerts] == []
    missing = _condition(report, "missing_debit")
    assert len(missing.withheld) == 1
    withheld = missing.withheld[0]
    assert "juin 2025" in withheld
    assert "un mois que vos relevés ne couvrent pas" in withheld
    assert "un trou dans les données, pas un paiement manqué" in withheld
    # And none of the wording an actual missed payment would carry.
    assert "non constaté" not in withheld
    assert "étaient attendus" not in withheld


def test_a_debit_expected_after_the_last_imported_day_is_withheld_for_its_own_reason():
    """A second, different gap: the month IS covered, but the ledger stops
    before the expected date. Same refusal, a different cause and a different
    remedy -- collapsing the two would be the same defect one level down."""
    later = _recurrence(expected_next_on=date(2026, 1, 25))
    report = evaluate_alerts(**_empty(recurrences=[later]))

    assert report.alerts == []
    withheld = _condition(report, "missing_debit").withheld[0]
    assert "postérieur au 9 janvier 2026" in withheld
    assert "vos relevés ne couvrent pas" not in withheld


def test_a_debit_expected_inside_an_imported_month_does_fire():
    """The other half of the gate: without this, a module that refused
    everything would pass every test above for the wrong reason."""
    report = evaluate_alerts(**_empty(recurrences=[_recurrence()]))

    assert [alert.kind for alert in report.alerts] == ["missing_debit"]
    alert = report.alerts[0]
    assert "PRELEVEMENT SEPA FREE MOBILE" in alert.title
    assert "19,99 €" in alert.measured
    assert "4 janvier 2026" in alert.measured
    assert "janvier 2026 est couvert par vos relevés" in alert.period
    assert _condition(report, "missing_debit").withheld == ()


def test_a_rhythm_of_varying_amounts_is_not_a_scheduled_debit():
    """`detect_recurrences` groups by label alone and says so: `normalize_label`
    strips the card suffix, so a weekly pharmacy card spend is one flawlessly
    rhythmic key of wildly varying amounts. Its silence proves nothing, and
    calling it a missed payment is the wrong-cause defect one level up."""
    pharmacy = _recurrence(
        label_key="carte pharmacie centrale", label="CARTE X1234 PHARMACIE CENTRALE",
        periodicity="weekly", median_interval_days=7,
        amount_cents=-2197, amount_spread_cents=1200,
        first_on=date(2025, 12, 2), last_on=date(2025, 12, 27),
        expected_next_on=date(2026, 1, 3),
    )
    report = evaluate_alerts(**_empty(recurrences=[pharmacy]))

    assert report.alerts == []
    withheld = _condition(report, "missing_debit").withheld[0]
    assert "montants qui varient" in withheld
    assert "Un rythme n'est pas un prélèvement programmé" in withheld
    assert "paiement manqué" in withheld
    # And not the import-gap cause, which is a different problem entirely.
    assert "mois que vos relevés ne couvrent pas" not in withheld


def test_a_charge_that_never_moves_by_more_than_a_twentieth_is_still_one_price():
    """The gate must not swallow a real direct debit that rounds by a cent or
    two -- otherwise nothing would ever fire and every test above would pass
    for the wrong reason."""
    rounded = _recurrence(amount_cents=-1999, amount_spread_cents=50)
    report = evaluate_alerts(**_empty(recurrences=[rounded]))
    assert [alert.kind for alert in report.alerts] == ["missing_debit"]


def test_an_active_or_ended_recurrence_raises_no_missing_debit_alert():
    active = _recurrence(status="active", expected_next_on=date(2026, 1, 4))
    ended = _recurrence(status="ended", label_key="autre", label="AUTRE",
                        expected_next_on=date(2025, 12, 20))
    report = evaluate_alerts(**_empty(recurrences=[active, ended]))
    assert report.alerts == []
    assert _condition(report, "missing_debit").withheld == ()


# -- A threshold nobody set is not zero -------------------------------------


def test_no_stored_threshold_means_no_balance_alert_however_deep_the_projection():
    """`None` is never a fallback. A projection deep in the red raises nothing
    while no floor has been stored, and the condition says why."""
    months = [_forecast_month("2026-02", -900000, -400000, True)]
    report = evaluate_alerts(**_empty(
        balance=BalanceFloorInput(
            floor_cents=None, forecast=_forecast(months, breach="2026-02")
        ),
    ))

    assert report.alerts == []
    state = _condition(report, "balance_floor")
    assert state.measured is False
    assert "Un seuil absent n'est pas un seuil à 0 €" in state.detail


def test_a_threshold_stored_at_zero_is_a_real_threshold_and_does_fire():
    """Proves the test above is about *absence*, not about the number 0."""
    months = [
        _forecast_month("2026-02", 40000, 90000, False),
        _forecast_month("2026-03", -30000, 20000, True),
    ]
    report = evaluate_alerts(**_empty(
        balance=BalanceFloorInput(
            floor_cents=0, forecast=_forecast(months, breach="2026-03")
        ),
    ))

    assert [alert.kind for alert in report.alerts] == ["balance_floor"]
    alert = report.alerts[0]
    assert alert.severity == "critical"
    assert "mars 2026" in alert.title
    # The figure named is the one the engine actually tested: the P10.
    assert "pire dixième" in alert.measured
    assert "−300,00 €" in alert.measured
    assert "0,00 €" in alert.measured
    assert "février 2026 à mars 2026" in alert.period
    assert "seuil" in alert.clears_when


def test_a_projection_that_stays_above_the_stored_floor_is_measured_and_silent():
    months = [_forecast_month("2026-02", 40000, 90000, False)]
    report = evaluate_alerts(**_empty(
        balance=BalanceFloorInput(
            floor_cents=-100000, forecast=_forecast(months, threshold=-100000)
        ),
    ))
    assert report.alerts == []
    state = _condition(report, "balance_floor")
    assert state.measured is True
    assert state.alert_count == 0


def test_a_forecast_refusal_travels_through_unchanged():
    refusal = "Pas assez d'historique pour projeter : il faut au moins 6 mois complets."
    report = evaluate_alerts(**_empty(
        balance=BalanceFloorInput(
            floor_cents=0, forecast=_forecast([], reason=refusal)
        ),
    ))
    state = _condition(report, "balance_floor")
    assert state.measured is False
    assert state.detail == refusal


def test_a_stored_floor_with_no_forecast_at_all_is_refused_rather_than_guessed():
    """A ledger EXISTS (the operator's coverage) and no projection came with
    the floor: that is a caller bug, not a state to render, and inventing a
    "measured, nothing found" for it would hide it forever."""
    with pytest.raises(ValueError):
        evaluate_alerts(**_empty(
            balance=BalanceFloorInput(floor_cents=0, forecast=None)
        ))


def test_a_floor_stored_before_any_statement_says_so_in_its_own_words():
    """Its own sentence, because the cause is neither "no floor" nor "the
    ledger is too short": there is no ledger at all yet, and the remedy is to
    import a statement rather than to lengthen one."""
    report = evaluate_alerts(**_empty(
        coverage=measure_coverage([]),
        balance=BalanceFloorInput(floor_cents=-50000, forecast=None),
    ))
    state = _condition(report, "balance_floor")
    assert state.measured is False
    assert "−500,00 €" in state.detail
    assert "aucun relevé n'a encore été importé" in state.detail
    assert "Un seuil absent" not in state.detail


# -- Price rise -------------------------------------------------------------


def test_a_sustained_price_rise_names_both_levels_and_the_date_it_changed():
    risen = _recurrence(
        status="active",
        label_key="prelevement sepa spotify ab", label="PRELEVEMENT SEPA SPOTIFY AB",
        amount_cents=-1399, first_on=date(2025, 8, 4), last_on=date(2025, 12, 4),
        occurrences=5,
        price_change=PriceChange(
            previous_cents=-1199, current_cents=-1399,
            changed_on=date(2025, 11, 4), ratio=0.1668, occurrence_index=3,
        ),
    )
    report = evaluate_alerts(**_empty(recurrences=[risen]))

    assert [alert.kind for alert in report.alerts] == ["price_rise"]
    alert = report.alerts[0]
    assert "SPOTIFY" in alert.title
    assert "11,99 €" in alert.measured and "13,99 €" in alert.measured
    assert "+16,7 %" in alert.measured
    assert "5 prélèvements" in alert.measured
    assert "4 novembre 2025" in alert.period
    assert "11,99 €" in alert.clears_when


def test_a_price_FALL_is_not_an_alert():
    """A ratio is signed, and a subscription getting cheaper is not news the
    household needs woken for."""
    fallen = _recurrence(
        status="active",
        price_change=PriceChange(
            previous_cents=-1999, current_cents=-1499,
            changed_on=date(2025, 11, 4), ratio=-0.25, occurrence_index=2,
        ),
    )
    report = evaluate_alerts(**_empty(recurrences=[fallen]))
    assert [alert.kind for alert in report.alerts] == []
    assert _condition(report, "price_rise").measured is True


def test_a_price_rise_on_an_ENDED_subscription_is_not_an_alert():
    ended = _recurrence(
        status="ended",
        price_change=PriceChange(
            previous_cents=-1199, current_cents=-1399,
            changed_on=date(2025, 11, 4), ratio=0.1668, occurrence_index=3,
        ),
    )
    assert evaluate_alerts(**_empty(recurrences=[ended])).alerts == []


def test_with_no_recurrence_at_all_neither_recurrence_condition_is_measured():
    report = evaluate_alerts(**_empty())
    for kind in ("price_rise", "missing_debit"):
        state = _condition(report, kind)
        assert state.measured is False
        assert "Aucune récurrence" in state.detail


# -- Budgets ----------------------------------------------------------------


def _budget_subject(name: str, budget: int, spent: int, status: str) -> BudgetSubject:
    return BudgetSubject(
        category_name=name,
        line=BudgetLine(
            category_id=1, budget_cents=budget, spent_cents=spent,
            remaining_cents=budget + spent, consumed_ratio=-spent / budget,
            projected_cents=None, status=status,
        ),
    )


def test_a_crossed_budget_names_the_overrun_and_the_day_the_counter_resets():
    report = evaluate_alerts(**_empty(budgets=BudgetInput(
        month_start=date(2025, 12, 1),
        lines=(_budget_subject("Alimentation / Courses", 30000, -34240, "over"),),
    )))

    assert [alert.kind for alert in report.alerts] == ["budget_crossed"]
    alert = report.alerts[0]
    assert "Alimentation / Courses" in alert.title
    assert "342,40 €" in alert.measured
    assert "300,00 €" in alert.measured
    assert "42,40 €" in alert.measured
    assert "décembre 2025" in alert.period
    assert "1er janvier 2026" in alert.clears_when


def test_a_budget_merely_at_risk_is_not_a_crossed_budget():
    report = evaluate_alerts(**_empty(budgets=BudgetInput(
        month_start=date(2025, 12, 1),
        lines=(_budget_subject("Loisirs", 30000, -20000, "at_risk"),),
    )))
    assert report.alerts == []
    assert _condition(report, "budget_crossed").measured is True


def test_with_no_budget_declared_the_condition_is_not_measured():
    report = evaluate_alerts(**_empty())
    state = _condition(report, "budget_crossed")
    assert state.measured is False
    assert "Aucun budget mensuel n'est déclaré" in state.detail


# -- Anomalies --------------------------------------------------------------


def _anomaly_subject(amount: int, median: int) -> AnomalySubject:
    return AnomalySubject(
        anomaly=Anomaly(
            transaction_id=42, on=date(2025, 12, 22), amount_cents=amount,
            label="CARTE X1234 FNAC DARTY", category_id=9,
            category_median_cents=median, modified_z=5.8, direction="high",
        ),
        category_name="Achats / Équipement",
    )


def test_an_anomaly_names_the_amount_the_habit_and_the_gap_between_them():
    report = evaluate_alerts(**_empty(anomalies=AnomalyInput(
        window=(date(2025, 10, 11), date(2026, 1, 9)),
        scored_groups=4,
        anomalies=(_anomaly_subject(-23600, 4850),),
    )))

    assert [alert.kind for alert in report.alerts] == ["anomaly"]
    alert = report.alerts[0]
    assert "FNAC DARTY" in alert.title
    assert "236,00 €" in alert.measured
    assert "48,50 €" in alert.measured
    assert "187,50 €" in alert.measured
    assert "Achats / Équipement" in alert.measured
    assert "22 décembre 2025" in alert.period
    assert "11 octobre 2025 au 9 janvier 2026" in alert.period


def test_with_no_category_scored_the_anomaly_condition_is_not_measured():
    report = evaluate_alerts(**_empty(anomalies=AnomalyInput(
        window=(date(2025, 10, 11), date(2026, 1, 9)), scored_groups=0, anomalies=(),
    )))
    state = _condition(report, "anomaly")
    assert state.measured is False
    assert "assez d'historique" in state.detail


# -- The report as a whole --------------------------------------------------


def test_every_condition_appears_exactly_once_whatever_the_data():
    report = evaluate_alerts(**_empty())
    assert tuple(item.kind for item in report.conditions) == ALERT_KINDS


def test_the_import_gap_is_announced_once_at_the_top_of_the_report():
    report = evaluate_alerts(**_empty())
    assert report.notice is not None
    assert "8 mois" in report.notice
    assert "avril 2025" in report.notice and "novembre 2025" in report.notice
    assert "pas un événement" in report.notice


def test_a_gapless_ledger_carries_no_gap_notice():
    report = evaluate_alerts(**_empty(
        coverage=measure_coverage([date(2025, 11, 1), date(2025, 12, 1), date(2026, 1, 9)]),
    ))
    assert report.notice is None


def test_every_alert_says_what_was_measured_over_what_period_and_what_clears_it():
    report = evaluate_alerts(**_empty(
        balance=BalanceFloorInput(
            floor_cents=0,
            forecast=_forecast([_forecast_month("2026-03", -30000, 20000, True)],
                               breach="2026-03"),
        ),
        recurrences=[
            _recurrence(),
            _recurrence(
                status="active", label_key="spotify", label="SPOTIFY",
                price_change=PriceChange(
                    previous_cents=-1199, current_cents=-1399,
                    changed_on=date(2025, 11, 4), ratio=0.1668, occurrence_index=3,
                ),
            ),
        ],
        budgets=BudgetInput(
            month_start=date(2025, 12, 1),
            lines=(_budget_subject("Courses", 30000, -34240, "over"),),
        ),
        anomalies=AnomalyInput(
            window=(date(2025, 10, 11), date(2026, 1, 9)), scored_groups=4,
            anomalies=(_anomaly_subject(-23600, 4850),),
        ),
    ))

    assert {alert.kind for alert in report.alerts} == set(ALERT_KINDS)
    for alert in report.alerts:
        assert alert.title and alert.measured and alert.period and alert.clears_when
        assert alert.severity in ("critical", "warning", "info")
    # Five conditions, five distinct voices: no two of them may share a
    # sentence, which is how a wrong cause gets copied from one to the next.
    for field in ("title", "measured", "period", "clears_when"):
        values = [getattr(alert, field) for alert in report.alerts]
        assert len(set(values)) == len(values), field
    # Worst first: the reader opens this screen to find what is on fire.
    assert report.alerts[0].kind == "balance_floor"
    assert report.alerts[-1].kind == "anomaly"


def test_the_engine_reads_no_clock_of_its_own():
    """`today` is a parameter: the same inputs at two different "todays" differ
    only where a date is actually printed."""
    first = evaluate_alerts(**_empty(today=date(2026, 1, 9), recurrences=[_recurrence()]))
    second = evaluate_alerts(**_empty(today=date(2030, 5, 1), recurrences=[_recurrence()]))
    assert [alert.title for alert in first.alerts] == [
        alert.title for alert in second.alerts
    ]
