from datetime import date

from app.engines.period import resolve_range

TODAY = date(2026, 8, 12)
EARLIEST = date(2025, 1, 24)
LATEST = date(2026, 1, 9)


def test_absent_bounds_cover_the_whole_history():
    """"Tout" sends no bounds at all. It has to mean all of this user's history,
    not the current calendar year."""
    assert resolve_range(None, None, EARLIEST, LATEST, TODAY) == (EARLIEST, LATEST)


def test_absent_bounds_without_any_history_fall_back_to_today():
    assert resolve_range(None, None, None, None, TODAY) == (TODAY, TODAY)


def test_a_future_dated_transaction_is_never_cut_off():
    future = date(2027, 3, 1)
    assert resolve_range(None, None, EARLIEST, future, TODAY) == (EARLIEST, future)


def test_explicit_bounds_are_never_overridden():
    asked = (date(2026, 1, 1), date(2026, 1, 31))
    assert resolve_range(*asked, EARLIEST, LATEST, TODAY) == asked


def test_an_explicit_start_defaults_its_end_to_the_end_of_the_history():
    assert resolve_range(date(2025, 6, 1), None, EARLIEST, LATEST, TODAY) == (
        date(2025, 6, 1), LATEST,
    )


def test_an_explicit_end_before_the_history_does_not_invert_the_range():
    start, end = resolve_range(None, date(2024, 6, 30), EARLIEST, LATEST, TODAY)
    assert start <= end
    assert end == date(2024, 6, 30)


def test_an_explicit_start_after_the_history_does_not_invert_the_range():
    start, end = resolve_range(date(2027, 1, 1), None, EARLIEST, LATEST, TODAY)
    assert start <= end
    assert start == date(2027, 1, 1)
