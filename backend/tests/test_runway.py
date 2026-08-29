from datetime import date

from app.engines.capacity import MonthlyEntry, complete_months
from app.engines.runway import compute_runway

TODAY = date(2026, 8, 12)
START = date(2025, 2, 1)
END = date(2025, 12, 31)


def _months(*totals: tuple[int, int, int]):
    """(year, month, outflow) -> observations."""
    entries = [MonthlyEntry(on=date(year, month, 5), amount_cents=amount)
               for year, month, amount in totals]
    return complete_months(entries, START, END)


def _run(count: int, amount: int):
    """`count` consecutive months from February 2025, all at one amount.

    START/END span February to December 2025, so eleven is the longest run
    `complete_months` will admit here. Used to build a ledger visibly longer
    than the essentials sample measured out of it.
    """
    return _months(*[(2025, 2 + i, amount) for i in range(count)])


# Any positive count will do wherever the essentials scenario is not the
# subject of the test: it only ever selects between "no category is marked
# essential" and "the months were measured", and every fixture below that is
# not about that distinction has essential months to measure.
SOME_ESSENTIAL_CATEGORIES = 21


def test_a_measured_burn_gives_a_month_count_and_a_depletion_date():
    months = _months((2025, 2, -100_000), (2025, 3, -100_000), (2025, 4, -100_000))
    report = compute_runway(600_000, months, months, TODAY,
                            essential_category_count=SOME_ESSENTIAL_CATEGORIES)
    assert report.normal is not None
    assert report.normal.monthly_burn_cents == 100_000
    assert report.normal.months == 6.0
    assert report.normal.depleted_on is not None
    assert report.normal.depleted_on > TODAY


def test_cutting_to_essentials_lengthens_the_runway():
    everything = _months((2025, 2, -200_000), (2025, 3, -200_000), (2025, 4, -200_000))
    essentials = _months((2025, 2, -100_000), (2025, 3, -100_000), (2025, 4, -100_000))
    report = compute_runway(600_000, everything, essentials, TODAY,
                            essential_category_count=SOME_ESSENTIAL_CATEGORIES)
    assert report.normal.months == 3.0
    assert report.essentials.months == 6.0
    assert report.essentials.depleted_on > report.normal.depleted_on


def test_two_months_of_history_measures_nothing_and_says_so():
    """The operator has three observed months. Two would be one interval short,
    and a runway quoted off two numbers is a guess with a decimal point."""
    months = _months((2025, 2, -100_000), (2025, 3, -100_000))
    report = compute_runway(600_000, months, months, TODAY,
                            essential_category_count=SOME_ESSENTIAL_CATEGORIES)
    assert report.normal is None
    assert report.essentials is None
    assert report.months_observed == 2
    # The WHOLE clause, not a "3 mois" substring: that substring comes out of
    # "il faut au moins 3 mois" and survives whatever number follows "n'en
    # compte que", which is exactly how the essentials sentence went on
    # quoting its own sample size as the ledger's for a whole phase.
    assert report.normal_unavailable_reason == (
        "Pas assez d'historique pour mesurer l'ensemble des dépenses : il faut au "
        "moins 3 mois complets de relevés, et l'historique n'en compte que 2."
    )
    # Here the two counts genuinely agree -- the essentials sample IS the whole
    # (two-month) ledger -- so the same sentence is true on both sides.
    assert report.essentials_unavailable_reason == (
        "Pas assez d'historique pour mesurer les dépenses essentielles : il faut au "
        "moins 3 mois complets de relevés, et l'historique n'en compte que 2."
    )


def test_the_observed_month_count_is_always_reported():
    """Three months is the floor, not comfort. The screen has to be able to say
    "mesuré sur 3 mois seulement"."""
    months = _months((2025, 2, -100_000), (2025, 3, -100_000), (2025, 4, -100_000))
    report = compute_runway(600_000, months, months, TODAY,
                            essential_category_count=SOME_ESSENTIAL_CATEGORIES)
    assert report.months_observed == 3


