from datetime import date

from app.engines.streak import ImportedTx, compute_streak

TODAY = date(2026, 1, 15)


def _tx(year: int, month: int, day: int, batch_id: int | None) -> ImportedTx:
    return ImportedTx(on=date(year, month, day), batch_id=batch_id)


def test_no_entries_at_all_says_the_habit_has_not_started():
    """`None` and an empty history for a household that has never used Yieldo,
    never a manufactured zero-length streak treated as if a ledger existed."""
    report = compute_streak([], TODAY)
    assert report.current == 0
    assert report.longest == 0
    assert report.last_complete_month is None
    assert report.months == []
    assert report.broken_reason == (
        "Aucun relevé n'a encore été importé : le suivi n'a pas commencé."
    )


def test_consecutive_imported_months_build_a_live_streak():
    """Three one-month batches, back to back, up to and including the current
    month -- the plain case, three months on and counting."""
    entries = [
        _tx(2025, 11, 5, batch_id=1), _tx(2025, 11, 20, batch_id=1),
        _tx(2025, 12, 3, batch_id=2),
        _tx(2026, 1, 9, batch_id=3),
    ]
    report = compute_streak(entries, TODAY)
    assert [m.key for m in report.months] == ["2025-11", "2025-12", "2026-01"]
    assert all(m.covered and m.imported for m in report.months)
    assert report.current == 3
    assert report.longest == 3
    assert report.last_complete_month == "2025-12"
    assert report.broken_reason is None


def test_a_gap_month_with_no_batch_nearby_is_never_imported_not_just_uncovered():
    """The operator's own shape: two separate one-month batches with a whole
    calendar month between them that neither batch's span reaches. A wrong
    implementation that only ever checks `transaction_count > 0` would call
    this month exactly the same "not covered" as an empty-but-spanned
    statement -- the engine must still say it was NEVER imported, distinctly,
    and the gap must cap the streak it would otherwise have built."""
    entries = [
        _tx(2025, 11, 10, batch_id=1),
        # December: nothing at all -- no batch's own span reaches it.
        _tx(2026, 1, 5, batch_id=2),
    ]
    report = compute_streak(entries, TODAY)
    by_key = {m.key: m for m in report.months}
    gap = by_key["2025-12"]
    assert gap.covered is False
    assert gap.transaction_count == 0
    assert gap.imported is False
    # Without the gap, November + December + January would run three long.
    # December was never imported, so the run resets there instead.
    assert report.longest == 1
    assert report.current == 1


def test_a_batch_spanning_a_quiet_month_marks_it_imported_and_empty_not_a_gap():
    """One batch whose rows run from January to March with nothing dated in
    February -- the statement genuinely spanned February (nothing happened
    that month), which is NOT the same fact as no statement ever reaching it.
    Distinguishes "imported and empty" from "never imported": behaviour a
    covered-only implementation cannot produce, since both cases look
    identical under `transaction_count == 0` alone."""
    entries = [
        _tx(2025, 1, 10, batch_id=1),
        # February: nothing, but batch 1's own span (Jan -> Mar) crosses it.
        _tx(2025, 3, 5, batch_id=1),
    ]
    report = compute_streak(entries, date(2025, 3, 20))
    by_key = {m.key: m for m in report.months}
    quiet = by_key["2025-02"]
    assert quiet.covered is False
    assert quiet.transaction_count == 0
    assert quiet.imported is True
    # The whole span counts toward the streak: nothing broke it.
    assert report.current == 3
    assert report.broken_reason is None


def test_the_current_month_never_breaks_a_streak_while_empty():
    """December was imported; January (the current month) has nothing in it
    yet. It is not over, so its emptiness is not a break -- the streak stays
    at 1, not 0, and no reason is manufactured for an unfinished month."""
    entries = [_tx(2025, 12, 5, batch_id=1)]
    report = compute_streak(entries, TODAY)  # TODAY = 2026-01-15
    by_key = {m.key: m for m in report.months}
    assert by_key["2026-01"].covered is False
    assert by_key["2026-01"].imported is False
    assert report.current == 1
    assert report.longest == 1
    assert report.broken_reason is None


def test_the_current_month_extends_the_streak_the_moment_it_has_activity():
    """A fresh import today shows up today: the current month need not be
    over to count, unlike every other month in the report."""
    entries = [_tx(2025, 12, 5, batch_id=1), _tx(2026, 1, 15, batch_id=2)]
    report = compute_streak(entries, TODAY)
    assert report.current == 2
    assert report.longest == 2


