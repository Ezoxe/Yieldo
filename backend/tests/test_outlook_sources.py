"""engines/outlook_sources: what is known about the future, one euro one source."""

from datetime import date, timedelta

from app.engines.outlook_sources import (
    Declared,
    FlowRow,
    Planned,
    assemble,
    detected_dates,
    labels_match,
)
from app.engines.recurrence import Recurrence
from app.engines.schedule import DeclaredSchedule

AS_OF = date(2026, 8, 31)
START = date(2025, 9, 1)
END_OF_HORIZON = date(2026, 11, 30)

_next_id = [0]


def _row(on, cents, label, account=1, is_transfer=False, category=None):
    _next_id[0] += 1
    key = label.lower()
    return FlowRow(id=_next_id[0], on=on, amount_cents=cents, account_id=account,
                   label_key=key, label_raw=label, category_id=category,
                   is_transfer=is_transfer)


def _monthly(label, cents, day, months=12, account=1, is_transfer=False):
    rows = []
    year, month = 2025, 9
    for _ in range(months):
        rows.append(_row(date(year, month, day), cents, label, account, is_transfer))
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return rows


def _residual(months=12):
    """One distinct one-off purchase a month -- never a recurrence."""
    amounts = [-8000, -15000, -6000, -22000, -9500, -13000, -7000, -18000, -11000, -16000,
               -12000, -9000]
    rows = []
    year, month = 2025, 9
    for index in range(months):
        rows.append(_row(date(year, month, 12), amounts[index % 12], f"achat unique {index}"))
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return rows


def _assemble(rows, declared=(), planned=(), dismissed=frozenset()):
    return assemble(rows, dismissed_keys=dismissed, declared=list(declared),
                    planned=list(planned), as_of=AS_OF, horizon_end=END_OF_HORIZON,
                    ledger_start=START, ledger_end=AS_OF)


def _declared(id_, label, cents, periodicity, anchor, *, account=None, checkins=frozenset(),
              active=True):
    schedule = DeclaredSchedule(id=id_, label=label, amount_cents=cents, amount_is_variable=False,
                                periodicity=periodicity, anchor_on=anchor, ends_on=None,
                                active=active)
    return Declared(schedule=schedule, amount_cents=cents, account_id=account, category_id=None,
                    label_key=label.lower(), checkin_transaction_ids=frozenset(checkins))


# -- The perimeter --------------------------------------------------------------


def test_a_transfer_between_two_accounts_of_the_perimeter_cancels_out():
    rows = _residual() + _monthly("vir vers livret", -30000, 28, is_transfer=True) + _monthly(
        "vir depuis courant", 30000, 28, account=2, is_transfer=True)
    sources = _assemble(rows)
    assert not [event for event in sources.events if "livret" in event.label]
    assert not [event for event in sources.events if "courant" in event.label]


def test_money_leaving_the_perimeter_every_month_is_a_known_future_outflow():
    rows = _residual() + _monthly("vir vers pea", -20000, 2, is_transfer=True)
    sources = _assemble(rows)
    pea = [event for event in sources.events if event.label == "vir vers pea"]
    assert [event.on for event in pea] == [date(2026, 9, 2), date(2026, 10, 2), date(2026, 11, 2)]
    assert {event.amount_cents for event in pea} == {-20000}
    assert {event.source for event in pea} == {"detected"}


# -- One euro, one source ----------------------------------------------------------


def test_a_dismissed_label_is_not_projected_but_its_spending_stays_measured():
    rows = _residual() + _monthly("cb carrefour", -10000, 20)
    kept = _assemble(rows)
    dismissed = _assemble(rows, dismissed=frozenset({"cb carrefour"}))
    assert any(event.label == "cb carrefour" for event in kept.events)
    assert not any(event.label == "cb carrefour" for event in dismissed.events)
    kept_nets = [month.net_cents for month in kept.history.observations]
    dismissed_nets = [month.net_cents for month in dismissed.history.observations]
    assert dismissed_nets == [net - 10000 for net in kept_nets]


def test_a_declaration_replaces_the_detection_it_matches_by_amount_and_day():
    rows = _residual() + _monthly("prlv sepa foncia", -92000, 5)
    declared = _declared(1, "Loyer", -90000, "monthly", date(2025, 9, 6))
    sources = _assemble(rows, declared=[declared])
    rent = [event for event in sources.events if event.amount_cents in (-92000, -90000)]
    assert {event.series for event in rent} == {"declared:1"}
    assert sources.reconciled == 1
    assert sources.warnings == []


def test_a_declaration_matches_by_label_whatever_its_amount():
    rows = _residual() + _monthly("prlv sepa foncia", -92000, 5)
    declared = _declared(1, "FONCIA", -65000, "monthly", date(2025, 9, 20))
    sources = _assemble(rows, declared=[declared])
    assert not [event for event in sources.events if event.source == "detected"
                and event.label == "prlv sepa foncia"]
    assert sources.reconciled == 1


def test_one_detection_is_replaced_by_one_declaration_at_most():
    rows = _residual() + _monthly("prlv sepa foncia", -92000, 5)
    first = _declared(1, "Loyer", -91000, "monthly", date(2025, 9, 5))
    second = _declared(2, "Loyer bis", -92000, "monthly", date(2025, 9, 5))
    sources = _assemble(rows, declared=[first, second])
    assert sources.reconciled == 1


