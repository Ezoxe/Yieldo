from datetime import date

import pytest

from app.engines.capacity import MonthlyEntry, complete_months
from app.engines.forecast import (
    MAX_HORIZON_MONTHS,
    MIN_MONTHS_FOR_FORECAST,
    LedgerEntry,
    ResidualHistory,
    build_observations,
    project_cashflow,
    residual_entries,
)
from app.engines.recurrence import Recurrence, RecurringTx, detect_recurrences
from app.engines.robust import P90_SIGMAS, quantile_offset_cents

TODAY = date(2026, 8, 12)

# Six values, not twelve, and the count matters: cycled over twelve months each
# value appears exactly twice, so a six-month sample and a twelve-month sample
# built from the same list carry the *same* median and the same MAD, hence the
# same measured scale. That is what makes
# `test_the_band_is_wider_when_fewer_months_were_observed` a test of the sample
# size alone rather than of two different amounts of noise.
#
# The jitter is deliberate: six identical months have a MAD of zero, hence a
# scale of zero, hence no measurable band at all -- which this engine refuses
# outright. Real months are never identical, and the fixture must not be either.
JITTER = [0, 1_500, -1_200, 800, -900, 2_000]


def _observations(count: int, net_per_month: int, start_month: int = 1):
    """`count` complete months through 2025, each netting about `net_per_month`.

    The ledger end is December, not the last month with data: `complete_months`
    already drops months with no activity, and a tighter end would silently cut
    the final month for being partly outside the ledger.
    """
    entries = [
        MonthlyEntry(
            on=date(2025, start_month + index, 15),
            amount_cents=net_per_month + JITTER[index % len(JITTER)],
        )
        for index in range(count)
    ]
    return complete_months(entries, date(2025, start_month, 1), date(2025, 12, 31))


def _history(count: int, net_per_month: int, start_month: int = 1,
             ledger_months: int | None = None) -> ResidualHistory:
    """`_observations`, paired with the ledger month count it came from. Equal
    unless a test is specifically about the two counts differing."""
    observations = _observations(count, net_per_month, start_month)
    return ResidualHistory(
        observations=observations,
        ledger_months_observed=count if ledger_months is None else ledger_months,
    )


def _rent() -> Recurrence:
    return Recurrence(
        label_key="loyer", label="VIREMENT SEPA LOYER", category_id=None,
        periodicity="monthly", occurrences=8,
        first_on=date(2026, 1, 5), last_on=date(2026, 8, 5),
        median_interval_days=30, amount_cents=-78_000, amount_spread_cents=0,
        annual_cents=-936_000, observed_span_days=212, annualisable=True,
        expected_next_on=date(2026, 9, 4),
        status="active", confidence="confirmed", price_change=None,
    )


# --------------------------------------------------------------------------
# Refusals
# --------------------------------------------------------------------------


def test_five_observed_months_is_not_enough_and_the_engine_says_so():
    """The operator has three. Six is the floor at which a seasonal pattern can
    even be looked for, and a twelve-month projection off five points would be
    a straight line with a decorative band around it."""
    report = project_cashflow(100_000, _history(5, -10_000), [], TODAY)
    assert report.months == []
    assert report.insufficient_reason is not None
    assert "6 mois" in report.insufficient_reason
    assert report.months_observed == 5
    assert MIN_MONTHS_FOR_FORECAST == 6


