from datetime import date, timedelta

from app.engines.anomaly import MIN_HISTORY, AnomalyTx, detect_anomalies

WINDOW_START = date(2025, 1, 1)
WINDOW_END = date(2026, 12, 31)


def _rows(category_id: int, amounts: list[int], start: date = date(2025, 1, 1)):
    return [
        AnomalyTx(id=index + 1, on=start + timedelta(days=index * 3),
                  amount_cents=amount, label=f"ACHAT {index}", category_id=category_id)
        for index, amount in enumerate(amounts)
    ]


def _renumber(rows: list[AnomalyTx], offset: int) -> list[AnomalyTx]:
    """Distinct transaction ids across concatenated blocks, the way a real
    ledger has them -- `_rows` numbers every block from 1."""
    return [
        AnomalyTx(id=row.id + offset, on=row.on, amount_cents=row.amount_cents,
                  label=row.label, category_id=row.category_id)
        for row in rows
    ]


def test_an_expense_far_beyond_the_categorys_habit_is_flagged():
    rows = _rows(1, [-4000] * 11 + [-90000])
    report = detect_anomalies(rows, WINDOW_START, WINDOW_END)
    assert [a.amount_cents for a in report.anomalies] == [-90000]
    assert report.anomalies[0].direction == "high"
    assert report.anomalies[0].category_median_cents == 4000


def test_an_ordinary_expense_is_not_flagged():
    rows = _rows(1, [-4000, -4200, -3900, -4100, -4050, -3950, -4150, -4000, -4300, -3800])
    assert detect_anomalies(rows, WINDOW_START, WINDOW_END).anomalies == []


def test_one_extreme_value_does_not_hide_the_next_one():
    """The median and MAD are computed over the whole history including the
    outliers; that is the point of using them. A mean and a standard deviation
    would be dragged out far enough to swallow the second."""
    rows = _rows(1, [-4000] * 10 + [-90000, -95000])
    report = detect_anomalies(rows, WINDOW_START, WINDOW_END)
    assert len(report.anomalies) == 2


def test_a_category_with_too_short_a_history_is_skipped_not_guessed():
    """The operator has 19 categories in use over 197 rows -- several sit under
    ten observations, and a MAD computed on four points is arithmetic, not
    statistics."""
    rows = _rows(1, [-4000] * 8 + [-90000])
    report = detect_anomalies(rows, WINDOW_START, WINDOW_END)
    assert report.anomalies == []
    assert len(report.skipped) == 1
    assert report.skipped[0].observations == 9
    assert "10" in report.skipped[0].reason
    assert MIN_HISTORY == 10


def test_a_category_whose_amount_never_varies_yields_no_anomaly():
    """Twelve identical charges carry no scale. Any value would be infinitely
    far from the centre, which is not a finding: `modified_z` returns `None`
    when both `mad` and `mean_ad` are 0 (`robust.describe`), and this engine's
    decision is to treat that `None` as "cannot say", never as an invented
    zero standing in for a real score."""
    rows = _rows(1, [-1549] * 12)
    report = detect_anomalies(rows, WINDOW_START, WINDOW_END)
    assert report.anomalies == []


def test_a_single_different_charge_among_identical_ones_is_still_caught():
    """MAD is zero here, so scoring falls back to the mean absolute deviation --
    the documented alternative, not an invented rule. This is the flip side of
    the previous test: eleven identical charges give a real (zero) scale, and
    the twelfth, different one is measured against it rather than waved
    through because the primary statistic degenerated."""
    rows = _rows(1, [-1549] * 11 + [-9999])
    report = detect_anomalies(rows, WINDOW_START, WINDOW_END)
    assert [a.amount_cents for a in report.anomalies] == [-9999]