def test_an_empty_balance_is_zero_months_not_an_error():
    months = _months((2025, 2, -100_000), (2025, 3, -100_000), (2025, 4, -100_000))
    report = compute_runway(0, months, months, TODAY,
                            essential_category_count=SOME_ESSENTIAL_CATEGORIES)
    assert report.normal.months == 0.0
    assert report.normal.depleted_on == TODAY


def test_an_overdrawn_account_is_zero_months_not_a_negative_runway():
    months = _months((2025, 2, -100_000), (2025, 3, -100_000), (2025, 4, -100_000))
    report = compute_runway(-45_000, months, months, TODAY,
                            essential_category_count=SOME_ESSENTIAL_CATEGORIES)
    assert report.normal.months == 0.0


def test_a_household_that_spends_nothing_has_no_runway_to_quote():
    """Dividing by a zero burn is infinity. Reported as "not measurable" rather
    than as a very large number that would read as a promise."""
    months = _months((2025, 2, 100_000), (2025, 3, 100_000), (2025, 4, 100_000))
    report = compute_runway(600_000, months, months, TODAY,
                            essential_category_count=SOME_ESSENTIAL_CATEGORIES)
    assert report.normal is None
    # Three months WERE observed here -- the failure is that nothing was spent,
    # not that history is short. The message must name the actual cause and
    # must not claim a month-count shortfall it does not have -- the exact
    # self-contradiction the code review flagged: "il faut au moins 3 mois
    # ... et l'historique en compte 3", produced on this very branch before
    # the fix (3 months were observed, yet the message demanded 3 months).
    assert report.normal_unavailable_reason == (
        "Aucune autonomie mesurable pour l'ensemble des dépenses : sur les 3 mois "
        "complets de l'historique, la dépense médiane d'un mois est nulle, il n'y a "
        "donc aucune sortie d'argent à couvrir."
    )
    assert "il faut au moins" not in report.normal_unavailable_reason


def test_a_nil_median_expense_is_never_reported_as_a_healthy_net_balance():
    """The branch fires on `measure_expense_rate(...).median_cents <= 0` -- the
    median of `abs(outflow_cents)`, a GROSS expense rate. It said "Le solde net
    ... n'est pas déficitaire", which is a different quantity entirely: "Solde
    net" is the name of `CashflowChart`'s inflow-plus-outflow series in this
    same product.

    The old wording was only ever proven on an income-only fixture, where the
    net happens to be healthy too, so the false half was never exercised. Here
    the two diverge: two months of small inflow and one heavy outflow put the
    median month's spending at nil (the branch's real condition) while the net
    across the observed months is a 9 980 EUR deficit."""
    months = _months((2025, 2, 1_000), (2025, 3, 1_000), (2025, 4, -1_000_000))
    assert sum(month.net_cents for month in months) < 0
    report = compute_runway(600_000, months, months, TODAY,
                            essential_category_count=SOME_ESSENTIAL_CATEGORIES)
    assert report.normal is None
    assert report.normal_unavailable_reason == (
        "Aucune autonomie mesurable pour l'ensemble des dépenses : sur les 3 mois "
        "complets de l'historique, la dépense médiane d'un mois est nulle, il n'y a "
        "donc aucune sortie d'argent à couvrir."
    )
    # Neither the wrong quantity nor the claim made about it survives.
    assert "solde net" not in report.normal_unavailable_reason.lower()
    assert "déficitaire" not in report.normal_unavailable_reason


def test_an_unmeasurable_essentials_burn_names_its_own_sample_not_the_ledger():
    """Same sentence, essentials side, where the sample and the ledger differ.

    Eleven complete months in the ledger; three of them carry an essential row
    and all three of those rows are refunds, so the essentials median expense
    is nil. The refusal must not call three months "les 3 mois complets de
    l'historique" -- the ledger has eleven, and the screen prints that number
    six lines below."""
    all_months = _run(11, -100_000)
    essential_months = _months((2025, 2, 5_000), (2025, 3, 5_000), (2025, 4, 5_000))
    report = compute_runway(600_000, all_months, essential_months, TODAY,
                            essential_category_count=SOME_ESSENTIAL_CATEGORIES)
    assert report.months_observed == 11
    assert report.normal is not None
    assert report.essentials is None
    assert report.essentials_unavailable_reason == (
        "Aucune autonomie mesurable pour les dépenses essentielles : sur les 3 mois "
        "de l'historique qui portent ce type de dépense, la dépense médiane d'un mois "
        "est nulle, il n'y a donc aucune sortie d'argent à couvrir."
    )
    assert "3 mois complets" not in report.essentials_unavailable_reason