def test_the_operators_own_ledger_is_refused_end_to_end():
    """197 transactions, two dense months, three sparse ones, eight empty ones
    -- and three complete observed months. The plan's own table says this
    feature refuses on his data. It is the designed outcome, not a defect: a
    seasonality estimated from three months is not seasonality.

    Run through the whole pipeline a screen would use, so the refusal is proved
    where it will actually happen and not only against a hand-built list.
    """
    ledger_start, ledger_end = date(2025, 1, 24), date(2026, 1, 9)
    entries: list[LedgerEntry] = []
    # Two dense months, three sparse, eight empty, two partial at the edges.
    density = {
        (2025, 1): 12,    # partial -- the ledger opens on the 24th
        (2025, 2): 74,    # dense
        (2025, 3): 77,    # dense
        (2025, 12): 22,   # sparse
        (2026, 1): 9,     # partial -- the ledger closes on the 9th
    }
    for (year, month), count in density.items():
        for index in range(count):
            day = 25 + index % 4 if (year, month) == (2025, 1) else 1 + index % 27
            entries.append(LedgerEntry(
                on=date(year, month, day),
                amount_cents=-2_500 - index * 37,
                label_key=f"commerce {index % 19}",
            ))
    # A salary, so the months are not pure outflow.
    for year, month in ((2025, 2), (2025, 3), (2025, 12)):
        entries.append(LedgerEntry(
            on=date(year, month, 28), amount_cents=210_000, label_key="salaire",
        ))
    assert len(entries) == 197

    detected = detect_recurrences(
        [
            RecurringTx(on=e.on, amount_cents=e.amount_cents, label_key=e.label_key,
                        label_raw=e.label_key, category_id=None)
            for e in entries
        ],
        ledger_end,
    )
    history = build_observations(
        entries, detected.recurrences, ledger_start, ledger_end
    )
    # April to November hold nothing, and January at either end is partial.
    assert len(history.observations) == 3
    assert history.ledger_months_observed == 3

    report = project_cashflow(
        1_000_000, history, detected.recurrences, ledger_end
    )
    assert report.months == []
    assert report.months_observed == 3
    assert report.insufficient_reason is not None
    assert "6 mois" in report.insufficient_reason
    assert "3" in report.insufficient_reason


def test_a_long_ledger_with_a_thin_residual_is_told_the_real_cause():
    """`months_observed` counts months carrying *residual* activity, which is not
    the same number as the months the ledger covers: a household whose every
    charge is recurring can hold twelve complete months of statements and still
    leave only three months carrying anything non-recurring, because
    `complete_months` never emits a month with no entries in it.

    Telling that reader "importez des relevés supplémentaires" names a cause
    that is not the cause and asks them to fix something that is not broken.
    Task 10's review fixed exactly this shape of defect in `runway.py`.
    """
    report = project_cashflow(
        100_000, _history(3, -10_000, ledger_months=12), [], TODAY
    )
    assert report.months == []
    assert report.months_observed == 3
    assert report.ledger_months_observed == 12
    assert "12 mois" in report.insufficient_reason
    assert "non récurrentes" in report.insufficient_reason
    assert "Importez" not in report.insufficient_reason

    # Zero is the likeliest value of all -- a household whose every charge is
    # recurring leaves no residual month at all -- and it must still read as
    # French rather than as "seuls 0 d'entre eux".
    empty = project_cashflow(
        100_000, ResidualHistory([], 12), [], TODAY
    )
    assert "aucun ne porte d'opération non récurrente" in empty.insufficient_reason

    lone = project_cashflow(
        100_000, _history(1, -10_000, ledger_months=12), [], TODAY
    )
    assert "mais un seul porte des opérations" in lone.insufficient_reason


def test_a_genuinely_short_ledger_is_still_told_to_import_more():
    """The other branch, so the two causes are mutually exclusive by
    construction rather than by hope."""
    report = project_cashflow(
        100_000, _history(3, -10_000, ledger_months=3), [], TODAY
    )
    assert "Importez" in report.insufficient_reason
    assert "non récurrentes" not in report.insufficient_reason
    # And the same when the caller does not distinguish the two counts at all.
    silent = project_cashflow(100_000, _history(3, -10_000), [], TODAY)
    assert silent.ledger_months_observed == 3
    assert "Importez" in silent.insufficient_reason


def test_a_residual_wider_than_the_ledger_it_came_from_is_rejected():
    """A residual cannot hold more complete months than the ledger it was
    filtered out of. That is a caller error, and it surfaces rather than
    quietly picking whichever branch reads better."""
    with pytest.raises(ValueError, match="ne peut pas"):
        project_cashflow(
            100_000, _history(6, -10_000, ledger_months=4), [], TODAY
        )


def test_a_history_with_no_variation_at_all_is_refused_rather_than_drawn_flat():
    """Zero dispersion is not evidence of zero uncertainty; it is evidence that
    the sample is too coarse to show any. `robust.modified_z` refuses the same
    input for the same reason. A band of zero width is a claim of certainty,
    and §7.3 forbids the single line it would draw."""
    entries = [
        MonthlyEntry(on=date(2025, month, 15), amount_cents=-10_000)
        for month in range(1, 7)
    ]
    flat = complete_months(entries, date(2025, 1, 1), date(2025, 12, 31))
    report = project_cashflow(100_000, ResidualHistory(flat, len(flat)), [], TODAY)
    assert report.months == []
    assert report.insufficient_reason is not None
    assert "intervalle de confiance" in report.insufficient_reason