def test_income_and_expenses_are_scored_separately():
    """A 2 200 EUR salary is not an anomalous grocery run. Grouping by sign
    keeps a category holding both from flagging every one of them.

    NOTE ON THE FIXTURE: the plan's own version of this test used eleven
    identical expenses plus one differing by 200 cents, in both the expense
    and the income block -- the same "one value differs, the rest are
    identical" shape that `test_a_single_different_charge_among_identical_
    ones_is_still_caught` deliberately exploits. With fewer than half a
    sample differing from its mode, MAD is 0 and the mean-absolute-deviation
    fallback flags almost any nonzero difference, however small: with n-1
    identical values the score is roughly `n / MODIFIED_Z_MEAN_AD_CONSTANT`
    regardless of the differing value's actual size. Checked directly against
    `robust.describe`/`modified_z`: the plan's expense block scores |z| ~=
    9.39 and its income block ~= 9.57, each on its OWN, correctly-separated
    group -- so that fixture could never have produced an empty
    `report.anomalies`, even from a correct implementation. This is the same
    class of self-contradictory brief fixture flagged in tasks 11 and 15.

    This fixture reuses the ten-value spread already proven ordinary by
    `test_an_ordinary_expense_is_not_flagged` for the expense side -- TWICE
    over, twenty rows -- and scales it by -55 for ten income rows (same
    shape, flipped sign, proportionally larger). The modified z-score is
    scale invariant, so if the expense spread does not cross the outlier
    threshold on its own, the proportionally identical income spread cannot
    either.

    The 20-vs-10 imbalance is deliberate, not incidental: an EQUAL split
    (ten and ten) turns out to pool into a harmless bimodal distribution
    even when sign-grouping is silently broken -- checked directly against
    `robust.describe`, a 10-and-10 pool lands its median between the two
    clusters and its MAD balloons wide enough to explain both, so nothing
    crosses the threshold either way and a grouping bug would slip past this
    test unnoticed. With expenses in the majority (20 of 30 rows), a pooled
    median sits inside the expense cluster and every income row becomes a
    huge, MAD-dwarfing deviation from it -- verified: pooling this exact
    fixture flags all ten income rows at |z| ~= 690-784. Grouped correctly by
    sign, as this engine does, neither side ever reaches that pooled centre
    in the first place.
    """
    expense_amounts = (
        [-4000, -4200, -3900, -4100, -4050, -3950, -4150, -4000, -4300, -3800] * 2
    )
    income_amounts = [amount * -55 for amount in expense_amounts[:10]]
    expenses = _rows(1, expense_amounts)
    incomes = [
        AnomalyTx(id=index + 101, on=date(2025, 6, 1) + timedelta(days=index * 3),
                  amount_cents=amount, label=f"SALAIRE {index}", category_id=1)
        for index, amount in enumerate(income_amounts)
    ]
    report = detect_anomalies(expenses + incomes, WINDOW_START, WINDOW_END)
    assert report.anomalies == []


def test_a_zero_amount_row_counts_as_income_not_expense():
    """Pins the sign convention this module documents but does not spell out
    inline: `sign = "expense" if row.amount_cents < 0 else "income"` routes
    exactly-zero amounts to "income", the same `>= 0` boundary
    `aggregate.aggregate_by_category` uses to decide what is NOT a spend
    (`app/engines/aggregate.py:157-158`). Under nine rows, this group is
    skipped rather than scored -- but which sign it was skipped AS is exactly
    the fact this test locks down."""
    rows = _rows(1, [0] * 9)
    report = detect_anomalies(rows, WINDOW_START, WINDOW_END)
    assert len(report.skipped) == 1
    assert report.skipped[0].direction == "income"


def test_the_outlier_cutoff_excludes_its_own_boundary():
    """Iglewicz & Hoaglin's 3.5 is a "beyond this" cutoff (`robust.py`'s own
    comment: "A value beyond this is an outlier"), so a modified z-score of
    EXACTLY 3.5 must not be reported, and a score fractionally past it must.
    Both fixtures below were constructed and independently checked directly
    against `robust.describe`/`modified_z` to land on exactly these two
    z-scores (3.5 and 3.5005) -- not approximated, so this test can
    distinguish `<=` from `<` at the threshold, which no other test here
    forces.
    """
    base = [97000, 98000, 98500, 98651, 98800, 100000, 100500, 100800, 101000, 101349]

    at_boundary = _rows(1, [-value for value in base + [107000]])
    report = detect_anomalies(at_boundary, WINDOW_START, WINDOW_END)
    assert report.anomalies == []

    just_past = _rows(2, [-value for value in base + [107001]], start=date(2025, 2, 1))
    report = detect_anomalies(just_past, WINDOW_START, WINDOW_END)
    assert [a.amount_cents for a in report.anomalies] == [-107001]


def test_an_unusually_small_charge_is_reported_as_low():
    rows = _rows(1, [-40000] * 11 + [-100])
    report = detect_anomalies(rows, WINDOW_START, WINDOW_END)
    assert report.anomalies[0].direction == "low"


def test_only_anomalies_inside_the_window_are_reported():
    """Scored against the whole history, reported for the period on screen. A
    period filter that also narrowed the history would rescore every category
    against a handful of rows."""
    rows = _rows(1, [-4000] * 11 + [-90000], start=date(2025, 1, 1))
    late = rows[-1]
    report = detect_anomalies(rows, date(2026, 1, 1), date(2026, 12, 31))
    assert report.anomalies == []
    assert late.on < date(2026, 1, 1)