def test_essentials_gets_its_own_reason_when_only_it_is_unmeasurable():
    """`essentials` is measured over its own, self-selected set of months --
    it can fail on its own even when `normal` succeeds, and the screen needs
    a reason to display next to it rather than a blank next to a working
    `normal` scenario."""
    all_months = _months((2025, 2, -190_000), (2025, 3, -190_000), (2025, 4, -190_000))
    essential_months = _months((2025, 2, -80_000), (2025, 3, -80_000))  # only 2 months
    report = compute_runway(600_000, all_months, essential_months, TODAY,
                            essential_category_count=SOME_ESSENTIAL_CATEGORIES)
    assert report.normal is not None
    assert report.normal_unavailable_reason is None
    assert report.essentials is None
    # The whole clause. "3 mois" alone comes out of "il en faut au moins 3" and
    # would pass whichever count the sentence went on to blame.
    assert report.essentials_unavailable_reason == (
        "Pas assez de mois pour mesurer les dépenses essentielles : seuls 2 mois "
        "portent ce type de dépense sur les 3 mois complets de l'historique, et il "
        "en faut au moins 3."
    )


def test_the_essentials_refusal_never_attributes_its_sample_size_to_the_ledger():
    """B1. `essential_months` is built from a filtered entry list, so
    `complete_months` never emits a month with no essential row in it: its
    length is the count of months carrying essential spending, NOT the ledger's
    complete-month count.

    Quoting it as "l'historique n'en compte que 2" is a false claim about the
    ledger, and `CashflowPage` prints "dont 11 mois complets" six lines under
    this very sentence. Two numbers for one fact, on one screen -- the defect
    task 14 fixed in `forecast._reason_short_ledger`, live on this sibling
    engine until now."""
    all_months = _run(11, -100_000)
    essential_months = _months((2025, 2, -40_000), (2025, 3, -40_000))
    report = compute_runway(600_000, all_months, essential_months, TODAY,
                            essential_category_count=SOME_ESSENTIAL_CATEGORIES)

    assert report.months_observed == 11
    assert report.normal is not None  # the ledger is ample; only essentials fails
    assert report.essentials is None
    reason = report.essentials_unavailable_reason
    assert reason == (
        "Pas assez de mois pour mesurer les dépenses essentielles : seuls 2 mois "
        "portent ce type de dépense sur les 11 mois complets de l'historique, et il "
        "en faut au moins 3."
    )
    # The exact sentence the screen contradicted.
    assert "l'historique n'en compte que 2" not in reason
    # Whatever month count the refusal attributes to the ledger is the one the
    # report publishes, and the screen prints.
    assert f"{report.months_observed} mois complets de l'historique" in reason


def test_a_ledger_carrying_no_essential_spending_at_all_says_so():
    """Zero essential months out of a healthy ledger. The cause is not a short
    history -- eleven complete months are there -- so the sentence may not
    claim one."""
    report = compute_runway(600_000, _run(11, -100_000), [], TODAY,
                            essential_category_count=SOME_ESSENTIAL_CATEGORIES)
    assert report.essentials is None
    assert report.essentials_unavailable_reason == (
        "Pas assez de mois pour mesurer les dépenses essentielles : aucun mois ne "
        "porte ce type de dépense sur les 11 mois complets de l'historique, et il "
        "en faut au moins 3."
    )