def test_an_impossible_horizon_is_refused_in_french():
    history = _history(6, -10_000)
    with pytest.raises(ValueError, match="horizon"):
        project_cashflow(100_000, history, [], TODAY, horizon_months=0)
    with pytest.raises(ValueError, match="horizon"):
        project_cashflow(
            100_000, history, [], TODAY, horizon_months=MAX_HORIZON_MONTHS + 1
        )


# --------------------------------------------------------------------------
# Shape of the projection
# --------------------------------------------------------------------------


def test_six_observed_months_produce_twelve_projected_ones():
    report = project_cashflow(100_000, _history(6, -10_000), [], TODAY)
    assert len(report.months) == 12
    assert report.insufficient_reason is None


def test_the_projection_starts_the_month_after_today():
    report = project_cashflow(100_000, _history(6, -10_000), [], TODAY)
    assert report.months[0].key == "2026-09"
    assert report.months[-1].key == "2027-08"


def test_the_horizon_is_configurable():
    report = project_cashflow(100_000, _history(6, -10_000), [], TODAY, horizon_months=6)
    assert len(report.months) == 6


def test_every_monetary_field_is_an_integer_number_of_cents():
    report = project_cashflow(1_000_000, _history(6, -10_000), [_rent()], TODAY)
    assert isinstance(report.opening_balance_cents, int)
    assert isinstance(report.pooled_scale_cents, int)
    for month in report.months:
        for value in (
            month.recurring_cents, month.residual_cents, month.net_p50_cents,
            month.balance_p10_cents, month.balance_p50_cents, month.balance_p90_cents,
        ):
            assert isinstance(value, int) and not isinstance(value, bool)


def test_the_running_balance_is_the_opening_balance_plus_every_net_so_far():
    report = project_cashflow(1_000_000, _history(6, -10_000), [_rent()], TODAY)
    running = report.opening_balance_cents
    for month in report.months:
        assert month.net_p50_cents == month.recurring_cents + month.residual_cents
        running += month.net_p50_cents
        assert month.balance_p50_cents == running


# --------------------------------------------------------------------------
# The band
# --------------------------------------------------------------------------


def test_the_band_is_never_a_single_line():
    report = project_cashflow(100_000, _history(6, -10_000), [], TODAY)
    first = report.months[0]
    assert first.balance_p10_cents < first.balance_p50_cents < first.balance_p90_cents


def test_the_band_widens_with_distance():
    """Twelve months out is less certain than one month out, and the shape has
    to say so. A constant-width band would claim otherwise."""
    report = project_cashflow(100_000, _history(8, -10_000, start_month=1), [], TODAY)
    widths = [
        month.balance_p90_cents - month.balance_p10_cents for month in report.months
    ]
    assert widths == sorted(widths)
    assert widths[-1] > widths[0]


def test_the_band_is_wider_when_fewer_months_were_observed():
    """The centre itself is estimated, and estimated from six points it is far
    less certain than from twelve. A band that ignores that is decoration: it
    would draw the same ribbon whether the reader had half a year of statements
    or five.

    Both samples are built from the same six-value jitter, so their measured
    scale is identical to the cent -- only the sample size differs.
    """
    thin = project_cashflow(100_000, _history(6, -10_000), [], TODAY)
    thick = project_cashflow(100_000, _history(12, -10_000), [], TODAY)
    assert thin.pooled_scale_cents == thick.pooled_scale_cents
    assert thin.months_observed == 6 and thick.months_observed == 12

    thin_width = thin.months[5].balance_p90_cents - thin.months[5].balance_p10_cents
    thick_width = thick.months[5].balance_p90_cents - thick.months[5].balance_p10_cents
    assert thin_width > thick_width


# --------------------------------------------------------------------------
# Seasonality
# --------------------------------------------------------------------------


def _two_years_with_a_costly_december():
    """Two full years. December costs four times a normal month, and no month
    is ever billed twice at the same amount -- the second year's jitter is the
    first year's mirrored, so each calendar month's median is exactly its base
    while the sample still carries dispersion."""
    jitter = [0, 700, -500, 300, -400, 900, -800, 200, -100, 600, -700, 400]
    entries = [
        MonthlyEntry(
            on=date(year, month, 15),
            amount_cents=(-40_000 if month == 12 else -10_000)
            + (jitter[month - 1] if year == 2024 else -jitter[month - 1]),
        )
        for year in (2024, 2025)
        for month in range(1, 13)
    ]
    return complete_months(entries, date(2024, 1, 1), date(2025, 12, 31))