def test_the_biggest_deviation_comes_first():
    rows = _rows(1, [-4000] * 10 + [-60000, -90000])
    report = detect_anomalies(rows, WINDOW_START, WINDOW_END)
    assert len(report.anomalies) == 2
    assert report.anomalies[0].amount_cents == -90000
    assert abs(report.anomalies[0].modified_z) >= abs(report.anomalies[1].modified_z)


def test_uncategorized_rows_are_not_scored_against_each_other():
    """"Non catégorisé" is not a category: its rows have nothing in common, and
    a median over them describes nothing."""
    rows = [
        AnomalyTx(id=index + 1, on=date(2025, 1, 1) + timedelta(days=index),
                  amount_cents=amount, label="X", category_id=None)
        for index, amount in enumerate([-4000] * 11 + [-90000])
    ]
    report = detect_anomalies(rows, WINDOW_START, WINDOW_END)
    assert report.anomalies == []


def test_an_empty_history_is_an_empty_report_not_a_crash():
    report = detect_anomalies([], WINDOW_START, WINDOW_END)
    assert report.anomalies == []
    assert report.skipped == []
    assert report.scored_groups == 0


def test_the_operators_data_shape_leaves_some_categories_scored_and_others_skipped():
    """19 categories, roughly ten rows each -- the plan's own table predicts
    this comes out mixed on the operator's ledger (2026-08-16 phase 2A plan,
    Lot E overview row: "Anomalies | >=10 observations in the category | 19
    categories, ~10 rows each | mixed -- some scored, some skipped"). Four
    categories here stand in for that shape: two land at or above the
    threshold and get scored (one produces a finding, one does not), two land
    under it and are skipped, each with its own true count in its reason.
    """
    scored_with_outlier = _renumber(_rows(1, [-4000] * 11 + [-90000]), 0)
    scored_ordinary = _renumber(
        _rows(2, [-4000, -4200, -3900, -4100, -4050, -3950, -4150, -4000, -4300, -3800],
              start=date(2025, 2, 1)),
        100,
    )
    skipped_nine = _renumber(_rows(3, [-4000] * 8 + [-90000], start=date(2025, 3, 1)), 200)
    skipped_five = _renumber(_rows(4, [-4000] * 5, start=date(2025, 4, 1)), 300)

    history = scored_with_outlier + scored_ordinary + skipped_nine + skipped_five
    report = detect_anomalies(history, WINDOW_START, WINDOW_END)

    assert report.scored_groups == 2
    assert [a.category_id for a in report.anomalies] == [1]

    skipped_by_category = {row.category_id: row for row in report.skipped}
    assert set(skipped_by_category) == {3, 4}
    assert skipped_by_category[3].observations == 9
    assert skipped_by_category[4].observations == 5
    # Each skipped category's own true count appears in its own reason -- a
    # category with 5 rows must not be told it has 9, or vice versa.
    assert "9" in skipped_by_category[3].reason
    assert "5" in skipped_by_category[4].reason
    assert f"{MIN_HISTORY}" in skipped_by_category[3].reason
    assert f"{MIN_HISTORY}" in skipped_by_category[4].reason


def test_an_annual_premium_among_monthly_charges_is_flagged():
    """Self-review case, not an oversight. An annual insurance premium living
    in the same category as eleven ordinary monthly payments IS a statistical
    outlier against that category's own history -- eleven identical values
    and one that differs is exactly the shape
    `test_a_single_different_charge_among_identical_ones_is_still_caught`
    exercises. The engine has no way to know the twelfth row is "explicable"
    rather than "wrong": that knowledge lives in how the ledger is
    categorised (an annual premium belongs in its own category, or its own
    label pattern excluded from this one), not in this pure function.
    Inventing a size-based or frequency-based exemption here would be exactly
    the arbitrary threshold the design spec rules out. Recorded as a decision,
    not silently accepted."""
    monthly_premium = -8000
    annual_premium = -96000
    rows = _rows(1, [monthly_premium] * 11 + [annual_premium])
    report = detect_anomalies(rows, WINDOW_START, WINDOW_END)
    assert [a.amount_cents for a in report.anomalies] == [annual_premium]