def test_the_longest_streak_can_exceed_the_current_one():
    """Five months on, then a two-month gap, then the current, freshly-started
    month. `longest` must still report the five-month run even though the
    live streak is only 1."""
    entries = [
        _tx(2025, 6, 5, batch_id=1), _tx(2025, 7, 5, batch_id=2),
        _tx(2025, 8, 5, batch_id=3), _tx(2025, 9, 5, batch_id=4),
        _tx(2025, 10, 5, batch_id=5),
        # November and December: a genuine gap, no batch nearby.
        _tx(2026, 1, 5, batch_id=6),
    ]
    report = compute_streak(entries, TODAY)
    assert report.longest == 5
    assert report.current == 1
    assert report.broken_reason is None


def test_last_complete_month_excludes_the_still_open_current_month():
    """`last_complete_month` names the most recent FINISHED month, never the
    one still in progress -- even when that one already has activity."""
    entries = [_tx(2025, 11, 5, batch_id=1), _tx(2026, 1, 3, batch_id=2)]
    report = compute_streak(entries, TODAY)
    assert report.last_complete_month == "2025-11"


def test_last_complete_month_is_none_when_the_ledger_is_only_this_month_old():
    entries = [_tx(2026, 1, 9, batch_id=1)]
    report = compute_streak(entries, TODAY)
    assert report.last_complete_month is None
    assert report.current == 1


def test_a_single_unimported_month_is_worded_in_the_singular():
    entries = [_tx(2025, 11, 5, batch_id=1)]
    report = compute_streak(entries, TODAY)  # December is the sole gap month
    by_key = {m.key: m for m in report.months}
    assert by_key["2025-12"].imported is False
    assert report.current == 0
    assert report.broken_reason == (
        "Le suivi s'est interrompu : cela fait un mois qu'aucun relevé n'a été "
        "importé."
    )


def test_a_gap_of_several_months_is_counted_and_named():
    """A single batch touches only September 2025; nothing since. By mid
    January, October, November and December have each gone unimported --
    three whole months -- and the reason must count exactly that, not the
    ledger's whole length."""
    entries = [_tx(2025, 9, 5, batch_id=1)]
    report = compute_streak(entries, TODAY)  # TODAY = 2026-01-15
    by_key = {m.key: m for m in report.months}
    assert by_key["2026-01"].imported is False  # current month, still empty
    assert report.current == 0
    assert report.broken_reason == (
        "Le suivi s'est interrompu : cela fait 3 mois qu'aucun relevé n'a été "
        "importé."
    )


def test_manual_entries_with_no_batch_still_cover_their_month():
    """A row with `batch_id=None` -- no CSV import behind it -- still counts
    as a real transaction for `covered`/`transaction_count`, but establishes
    no import span of its own for any other month."""
    entries = [_tx(2025, 12, 1, batch_id=None)]
    report = compute_streak(entries, date(2025, 12, 20))
    [month] = report.months
    assert month.key == "2025-12"
    assert month.covered is True
    assert month.transaction_count == 1
    assert month.imported is True


def test_transaction_count_is_reported_per_month_not_just_a_flag():
    entries = [_tx(2026, 1, 3, batch_id=1), _tx(2026, 1, 4, batch_id=1),
               _tx(2026, 1, 20, batch_id=1)]
    report = compute_streak(entries, TODAY)
    [month] = report.months
    assert month.transaction_count == 3


def test_the_operators_own_shape_eight_gap_months_none_imported_and_empty():
    """One-month batches in January, May, September and December of 2025, plus
    January 2026 -- eight calendar months in between with no batch and no
    transaction anywhere near them, exactly the operator's own count. Every
    one of those eight must be `imported=False` ("never imported"); none may
    be `imported=True` with `covered=False` ("imported and empty") -- his
    ledger has none of the second kind, because his statements never straddle
    a gap."""
    covered_months = [1, 5, 9, 12]
    entries = [_tx(2025, month, 15, batch_id=month) for month in covered_months]
    entries.append(_tx(2026, 1, 9, batch_id=100))
    report = compute_streak(entries, date(2026, 1, 20))
    gap_keys = {f"2025-{m:02d}" for m in range(1, 13) if m not in covered_months}
    assert len(gap_keys) == 8
    by_key = {m.key: m for m in report.months}
    for key in gap_keys:
        assert by_key[key].covered is False
        assert by_key[key].imported is False, f"{key} must be never-imported, not imported-empty"