def test_a_calendar_month_seen_twice_gets_its_own_seasonal_residual():
    """December costs more than March in most households. Two Decembers is the
    floor at which that can be claimed."""
    observations = _two_years_with_a_costly_december()
    report = project_cashflow(
        1_000_000, ResidualHistory(observations, len(observations)), [],
        date(2026, 1, 15),
    )

    december = next(month for month in report.months if month.key.endswith("-12"))
    march = next(month for month in report.months if month.key.endswith("-03"))
    assert december.seasonal is True
    assert december.residual_cents == -40_000
    assert march.residual_cents == -10_000
    assert december.residual_cents < march.residual_cents
    assert report.seasonality_used is True


def _eighteen_months_with_half_the_calendar_doubled():
    """January 2024 to June 2025. January through June are each observed twice;
    July through December only once.

    Even calendar months cost eight times an odd one, so the spread *between*
    months is enormous; each calendar month repeats within 2 EUR of itself, so
    the spread *within* a calendar month is tiny. The two scales are therefore
    impossible to confuse, which is the point.
    """
    entries = [
        MonthlyEntry(
            on=date(year, month, 15),
            amount_cents=(-80_000 if month % 2 == 0 else -10_000)
            + (200 if year == 2024 else -200),
        )
        for year, month in [(2024, m) for m in range(1, 13)]
        + [(2025, m) for m in range(1, 7)]
    ]
    observations = complete_months(entries, date(2024, 1, 1), date(2025, 6, 30))
    return ResidualHistory(observations, len(observations))


def _width(month) -> int:
    return month.balance_p90_cents - month.balance_p10_cents


def test_a_month_with_no_seasonal_estimate_is_priced_against_the_pooled_spread():
    """Seasonality half-on. With eighteen observed months, six calendar months
    have two samples and six have one -- and the six that fall back to the
    pooled median are the *least* known months in the horizon.

    Measuring one scale over the mixed deviation set lets the tight,
    seasonally-explained months dominate the MAD, so the fallback months get
    wrapped in a band sized by the jitter of the months the model *did* explain.
    `ForecastMonth.seasonal` says False for them, but a band that does not widen
    where the estimate is weakest is decoration.

    Isolated by projecting a single month from two different anchors over the
    same eighteen observations, so the only thing that differs between the two
    numbers is which centre that month gets.
    """
    history = _eighteen_months_with_half_the_calendar_doubled()
    fallback = project_cashflow(
        1_000_000, history, [], date(2025, 6, 20), horizon_months=1
    )
    seasonal = project_cashflow(
        1_000_000, history, [], date(2025, 12, 20), horizon_months=1
    )
    assert fallback.months[0].key == "2025-07"
    assert fallback.months[0].seasonal is False
    assert seasonal.months[0].key == "2026-01"
    assert seasonal.months[0].seasonal is True

    # July's centre is the pooled median of months costing 100 EUR and months
    # costing 800 EUR. January's is two Januaries agreeing within 4 EUR. July is
    # the less knowable of the two and its band has to say so.
    assert _width(fallback.months[0]) > _width(seasonal.months[0])

    # Ordering alone is too weak to pin this, and proving that took a mutation:
    # the centre term is sized on the pooled scale for *any* fallback month, so
    # July stays the wider of the two even when its own noise term is wrongly
    # collapsed to the seasonal scale. So assert each side against the scale it
    # must have been priced with.
    #
    # One month out, a fallback month's noise term alone is one pooled sigma, so
    # its half-width cannot be narrower than that sigma's own P10/P90 offset.
    pooled_offset = quantile_offset_cents(fallback.pooled_scale_cents, P90_SIGMAS)
    assert _width(fallback.months[0]) // 2 >= pooled_offset

    # The seasonal side needs an upper bound against its *own* scale, not merely
    # "less than the pooled one": that weaker form leaves 130x of slack and would
    # pass unchanged if seasonal months were priced at half the pooled scale.
    # One month out the exact multiplier is sqrt(1 + (pi/2)/2) = 1.336, so twice
    # the seasonal scale's own offset is a ceiling nothing mis-priced fits under.
    seasonal_offset = quantile_offset_cents(seasonal.seasonal_scale_cents, P90_SIGMAS)
    assert _width(seasonal.months[0]) // 2 <= 2 * seasonal_offset