def test_raw_modified_z_would_misrank_this_but_the_report_does_not():
    """Review round 1 finding: raw `modified_z` is not safe to compare across
    categories whenever a group's MAD is 0 (the mean-absolute-deviation
    fallback) -- checked directly against `robust.describe`/`modified_z`
    before writing this fixture. A 15-cent repricing inside a 30-row,
    entirely-fixed-amount subscription category scores z ~= 11.97; an 860 EUR
    grocery spike inside a 12-row category scores only z ~= 9.57 -- HIGHER
    for the fifteen-cent change, because in the "n-1 identical, one
    different" shape the mean-AD fallback's score works out to approximately
    `group_size / MODIFIED_Z_MEAN_AD_CONSTANT`, independent of how large the
    differing value actually is. Sorted by raw z, the fifteen-cent change
    would sit at the top of the feed, above the grocery spike. `anomalies`
    ranks by absolute cents moved instead (review round 2 -- see
    `test_the_ranking_metric_is_absolute_cents_across_three_categories` for
    why a relative/ratio metric was tried and rejected too), which is not
    fooled by group size any more than by a small denominator."""
    tiny_reprice = _rows(1, [-1549] * 29 + [-1564])
    big_spike = _renumber(_rows(2, [-4000] * 11 + [-90000], start=date(2025, 2, 1)), 100)
    report = detect_anomalies(tiny_reprice + big_spike, WINDOW_START, WINDOW_END)

    by_category = {a.category_id: a for a in report.anomalies}
    # Raw z ranks them the OTHER way -- pinning this so the ranking fix isn't
    # accidentally validated by a fixture where both metrics happen to agree.
    assert by_category[1].modified_z > by_category[2].modified_z
    # But the report puts the real spike first: 86 000 cents moved beats 15.
    assert [a.category_id for a in report.anomalies] == [2, 1]


def test_a_category_whose_median_is_zero_still_ranks_by_cents_moved():
    """A category built almost entirely of zero-amount rows has a median of
    0 -- reachable whenever at least half the group's magnitudes are 0 (the
    even/odd split in `robust.median_cents` lands on the zero side). Zero
    counts as "income" under this module's sign convention, so the eleven
    zero rows and the one large row must share that sign to land in the same
    group -- an income category that is usually a no-op and then, once,
    isn't (e.g. a cashback or interest line that is normally 0,00 EUR).
    Absolute cents has no denominator for this to destabilise (unlike the
    relative-ratio metric review round 2 rejected): 50 000 cents moved here
    against 85 950 in the other category, so THIS one ranks second, plainly,
    with no special-casing required."""
    zero_heavy = _rows(1, [0] * 11 + [50000])
    ordinary_with_outlier = _renumber(
        _rows(2, [-4000, -4200, -3900, -4100, -4050, -3950, -4150, -4000, -4300, -3800,
                  -90000], start=date(2025, 2, 1)),
        100,
    )
    report = detect_anomalies(zero_heavy + ordinary_with_outlier, WINDOW_START, WINDOW_END)
    assert len(report.anomalies) == 2
    assert [a.category_id for a in report.anomalies] == [2, 1]
    by_category = {a.category_id: a for a in report.anomalies}
    assert by_category[1].category_median_cents == 0


def test_a_low_anomaly_ranks_by_the_size_of_its_gap_not_its_sign():
    """`_deviation_cents` takes `abs()` of the difference so a "low" anomaly
    (magnitude below the median, a negative `value - median`) doesn't rank
    as if it were LESS unusual than a "high" one just because its raw
    difference is negative. This category's charge collapses to 100 cents
    against a 40 000-cent median -- a 39 900-cent gap, the largest of the
    two -- while the other category's charge is only 400 cents away from its
    own median. The bigger gap must rank first regardless of direction."""
    barely_anything = _rows(1, [-40000] * 11 + [-100])
    slightly_more = _renumber(_rows(2, [-4000] * 11 + [-4400], start=date(2025, 2, 1)), 100)
    report = detect_anomalies(barely_anything + slightly_more, WINDOW_START, WINDOW_END)
    assert [a.category_id for a in report.anomalies] == [1, 2]
    assert report.anomalies[0].direction == "low"
    assert report.anomalies[1].direction == "high"