def test_an_unmatched_past_declaration_is_projected_with_a_warning():
    rows = _residual()
    declared = _declared(3, "Eau", -4500, "monthly", date(2025, 10, 15))
    sources = _assemble(rows, declared=[declared])
    assert any(event.series == "declared:3" for event in sources.events)
    assert sources.warnings == [
        "Aucune ligne de vos relevés ne correspond à « Eau » : si ce prélèvement figure "
        "déjà dans vos dépenses, il est compté deux fois. Donnez-lui le libellé du relevé."
    ]


def test_a_declaration_starting_in_the_future_needs_no_match():
    declared = _declared(4, "Crèche", -60000, "monthly", date(2026, 10, 1))
    sources = _assemble(_residual(), declared=[declared])
    assert sources.warnings == []
    assert [event.on for event in sources.events if event.series == "declared:4"] == [
        date(2026, 10, 1), date(2026, 11, 1)]


def test_rows_pointed_on_a_declaration_leave_the_residual():
    # Two bills: too few for the detector to call a rhythm, so only the
    # check-ins can say these rows belong to « Eau ».
    water = [_row(on, cents, "prlv veolia") for on, cents in (
        (date(2025, 10, 15), -9500), (date(2026, 1, 15), -15500))]
    rows = _residual() + water
    declared = _declared(5, "Eau", -9500, "quarterly", date(2025, 10, 15),
                         checkins={row.id for row in water})
    linked = _assemble(rows, declared=[declared])
    unlinked = _assemble(rows)
    assert linked.warnings == []
    linked_total = sum(month.net_cents for month in linked.history.observations)
    unlinked_total = sum(month.net_cents for month in unlinked.history.observations)
    assert linked_total == unlinked_total - sum(row.amount_cents for row in water)


def test_rows_whose_label_matches_a_declaration_leave_the_residual():
    water = [_row(date(2025, 10, 15), -9500, "prlv sepa veolia eau"),
             _row(date(2026, 1, 15), -9800, "prlv sepa veolia eau")]
    declared = _declared(6, "Veolia", -9600, "quarterly", date(2025, 10, 15))
    sources = _assemble(_residual() + water, declared=[declared])
    assert sources.warnings == []
    assert sources.reconciled == 0


# -- Dates -------------------------------------------------------------------------


def _recurrence(periodicity, last_on, expected_next_on, amount=-1000):
    return Recurrence(label_key="x", label="X", category_id=None, periodicity=periodicity,
                      occurrences=6, first_on=last_on - timedelta(days=150), last_on=last_on,
                      median_interval_days=30, amount_cents=amount, amount_spread_cents=0,
                      annual_cents=amount * 12, observed_span_days=150, annualisable=True,
                      expected_next_on=expected_next_on, status="active",
                      confidence="confirmed", price_change=None)


def test_a_monthly_charge_keeps_its_day_and_clamps_it_to_short_months():
    recurrence = _recurrence("monthly", date(2026, 1, 31), date(2026, 3, 2))
    assert detected_dates(recurrence, date(2026, 1, 31), date(2026, 5, 31)) == [
        date(2026, 3, 31), date(2026, 4, 30), date(2026, 5, 31)]


def test_quarterly_and_yearly_charges_step_in_calendar_months():
    quarterly = _recurrence("quarterly", date(2026, 7, 15), date(2026, 10, 14))
    yearly = _recurrence("yearly", date(2026, 3, 20), date(2027, 3, 20))
    assert detected_dates(quarterly, AS_OF, date(2027, 4, 30)) == [
        date(2026, 10, 15), date(2027, 1, 15), date(2027, 4, 15)]
    assert detected_dates(yearly, AS_OF, date(2027, 12, 31)) == [date(2027, 3, 20)]


def test_weekly_charges_step_in_days_and_nothing_falls_on_or_before_as_of():
    weekly = _recurrence("weekly", date(2026, 8, 28), date(2026, 8, 28))
    assert detected_dates(weekly, date(2026, 8, 28), date(2026, 9, 12)) == [
        date(2026, 9, 4), date(2026, 9, 11)]


def test_planned_events_inside_the_horizon_are_known_the_others_are_not():
    planned = [
        Planned(id=1, label="Impôt", on=date(2026, 9, 15), amount_cents=-31000,
                account_id=None, category_id=None),
        Planned(id=2, label="Passé", on=date(2026, 8, 1), amount_cents=-5000,
                account_id=None, category_id=None),
        Planned(id=3, label="Trop loin", on=date(2027, 6, 1), amount_cents=-5000,
                account_id=None, category_id=None),
    ]
    sources = _assemble(_residual(), planned=planned)
    assert [(event.label, event.source) for event in sources.events if event.source == "planned"] \
        == [("Impôt", "planned")]


def test_labels_match_as_substrings_of_four_characters_or_more():
    assert labels_match("foncia", "prlv sepa foncia loyer")
    assert labels_match("prlv sepa foncia loyer", "foncia")
    assert not labels_match("eau", "prlv bureau vallee")
    assert not labels_match("", "anything")


def test_the_series_list_names_what_a_scenario_can_cancel():
    rows = _residual() + _monthly("prlv netflix", -1599, 3)
    declared = _declared(7, "Crèche", -60000, "monthly", date(2026, 10, 1))
    sources = _assemble(rows, declared=[declared])
    ids = {series.id for series in sources.series}
    assert "declared:7" in ids
    assert "detected:prlv netflix" in ids