def test_the_two_scales_are_measured_over_their_own_populations():
    """Each scale answers a different question -- "what does a month vary by"
    and "what does *this* calendar month vary by" -- so each is measured over
    the observations that bear on it, and both are published."""
    report = project_cashflow(
        1_000_000, _eighteen_months_with_half_the_calendar_doubled(), [],
        date(2025, 6, 20),
    )
    # Between-month spread: half the months cost 700 EUR more than the other half.
    assert report.pooled_scale_cents == 51_891
    # Within-month spread: every calendar month repeats within 2 EUR of itself.
    assert report.seasonal_scale_cents == 297


def _thirteen_months_with_one_cent_exact_calendar_month() -> ResidualHistory:
    """January 2025 to January 2026. January is the only calendar month observed
    twice, and the two Januaries agree to the cent. The eleven other months vary
    perfectly normally."""
    jitter = [0, 1_500, -1_200, 800, -900, 2_000, -1_700, 600, -400, 1_100, -1_300]
    entries = (
        [MonthlyEntry(on=date(2025, 1, 15), amount_cents=-10_000)]
        + [
            MonthlyEntry(
                on=date(2025, month, 15), amount_cents=-10_000 + jitter[month - 2]
            )
            for month in range(2, 13)
        ]
        + [MonthlyEntry(on=date(2026, 1, 15), amount_cents=-10_000)]
    )
    observations = complete_months(entries, date(2025, 1, 1), date(2026, 1, 31))
    return ResidualHistory(observations, len(observations))


def test_a_cent_exact_calendar_month_falls_back_instead_of_killing_the_forecast():
    """A calendar month whose two samples never move carries no information about
    how *that* month varies -- so there is no seasonal estimate to price it
    against, and it belongs on the pooled centre and scale like any other month
    the model cannot explain.

    Refusing the whole twelve-month projection because one calendar month came
    out cent-exact would be a total feature loss for a condition that says
    nothing about the other eleven months, all of which have a perfectly healthy
    pooled scale. It is reachable at thirteen observed months, which is one
    import away from the operator.
    """
    history = _thirteen_months_with_one_cent_exact_calendar_month()
    assert len(history.observations) == 13

    report = project_cashflow(1_000_000, history, [], date(2026, 1, 20))
    assert report.insufficient_reason is None
    assert len(report.months) == 12
    assert report.pooled_scale_cents > 0
    # No usable seasonal estimate exists, so none is claimed.
    assert report.seasonal_scale_cents is None
    assert report.seasonality_used is False
    assert all(month.seasonal is False for month in report.months)
    assert all(month.residual_cents == report.months[0].residual_cents
               for month in report.months)


def test_the_no_dispersion_refusal_is_only_used_when_it_is_true():
    """`_reason_no_dispersion` claims the observed months "ne varient pas d'un
    mois à l'autre". That must be reachable only when it is actually so -- a
    degenerate *seasonal* scale sitting on top of a healthy pooled one is a
    different situation and telling the reader that would be the wrong-cause
    defect all over again."""
    healthy = project_cashflow(
        1_000_000, _thirteen_months_with_one_cent_exact_calendar_month(), [],
        date(2026, 1, 20),
    )
    assert healthy.insufficient_reason is None

    entries = [
        MonthlyEntry(on=date(2025, month, 15), amount_cents=-10_000)
        for month in range(1, 7)
    ]
    flat = complete_months(entries, date(2025, 1, 1), date(2025, 12, 31))
    refused = project_cashflow(100_000, ResidualHistory(flat, len(flat)), [], TODAY)
    assert "ne varient pas d'un mois à l'autre" in refused.insufficient_reason
    assert refused.pooled_scale_cents == 0


def test_the_seasonal_scale_is_absent_when_no_month_has_one():
    report = project_cashflow(100_000, _history(6, -10_000), [], TODAY)
    assert report.seasonality_used is False
    assert report.seasonal_scale_cents is None
    assert report.pooled_scale_cents > 0


def test_one_observation_of_a_calendar_month_falls_back_to_the_pooled_median():
    report = project_cashflow(1_000_000, _history(6, -10_000), [], TODAY)
    assert all(month.seasonal is False for month in report.months)
    assert report.seasonality_used is False
    # Every month gets the same pooled figure, because none of them has a
    # seasonal one of its own.
    assert len({month.residual_cents for month in report.months}) == 1


# --------------------------------------------------------------------------
# Projecting the recurrences
# --------------------------------------------------------------------------


