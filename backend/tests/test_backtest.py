"""engines/backtest: the Avenir method, replayed on the household's own history."""

import random
from datetime import date, timedelta

from app.engines.backtest import measure_reliability
from app.engines.outlook_sources import FlowRow

_ids = [0]


def _row(on, cents, label):
    _ids[0] += 1
    return FlowRow(id=_ids[0], on=on, amount_cents=cents, account_id=1, label_key=label.lower(),
                   label_raw=label, category_id=None, is_transfer=False)


def _household(months, variable):
    """A salary on the 28th, rent on the 5th, and one variable purchase a month
    whose amount `variable(index)` decides."""
    rows = []
    year, month = 2025, 1
    for index in range(months):
        rows.append(_row(date(year, month, 5), -90_000, "prlv loyer"))
        rows.append(_row(date(year, month, 15), variable(index), f"achat unique {index}"))
        rows.append(_row(date(year, month, 28), 250_000, "vir salaire"))
        month += 1
        if month == 13:
            year, month = year + 1, 1
    # (year, month) is now the month after the last one written.
    return rows, date(2025, 1, 1), date(year, month, 1) - timedelta(days=1)


def _measure(rows, start, end):
    return measure_reliability(rows, opening_balance_cents=100_000, dismissed_keys=frozenset(),
                               ledger_start=start, ledger_end=end)


def test_a_household_that_never_varies_is_forecast_exactly():
    rows, start, end = _household(18, lambda index: -30_000)
    reliability = _measure(rows, start, end)
    assert reliability.refusal is None
    one_month = next(score for score in reliability.horizons if score.horizon_months == 1)
    assert one_month.replays >= 3
    assert one_month.mean_abs_error_cents == 0
    assert one_month.bias_cents == 0
    assert one_month.inside_band == one_month.replays


def test_a_noisy_household_is_scored_on_every_replay():
    noise = random.Random(7)
    rows, start, end = _household(18, lambda index: -noise.randint(10_000, 60_000))
    reliability = _measure(rows, start, end)
    scores = {score.horizon_months: score for score in reliability.horizons}
    assert set(scores) == {1, 3}
    assert scores[1].replays > scores[3].replays
    assert scores[1].mean_abs_error_cents > 0
    assert scores[1].median_abs_error_cents > 0
    assert 0 <= scores[1].inside_band <= scores[1].replays


def test_a_short_history_refuses_and_counts_its_months():
    rows, start, end = _household(7, lambda index: -30_000 - index * 1_000)
    reliability = _measure(rows, start, end)
    assert reliability.horizons == []
    assert reliability.refusal == (
        "Il faut au moins 9 mois complets de relevés pour rejouer la prévision : "
        "vos relevés en comptent 7."
    )


def test_nothing_to_replay_on_an_empty_perimeter():
    reliability = measure_reliability([], opening_balance_cents=0, dismissed_keys=frozenset(),
                                      ledger_start=date(2026, 1, 1), ledger_end=date(2026, 1, 1))
    assert reliability.horizons == []
    assert "vos relevés en comptent 0" in reliability.refusal