def test_a_one_month_ledger_is_refused_in_grammatical_french():
    """Both singular forms, on one fixture. A month is the shortest ledger that
    still measures nothing, and "l'historique n'en compte que 1" / "sur les 1
    mois complets" are the sort of small wrongness this screen exists to avoid.
    Both halves are reachable in production: `normal` sees one month equal to
    the ledger, `essentials` sees none out of that one."""
    report = compute_runway(600_000, _run(1, -100_000), [], TODAY,
                            essential_category_count=SOME_ESSENTIAL_CATEGORIES)
    assert report.normal_unavailable_reason == (
        "Pas assez d'historique pour mesurer l'ensemble des dépenses : il faut au "
        "moins 3 mois complets de relevés, et l'historique n'en compte qu'un seul."
    )
    assert report.essentials_unavailable_reason == (
        "Pas assez de mois pour mesurer les dépenses essentielles : aucun mois ne "
        "porte ce type de dépense sur le seul mois complet de l'historique, et il "
        "en faut au moins 3."
    )


def test_no_category_marked_essential_is_not_a_short_history():
    """The worst of the old sentence's readings: with nothing flagged
    essential, `essential_months` is empty and the refusal read "il faut au
    moins 3 mois complets de relevés, et l'historique n'en compte que 0" beside
    a screen announcing eleven complete months. The number was wrong AND the
    stated cause was wrong -- nothing is short about the history.

    The replacement quotes no month count at all, because none is relevant: no
    length of history produces essential spending when no category is flagged
    essential. That also makes it structurally incapable of contradicting the
    scope sentence printed under it."""
    report = compute_runway(600_000, _run(11, -100_000), [], TODAY,
                            essential_category_count=0)
    assert report.normal is not None
    assert report.essentials is None
    reason = report.essentials_unavailable_reason
    assert reason == (
        "Ce scénario n'a aucune dépense à mesurer : aucune catégorie n'est marquée "
        "essentielle, et la longueur de l'historique n'y change rien."
    )
    assert not any(character.isdigit() for character in reason)
    # The Trésorerie cell's own note opens "Aucune catégorie n'est marquée
    # essentielle" on this exact state. Two paragraphs opening on one clause
    # read as the same sentence printed twice.
    assert not reason.startswith("Aucune catégorie")


def test_each_scenario_exposes_its_own_measured_rate_and_sample_size():
    """A screen wanting the band ("entre 5 et 7,5 mois") must not have to call
    `measure_expense_rate` a second time on the same months, and since
    `essentials` is measured over a different, self-selected set of months
    than `normal`, its own sample size has to be visible on the scenario
    itself rather than only on the report's single `months_observed`."""
    # Varied amounts, not constant ones: a constant sample has zero MAD by
    # construction (see robust.py), which would collapse low/median/high to
    # the same point and prove nothing about the band being exposed.
    all_months = _months((2025, 2, -90_000), (2025, 3, -100_000), (2025, 4, -110_000))
    essential_months = _months(
        (2025, 2, -45_000), (2025, 3, -50_000), (2025, 4, -50_000), (2025, 5, -55_000)
    )
    report = compute_runway(600_000, all_months, essential_months, TODAY,
                            essential_category_count=SOME_ESSENTIAL_CATEGORIES)
    assert report.normal.rate.months == 3
    band = report.normal.rate
    assert band.low_cents < band.median_cents < band.high_cents
    assert report.essentials.rate.months == 4
    assert report.essentials.rate.months != report.normal.rate.months


def test_an_improbably_long_runway_states_the_months_but_no_date():
    """1 000 years out, a calendar date is noise, and `date` overflows past
    year 9999 anyway."""
    months = _months((2025, 2, -100), (2025, 3, -100), (2025, 4, -100))
    report = compute_runway(10_000_000_00, months, months, TODAY,
                            essential_category_count=SOME_ESSENTIAL_CATEGORIES)
    assert report.normal.months > 600
    assert report.normal.depleted_on is None


def test_the_operators_own_numbers_produce_a_very_short_runway():
    """197 transactions netting +93 EUR against roughly 1 900 EUR a month out.
    The honest answer is "less than a month", and it must not round to zero
    silently or crash."""
    months = _months((2025, 2, -190_000), (2025, 3, -190_000), (2025, 4, -190_000))
    report = compute_runway(9_300, months, months, TODAY,
                            essential_category_count=SOME_ESSENTIAL_CATEGORIES)
    assert 0 < report.normal.months < 0.1
    assert report.normal.depleted_on is not None