def test_a_monthly_charge_lands_exactly_once_in_every_month_it_is_due():
    """Exactly once, not "at least once". Stepping a monthly recurrence forward
    by its median interval of 30 days yields 12,17 charges a year: one month in
    the horizon is silently billed twice and the chart grows a spike that no
    bank statement will ever show."""
    report = project_cashflow(1_000_000, _history(6, 0), [_rent()], TODAY)
    assert [month.recurring_cents for month in report.months] == [-78_000] * 12


def test_a_quarterly_charge_lands_four_times_in_twelve_months():
    insurance = Recurrence(
        label_key="assurance", label="ASSURANCE HABITATION", category_id=None,
        periodicity="quarterly", occurrences=5,
        first_on=date(2025, 6, 15), last_on=date(2026, 6, 15),
        median_interval_days=91, amount_cents=-12_000, amount_spread_cents=0,
        annual_cents=-48_000, observed_span_days=365, annualisable=True,
        expected_next_on=date(2026, 9, 15),
        status="active", confidence="confirmed", price_change=None,
    )
    report = project_cashflow(1_000_000, _history(6, 0), [insurance], TODAY)
    charged = [month.key for month in report.months if month.recurring_cents]
    assert charged == ["2026-09", "2026-12", "2027-03", "2027-06"]
    assert all(
        month.recurring_cents == -12_000 for month in report.months if month.recurring_cents
    )