def test_the_ranking_metric_is_absolute_cents_across_three_categories():
    """Coordinator ruling, review round 2: the round-1 fix (relative
    deviation from the category's own median) just relocated the
    instability from a degenerate `modified_z` to a degenerate ratio -- a
    1-cent-baseline category dividing by its own tiny median explodes past a
    genuine 860 EUR spike's ratio. Checked directly against
    `robust.describe`/`modified_z` before writing this fixture:

    - 1-cent baseline, one 5,00 EUR (500 cent) charge: median=1, z~=8.85,
      the OLD relative ratio = 499/1 = 499.0 -- would rank ABOVE the real
      spike.
    - 50-cent baseline, one 50,00 EUR (5 000 cent) charge: median=50,
      z~=8.78, OLD ratio = 4 950/50 = 99.0 -- also above the real spike.
    - the `big_spike` fixture, an 860 EUR charge against a 40 EUR median:
      z~=9.57, OLD ratio = 86 000/4 000 = 21.5 -- would rank LAST of the
      three despite moving the most real money.

    `modified_z` still decides WHETHER a row qualifies at all -- that stays
    the robust, category-relative, no-arbitrary-threshold gate, unchanged.
    Ranking among qualifying rows is by absolute cents moved, which has no
    denominator for the data to destabilise: three different baselines, one
    report, ordered strictly by euros, most first."""
    tiny_baseline = _rows(1, [-1] * 10 + [-500])
    mid_baseline = _renumber(_rows(2, [-50] * 10 + [-5000], start=date(2025, 2, 1)), 100)
    big_spike = _renumber(_rows(3, [-4000] * 11 + [-90000], start=date(2025, 3, 1)), 200)

    report = detect_anomalies(tiny_baseline + mid_baseline + big_spike, WINDOW_START, WINDOW_END)
    assert [a.category_id for a in report.anomalies] == [3, 2, 1]


def test_the_skip_reason_names_the_sign_groups_own_count_not_the_categorys():
    """Review round 1 finding: a category with eleven ordinary expenses and
    one refund is entirely routine -- refunds landing in an expense category
    are normal. The old wording said "il faut au moins 10 opérations dans
    cette catégorie ... et celle-ci en compte {n}" where `n` was the SIGN
    GROUP's count, not the category's: this category holds twelve
    transactions and is simultaneously counted as scored (its expense side),
    while its skip reason claimed the category "en compte 1" -- true only of
    the one-row income side. The reason must name the sign group `direction`
    already carries."""
    expenses = _rows(1, [-4000] * 11)
    refund = [AnomalyTx(id=101, on=date(2025, 6, 1), amount_cents=4000,
                         label="REMBOURSEMENT", category_id=1)]
    report = detect_anomalies(expenses + refund, WINDOW_START, WINDOW_END)

    assert report.scored_groups == 1
    assert len(report.skipped) == 1
    skip = report.skipped[0]
    assert skip.category_id == 1
    assert skip.direction == "income"
    assert skip.observations == 1
    # Names the income side specifically -- not "dépense", and not a bare
    # claim about "cette catégorie" that would read as the whole category.
    assert "recette" in skip.reason
    assert "dépense" not in skip.reason


def test_a_category_entirely_outside_the_window_is_neither_scored_nor_skipped():
    """Review round 1 finding: with every row dated 2024 and the window set
    to 2026, the engine used to return `scored_groups=1, skipped=1,
    anomalies=0` -- a category with zero transactions in the displayed
    period still counted as "analysed" or "ignorée". Decision: `scored_
    groups` and `skipped` are scoped to the window exactly like `anomalies`
    is. The underlying statistics (median, MAD, the MIN_HISTORY gate) still
    read the category's WHOLE history -- only whether a group is reported at
    all, in either list, now depends on it having at least one transaction
    inside [window_start, window_end]."""
    rows = _rows(1, [-4000] * 8 + [-90000], start=date(2024, 1, 1))
    report = detect_anomalies(rows, date(2026, 1, 1), date(2026, 12, 31))
    assert report.anomalies == []
    assert report.skipped == []
    assert report.scored_groups == 0


def test_a_group_visible_in_the_window_is_still_judged_on_its_whole_history():
    """The flip side of the previous test: a group with rows both inside and
    outside the window is still measured against its FULL history -- only
    the reporting gate is window-scoped, not the statistics themselves. Nine
    of these ten rows predate the window; if MIN_HISTORY were checked against
    the in-window count alone (one row) this would wrongly be skipped as
    "1 dépense" instead of scored as the ten-row category it actually is."""
    rows = _rows(1, [-4000] * 9, start=date(2024, 1, 1))
    in_window_row = AnomalyTx(id=200, on=date(2026, 6, 1), amount_cents=-4050,
                               label="ACHAT", category_id=1)
    report = detect_anomalies(rows + [in_window_row], date(2026, 1, 1), date(2026, 12, 31))
    assert report.scored_groups == 1
    assert report.skipped == []