def test_a_weekly_charge_lands_four_or_five_times_a_month():
    pass_navigo = Recurrence(
        label_key="transport", label="ABONNEMENT TRANSPORT", category_id=None,
        periodicity="weekly", occurrences=20,
        first_on=date(2026, 3, 6), last_on=date(2026, 8, 7),
        median_interval_days=7, amount_cents=-2_300, amount_spread_cents=0,
        annual_cents=-119_600, observed_span_days=154, annualisable=True,
        expected_next_on=date(2026, 9, 4),
        status="active", confidence="confirmed", price_change=None,
    )
    report = project_cashflow(1_000_000, _history(6, 0), [pass_navigo], TODAY)
    counts = {month.recurring_cents // -2_300 for month in report.months}
    assert counts <= {4, 5}
    assert 4 in counts and 5 in counts


def test_a_cancelled_recurrence_is_not_projected_forward():
    ended = Recurrence(
        label_key="salle", label="SALLE DE SPORT", category_id=None,
        periodicity="monthly", occurrences=4,
        first_on=date(2025, 2, 10), last_on=date(2025, 5, 10),
        median_interval_days=30, amount_cents=-3_990, amount_spread_cents=0,
        annual_cents=-47_880, observed_span_days=89, annualisable=False,
        expected_next_on=date(2025, 6, 9),
        status="ended", confidence="confirmed", price_change=None,
    )
    report = project_cashflow(100_000, _history(6, -10_000), [ended], TODAY)
    assert all(month.recurring_cents == 0 for month in report.months)
    assert report.recurrences_projected == 0


def test_a_recurrence_watched_for_less_than_a_quarter_is_not_projected():
    """Task 8's rule, carried into the forecast: you may not multiply to a year
    what you watched for less than a quarter. `recurring_keys` already excludes
    these; projecting them here would push the same unearned claim in by
    another door."""
    fresh = Recurrence(
        label_key="nouveau", label="NOUVEAU SERVICE", category_id=None,
        periodicity="monthly", occurrences=3,
        first_on=date(2026, 6, 5), last_on=date(2026, 8, 5),
        median_interval_days=31, amount_cents=-1_990, amount_spread_cents=0,
        annual_cents=-23_880, observed_span_days=61, annualisable=False,
        expected_next_on=date(2026, 9, 5),
        status="active", confidence="probable", price_change=None,
    )
    report = project_cashflow(100_000, _history(6, -10_000), [fresh], TODAY)
    assert all(month.recurring_cents == 0 for month in report.months)
    assert report.recurrences_projected == 0


# --------------------------------------------------------------------------
# One call that cannot be got wrong
# --------------------------------------------------------------------------


def _a_year_with_one_all_recurring_month() -> list[LedgerEntry]:
    """Twelve months of rent, and ordinary purchases in eleven of them.
    December holds nothing but the rent, so it carries no residual at all and
    `complete_months` never emits it -- twelve ledger months, eleven residual
    ones."""
    entries = [
        LedgerEntry(on=date(2025, month, 5), amount_cents=-78_000, label_key="loyer")
        for month in range(1, 13)
    ]
    for month in range(1, 12):
        entries += [
            LedgerEntry(
                on=date(2025, month, 10 + index),
                amount_cents=-4_000 - index * 300 - month * 150,
                label_key=f"achat {month}-{index}",
            )
            for index in range(3)
        ]
    return entries


def _detect(entries: list[LedgerEntry], today: date):
    return detect_recurrences(
        [
            RecurringTx(on=e.on, amount_cents=e.amount_cents, label_key=e.label_key,
                        label_raw=e.label_key, category_id=None)
            for e in entries
        ],
        today,
    ).recurrences


def test_the_history_helper_returns_both_counts_from_one_call():
    """The two counts come from the same pass over the same bounds, so a caller
    cannot filter one and forget the other -- nor pass the unfiltered ledger as
    the residual and double-count the rent."""
    entries = _a_year_with_one_all_recurring_month()
    recurrences = _detect(entries, date(2025, 12, 31))
    history = build_observations(
        entries, recurrences, date(2025, 1, 1), date(2025, 12, 31)
    )
    assert history.ledger_months_observed == 12
    assert len(history.observations) == 11
    assert all(month.key != "2025-12" for month in history.observations)
    # The rent is gone from the residual -- it is projected instead.
    assert all(month.net_cents > -78_000 for month in history.observations)


def test_the_two_counts_reach_the_report_without_the_caller_restating_either():
    entries = _a_year_with_one_all_recurring_month()
    recurrences = _detect(entries, date(2025, 12, 31))
    history = build_observations(
        entries, recurrences, date(2025, 1, 1), date(2025, 12, 31)
    )
    report = project_cashflow(1_000_000, history, recurrences, date(2025, 12, 31))
    assert report.insufficient_reason is None
    assert report.ledger_months_observed == 12
    assert report.months_observed == 11
    assert len(report.months) == 12
    assert report.recurrences_projected == 1


def test_a_history_cannot_claim_fewer_ledger_months_than_it_holds():
    """A residual cannot hold more complete months than the ledger it was
    filtered out of. The invariant now lives on the type, so it is checked once
    at construction rather than at every call that consumes one."""
    with pytest.raises(ValueError, match="ne peut pas"):
        ResidualHistory(observations=_observations(6, -10_000), ledger_months_observed=4)


# --------------------------------------------------------------------------
# The windowed subtraction -- task 7's carry-forward
# --------------------------------------------------------------------------


def _lapsed_subscription_ledger() -> tuple[list[LedgerEntry], list[Recurrence]]:
    """A subscription billed January to March 2025, lapsed for six months, then
    resumed October 2025 to March 2026. `_analysable_run` cuts the group at its
    last hole, so only the trailing run was ever analysed."""
    rows = [
        LedgerEntry(on=date(2025, month, 5), amount_cents=-1_349, label_key="video")
        for month in (1, 2, 3)
    ] + [
        LedgerEntry(on=on, amount_cents=-1_599, label_key="video")
        for on in (
            date(2025, 10, 5), date(2025, 11, 5), date(2025, 12, 5),
            date(2026, 1, 5), date(2026, 2, 5), date(2026, 3, 5),
        )
    ]
    # Ordinary, non-recurring spending alongside it.
    noise = [
        LedgerEntry(on=date(2025, month, 18), amount_cents=-5_000 - month * 100,
                    label_key=f"courses {month}")
        for month in (1, 2, 3)
    ]
    detected = detect_recurrences(
        [
            RecurringTx(on=r.on, amount_cents=r.amount_cents, label_key=r.label_key,
                        label_raw=r.label_key, category_id=None)
            for r in rows + noise
        ],
        date(2026, 3, 20),
    )
    return rows + noise, detected.recurrences


def test_the_analysed_run_really_does_start_after_the_lapse():
    """The premise the next test rests on. If this ever stops holding, the
    windowing below is testing nothing."""
    _, recurrences = _lapsed_subscription_ledger()
    video = next(item for item in recurrences if item.label_key == "video")
    assert video.first_on == date(2025, 10, 5)
    assert video.last_on == date(2026, 3, 5)
    assert video.occurrences == 6
    assert video.annualisable is True
    assert video.status == "active"


def test_the_recurring_subtraction_is_windowed_and_not_done_by_bare_key():
    """Task 7's carry-forward, and the trap this engine is most likely to fall
    into. `recurring_keys` is authoritative only over each recurrence's own
    `[first_on, last_on]` window: the pre-lapse rows were never analysed, are
    never projected forward, and must therefore stay in the residual. Removing
    them on the authority of a run that excluded them makes three months of
    real spending vanish from both sides of the forecast at once.

    Both sides shown together, the way `test_capacity.py` pins its ledger-bounds
    precondition.
    """
    entries, recurrences = _lapsed_subscription_ledger()
    video = next(item for item in recurrences if item.label_key == "video")

    residual = residual_entries(entries, recurrences)
    kept = [entry for entry in residual if entry.amount_cents == -1_349]
    assert [entry.on for entry in kept] == [
        date(2025, 1, 5), date(2025, 2, 5), date(2025, 3, 5)
    ]
    # Everything inside the analysed window is gone -- it is projected instead.
    assert all(
        not (video.first_on <= entry.on <= video.last_on and entry.amount_cents == -1_599)
        for entry in residual
    )

    # What a subtraction by bare key would have produced, for contrast: the
    # three pre-lapse charges removed on the strength of a run that never saw
    # them, and 40,47 EUR of real spending accounted for nowhere.
    by_bare_key = [
        entry for entry in entries
        if entry.label_key not in {item.label_key for item in recurrences}
    ]
    assert sum(entry.amount_cents for entry in residual) - sum(
        entry.amount_cents for entry in by_bare_key
    ) == -3 * 1_349


def test_the_split_loses_no_money():
    """Every historical row is accounted for exactly once: either inside a
    recurrence that is projected forward, or inside the residual. Never both,
    never neither."""
    entries, recurrences = _lapsed_subscription_ledger()
    residual = residual_entries(entries, recurrences)
    withheld = [
        entry for entry in entries
        if any(
            entry.label_key == item.label_key and item.first_on <= entry.on <= item.last_on
            for item in recurrences
        )
    ]
    assert len(residual) + len(withheld) == len(entries)
    assert sum(e.amount_cents for e in residual) + sum(
        e.amount_cents for e in withheld
    ) == sum(e.amount_cents for e in entries)


def test_what_is_not_projected_is_not_subtracted_either():
    """The symmetry that keeps the forecast honest: a recurrence too young to
    project forward, or already ended, leaves its rows in the residual, where
    they go on weighing exactly as much as they did."""
    entries = [
        LedgerEntry(on=date(2026, month, 5), amount_cents=-1_990, label_key="nouveau")
        for month in (6, 7, 8)
    ]
    fresh = Recurrence(
        label_key="nouveau", label="NOUVEAU SERVICE", category_id=None,
        periodicity="monthly", occurrences=3,
        first_on=date(2026, 6, 5), last_on=date(2026, 8, 5),
        median_interval_days=31, amount_cents=-1_990, amount_spread_cents=0,
        annual_cents=-23_880, observed_span_days=61, annualisable=False,
        expected_next_on=date(2026, 9, 5),
        status="active", confidence="probable", price_change=None,
    )
    assert len(residual_entries(entries, [fresh])) == 3

    ended = Recurrence(**{**fresh.__dict__, "annualisable": True, "status": "ended"})
    assert len(residual_entries(entries, [ended])) == 3


# --------------------------------------------------------------------------
# The threshold
# --------------------------------------------------------------------------


def test_a_month_whose_low_estimate_falls_under_the_threshold_is_flagged():
    report = project_cashflow(50_000, _history(6, -10_000), [], TODAY, threshold_cents=0)
    breached = [month for month in report.months if month.below_threshold]
    assert breached
    assert report.first_breach_key == breached[0].key


def test_the_flag_uses_the_low_estimate_not_the_median():
    """Warning only once the *median* dips below the floor is warning too late:
    the reader wants to know when it could happen, not when it probably has.

    Constructed rather than guessed: the threshold is set to one month's own
    median, so that month is by definition not below it on the median and is
    below it on the low estimate, whatever the arithmetic works out to.
    """
    history = _history(6, -10_000)
    baseline = project_cashflow(200_000, history, [], TODAY)
    threshold = baseline.months[5].balance_p50_cents

    report = project_cashflow(200_000, history, [], TODAY, threshold_cents=threshold)
    month = report.months[5]
    assert month.balance_p50_cents >= threshold
    assert month.balance_p10_cents < threshold
    assert month.below_threshold is True


def test_no_breach_reports_no_breach_rather_than_the_first_month():
    report = project_cashflow(10_000_000, _history(6, -10_000), [], TODAY)
    assert report.first_breach_key is None
    assert all(month.below_threshold is False for month in report.months)
    assert report.threshold_cents == 0
