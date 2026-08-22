"""Twelve months of projected balance, as a band and never as a line.

The design brief is explicit: "Renvoie un intervalle de confiance, pas une
valeur unique", and §7.3 forbids a single Monte-Carlo line for the same reason
-- a single projected number reads as a forecast someone stands behind.

Two sources, kept strictly disjoint:

* the detected recurrences, projected forward on their own billing calendar;
* everything else, as a monthly residual taken from the real history, seasonal
  where the history can support a seasonal claim and pooled where it cannot.

`residual_entries` is what keeps them disjoint, and callers must use it rather
than filtering the ledger themselves -- see its docstring for the trap.

Pure: no session, no network, no implicit clock -- `today` is a parameter.
"""

import math
from dataclasses import dataclass
from datetime import date, timedelta

from app.engines.aggregate import bucket_bounds, bucket_key
from app.engines.capacity import MonthlyEntry, MonthObservation
from app.engines.recurrence import PERIOD_BOUNDS, Periodicity, Recurrence
from app.engines.robust import P90_SIGMAS, describe, median_cents, quantile_offset_cents

# Six complete observed months is the floor. Below it there is no second
# observation of any calendar month, so seasonality cannot be looked for at all,
# and a twelve-month projection would be one number repeated twelve times with a
# decorative band around it. The operator's ledger holds three.
MIN_MONTHS_FOR_FORECAST = 6

DEFAULT_HORIZON_MONTHS = 12

# An input guard on the caller, not an analytic knob: task 12 wires
# `horizon_months` to a query parameter, and the centre-uncertainty term below
# grows as the square of the horizon, so past two years the band is wider than
# any balance it contains and the chart says nothing at all.
MAX_HORIZON_MONTHS = 24

# Two observations of the same calendar month before a seasonal claim is made.
# One December is an anecdote.
MIN_OBSERVATIONS_FOR_SEASONALITY = 2

# Asymptotic variance of a sample median is (pi/2) * sigma^2 / n -- the median
# is about 64 % as efficient as the mean. Published, not tuned; it is the same
# family of constant as `robust.MAD_TO_SIGMA`. Used to price the uncertainty of
# the centre this engine projects from, which is a median.
MEDIAN_VARIANCE_FACTOR = math.pi / 2

# Periodicities that bill on the calendar rather than on a stopwatch. Rent falls
# on the 5th of each month, not every 30 days, and the difference is not
# cosmetic: stepping a "monthly" recurrence forward by its median interval of 30
# days yields 12,17 charges a year, so one month inside a twelve-month horizon
# is billed twice and the chart grows a spike no statement will ever show.
# Weekly and biweekly genuinely are 7 and 14 days and are stepped in days.
CALENDAR_MONTHS_PER_PERIOD: dict[Periodicity, int] = {
    "monthly": 1,
    "quarterly": 3,
    "yearly": 12,
}


@dataclass(frozen=True)
class LedgerEntry:
    """The minimal input `residual_entries` needs: when, how much, under which
    grouping key. The key must be the same one `detect_recurrences` was given --
    `normalize_label(label_raw)`, never the stored `label_clean`."""

    on: date
    amount_cents: int
    label_key: str


@dataclass(frozen=True)
class ForecastMonth:
    key: str
    start: date
    end: date
    # Recurring flows due this month, signed.
    recurring_cents: int
    # Everything else, signed.
    residual_cents: int
    net_p50_cents: int
    balance_p10_cents: int
    balance_p50_cents: int
    balance_p90_cents: int
    below_threshold: bool
    # True when this month's residual came from observations of this same
    # calendar month rather than from the pooled median.
    seasonal: bool


@dataclass(frozen=True)
class ForecastReport:
    months: list[ForecastMonth]
    # Months carrying *residual* activity -- what the band was measured over.
    months_observed: int
    # Complete months the ledger itself covers. Not the same number: a household
    # whose every charge is recurring leaves months with no residual activity at
    # all, and `complete_months` never emits those. The screen needs both to say
    # "12 mois de relevés, 3 exploitables" rather than conflating the two.
    ledger_months_observed: int
    seasonality_used: bool
    # How many recurrences were actually projected forward -- not how many were
    # detected. The screen needs the difference to explain what is in the chart:
    # ended and too-young recurrences are deliberately absent from it.
    recurrences_projected: int
    # The measured month-to-month scale of the residual, after the seasonal or
    # pooled centre has been taken out. What the band's width is built from,
    # published so a screen can explain the band without re-measuring it.
    # 0 on a refusal, where nothing was measured -- read `insufficient_reason`
    # first, never this field on its own.
    residual_scale_cents: int
    threshold_cents: int
    first_breach_key: str | None
    opening_balance_cents: int
    # French. Non-null exactly when `months` is empty.
    insufficient_reason: str | None


def _is_projected(recurrence: Recurrence) -> bool:
    """Whether this recurrence is carried into the future at all.

    Two gates, and both are inherited rather than invented here:

    * `annualisable` -- task 8's rule, "you may not multiply to a year what you
      watched for less than a quarter". `RecurrenceReport.recurring_keys` already
      excludes these, and letting them through here would push the same unearned
      claim into the forecast by another door;
    * `status != "ended"` -- a cancelled subscription is not a future charge.

    **This predicate governs both halves of the split**, and that symmetry is
    what stops money going missing: `residual_entries` withholds a row if and
    only if the recurrence withholding it is also projected forward. An ended or
    too-young recurrence is projected nowhere, so its historical rows stay in the
    residual and go on weighing exactly as much as they did -- which errs
    pessimistic, the right direction for a floor warning built on a status that
    is itself a heuristic over a sparse ledger.
    """
    return recurrence.annualisable and recurrence.status != "ended"


def residual_entries(
    entries: list[LedgerEntry], recurrences: list[Recurrence]
) -> list[MonthlyEntry]:
    """The ledger with the projected recurring rows taken out, ready for
    `capacity.complete_months`.

    **Do not do this by key.** `RecurrenceReport.recurring_keys` is authoritative
    only over each recurrence's own `[first_on, last_on]` window, because
    `_analysable_run` cuts a group at its last hole: for a subscription that
    lapsed and resumed, the pre-lapse rows were never analysed, are never
    projected forward, and are not represented anywhere in the recurrence half of
    the forecast. Dropping them by bare key removes them from the residual too,
    on the authority of a run that excluded them, and real spending vanishes from
    both sides at once. So the subtraction is windowed, per recurrence.

    Rows carrying a recurrence's key but falling outside its analysed window are
    ordinary spending as far as this engine is concerned, and stay in the
    residual where the month's own median can weigh them.
    """
    windows: dict[str, list[tuple[date, date]]] = {}
    for item in recurrences:
        if not _is_projected(item):
            continue
        windows.setdefault(item.label_key, []).append((item.first_on, item.last_on))

    residual: list[MonthlyEntry] = []
    for entry in entries:
        spans = windows.get(entry.label_key)
        if spans and any(start <= entry.on <= end for start, end in spans):
            continue
        residual.append(MonthlyEntry(on=entry.on, amount_cents=entry.amount_cents))
    return residual


def _month_index(on: date) -> int:
    """Months since year 0, so periodicity arithmetic never touches day-of-month."""
    return on.year * 12 + on.month - 1


def _future_month_keys(today: date, horizon_months: int) -> list[str]:
    """The `horizon_months` months after today's, starting with the next one.

    The current month is excluded on purpose: part of it has already happened, so
    projecting it would mix a measured past with an estimated future inside one
    bar. A charge already overdue at `today` therefore belongs to that excluded
    present and is not projected -- it is not lost, it is simply not in the
    future.
    """
    keys: list[str] = []
    year, month = today.year, today.month
    for _ in range(horizon_months):
        month += 1
        if month > 12:
            month, year = 1, year + 1
        keys.append(f"{year}-{month:02d}")
    return keys


def _recurring_by_month(
    recurrences: list[Recurrence], keys: list[str], horizon_start: date, horizon_end: date
) -> dict[str, int]:
    """Bin every projected recurrence's future charges into the horizon months.

    Calendar periodicities are resolved in closed form on the month index -- no
    walk, no drift, no month billed twice. Weekly and biweekly are stepped in
    days from their own anchor, which is what they genuinely do; the walk starts
    at the first occurrence inside the horizon and is bounded by it.
    """
    totals = dict.fromkeys(keys, 0)
    indexed = [(key, _month_index(bucket_bounds(key, "month")[0])) for key in keys]
    for item in recurrences:
        if not _is_projected(item):
            continue
        step_months = CALENDAR_MONTHS_PER_PERIOD.get(item.periodicity)
        if step_months is not None:
            anchor = _month_index(item.expected_next_on)
            for key, month_index in indexed:
                offset = month_index - anchor
                if offset >= 0 and offset % step_months == 0:
                    totals[key] += item.amount_cents
            continue

        step_days = PERIOD_BOUNDS[item.periodicity][0]
        anchor_on = item.expected_next_on
        lag_days = (horizon_start - anchor_on).days
        # Ceiling division, so the walk opens on the first occurrence at or
        # after the horizon rather than crawling up from an overdue anchor.
        index = max(0, -(-lag_days // step_days))
        occurrence = anchor_on + timedelta(days=index * step_days)
        while occurrence <= horizon_end:
            totals[bucket_key(occurrence, "month")] += item.amount_cents
            index += 1
            occurrence = anchor_on + timedelta(days=index * step_days)
    return totals


def _reason_short_ledger(observed: int) -> str:
    return (
        f"Pas assez de données pour projeter : il faut au moins "
        f"{MIN_MONTHS_FOR_FORECAST} mois complets de relevés, et l'historique "
        f"n'en compte que {observed}. Importez des relevés supplémentaires pour "
        "obtenir une prévision."
    )


def _reason_thin_residual(observed: int, ledger_months: int) -> str:
    # Zero is the likeliest value here, not an edge case: it is exactly what a
    # household whose every charge is recurring produces.
    if observed == 0:
        carrying = "mais aucun ne porte d'opération non récurrente"
    elif observed == 1:
        carrying = "mais un seul porte des opérations non récurrentes"
    else:
        carrying = f"mais seuls {observed} d'entre eux portent des opérations non récurrentes"
    return (
        f"Prévision impossible : l'historique couvre {ledger_months} mois complets, "
        f"{carrying} — il en faut au moins {MIN_MONTHS_FOR_FORECAST} pour mesurer "
        "la part variable des dépenses. Presque toutes les opérations sont déjà "
        "rattachées à une récurrence détectée : il n'y a pas de quoi estimer une "
        "marge d'erreur autour d'elles."
    )


def _reason_no_dispersion(observed: int) -> str:
    return (
        f"Impossible de mesurer un intervalle de confiance : les {observed} mois "
        "observés ne varient pas d'un mois à l'autre, il n'y a donc aucune "
        "dispersion à mesurer. Une projection sans marge d'erreur donnerait une "
        "fausse impression de certitude, elle n'est pas affichée."
    )


def _refusal(
    balance_cents: int,
    observed: int,
    ledger_months: int,
    threshold_cents: int,
    reason: str,
) -> ForecastReport:
    return ForecastReport(
        months=[],
        months_observed=observed,
        ledger_months_observed=ledger_months,
        seasonality_used=False,
        recurrences_projected=0,
        residual_scale_cents=0,
        threshold_cents=threshold_cents,
        first_breach_key=None,
        opening_balance_cents=balance_cents,
        insufficient_reason=reason,
    )


def project_cashflow(
    balance_cents: int,
    residual_observations: list[MonthObservation],
    recurrences: list[Recurrence],
    today: date,
    horizon_months: int = DEFAULT_HORIZON_MONTHS,
    threshold_cents: int = 0,
    ledger_months_observed: int | None = None,
) -> ForecastReport:
    """Project the balance forward as a P10/P50/P90 band.

    `residual_observations` must be `complete_months` over `residual_entries` --
    the ledger with the projected recurring rows windowed out. Feed it the whole
    history and the rent is counted twice, once as a recurrence and again inside
    the month's own average.

    `ledger_months_observed` is `complete_months` over the *unfiltered* ledger,
    and callers should pass it. The two counts differ whenever a month's whole
    activity was recurring: that month carries no residual, so it is absent from
    `residual_observations` entirely. Without the real ledger count a refusal
    would tell a reader holding a year of statements to import more of them --
    naming a cause that is not the cause, which is the defect task 10's review
    fixed in `runway.py`. Omitted, it defaults to the residual count and the
    engine simply cannot tell the two cases apart.

    **How wide the band is, and why.** Write the balance at month *k* as the
    opening balance plus the recurring charges plus *k* draws from the residual,
    each modelled as a centre `mu` we do not know plus noise of scale `sigma`.
    We project using an estimated centre `mu_hat`, so the error is

        sum(noise) + k * (mu - mu_hat)

    whose variance is `k * sigma^2` from the noise plus `k^2 * Var(mu_hat)` from
    the centre. Two things follow, and both matter:

    * the noise term grows as *k*, so the band widens with distance -- a constant
      ribbon would claim month twelve is as knowable as month one;
    * the centre term grows as *k squared*, because an error in the centre is
      systematic and compounds every month rather than averaging out. It is
      divided by the number of observed months, so **the band is materially
      wider on six months of history than on twelve**. A band that ignored this
      would draw the same ribbon whether the reader had half a year of
      statements or five, which is decoration, not a confidence interval.

    Pooled months all share one estimate, so their centre errors add before being
    squared; seasonal months are estimated from disjoint samples, so theirs add
    after. `sigma` is measured on the deviations from whichever centre each month
    actually used, so a genuine seasonal swing counts as signal once it has been
    modelled, and not a second time as noise.

    The estimated scale is treated as known. At six observations it carries
    roughly 30 % relative error of its own, which nothing here prices in -- that
    limitation is the reason `MIN_MONTHS_FOR_FORECAST` is 6 and not 3.
    """
    if not 1 <= horizon_months <= MAX_HORIZON_MONTHS:
        raise ValueError(
            f"L'horizon de projection doit être compris entre 1 et "
            f"{MAX_HORIZON_MONTHS} mois (reçu : {horizon_months})."
        )

    observed = len(residual_observations)
    ledger_months = observed if ledger_months_observed is None else ledger_months_observed
    if ledger_months < observed:
        raise ValueError(
            f"L'historique ne peut pas compter moins de mois complets "
            f"({ledger_months}) que le résidu qui en a été extrait ({observed})."
        )

    if observed < MIN_MONTHS_FOR_FORECAST:
        # Two distinct causes, and the reader can only act on one of them.
        reason = (
            _reason_thin_residual(observed, ledger_months)
            if ledger_months >= MIN_MONTHS_FOR_FORECAST
            else _reason_short_ledger(observed)
        )
        return _refusal(balance_cents, observed, ledger_months, threshold_cents, reason)

    nets = [observation.net_cents for observation in residual_observations]
    pooled = median_cents(nets)

    by_calendar_month: dict[int, list[int]] = {}
    for observation in residual_observations:
        by_calendar_month.setdefault(observation.start.month, []).append(
            observation.net_cents
        )

    def centre_of(calendar_month: int) -> tuple[int, bool, int]:
        """(residual, seasonal, sample size) for one calendar month."""
        samples = by_calendar_month.get(calendar_month, [])
        if len(samples) >= MIN_OBSERVATIONS_FOR_SEASONALITY:
            return median_cents(samples), True, len(samples)
        return pooled, False, observed

    # The scale of what the model does *not* explain: each month's distance from
    # the centre that month will actually be projected with. Identical to the
    # dispersion of the nets themselves when no seasonality is used, and properly
    # narrower when it is.
    deviations = [
        observation.net_cents - centre_of(observation.start.month)[0]
        for observation in residual_observations
    ]
    sigma = describe(deviations).sigma
    if sigma == 0:
        # No dispersion at all. `robust.modified_z` refuses the same input for
        # the same reason: with every observation identical there is no scale to
        # measure against, and any band drawn here would be manufactured.
        return _refusal(
            balance_cents, observed, ledger_months, threshold_cents,
            _reason_no_dispersion(observed),
        )

    keys = _future_month_keys(today, horizon_months)
    horizon_start = bucket_bounds(keys[0], "month")[0]
    horizon_end = bucket_bounds(keys[-1], "month")[1]
    recurring = _recurring_by_month(recurrences, keys, horizon_start, horizon_end)

    months: list[ForecastMonth] = []
    seasonality_used = False
    running = balance_cents
    first_breach: str | None = None
    # Months so far drawing on the single pooled estimate: their centre errors
    # are the same error and add before squaring.
    pooled_months = 0
    # Months so far drawing on their own calendar month's estimate: independent,
    # so their variances add directly. A ratio, not money -- float is correct.
    seasonal_variance_units = 0.0

    for index, key in enumerate(keys):
        start, end = bucket_bounds(key, "month")
        residual, seasonal, samples = centre_of(start.month)
        seasonality_used = seasonality_used or seasonal
        if seasonal:
            seasonal_variance_units += 1 / samples
        else:
            pooled_months += 1

        recurring_cents = recurring[key]
        net = recurring_cents + residual
        running += net

        centre_units = MEDIAN_VARIANCE_FACTOR * (
            pooled_months**2 / observed + seasonal_variance_units
        )
        spread_factor = math.sqrt((index + 1) + centre_units)
        # One rounding, straight back to integer cents: `quantile_offset_cents`
        # takes the number of sigmas precisely so a caller can scale the band
        # without ever holding a monetary float.
        half_width = quantile_offset_cents(sigma, P90_SIGMAS * spread_factor)
        low = running - half_width
        high = running + half_width

        # The alert fires on the LOW estimate, not the median: the reader wants
        # to know when the balance *could* go under, not when it probably
        # already has.
        breached = low < threshold_cents
        if breached and first_breach is None:
            first_breach = key

        months.append(ForecastMonth(
            key=key, start=start, end=end,
            recurring_cents=recurring_cents,
            residual_cents=residual,
            net_p50_cents=net,
            balance_p10_cents=low,
            balance_p50_cents=running,
            balance_p90_cents=high,
            below_threshold=breached,
            seasonal=seasonal,
        ))

    return ForecastReport(
        months=months,
        months_observed=observed,
        ledger_months_observed=ledger_months,
        seasonality_used=seasonality_used,
        recurrences_projected=sum(1 for item in recurrences if _is_projected(item)),
        residual_scale_cents=sigma,
        threshold_cents=threshold_cents,
        first_breach_key=first_breach,
        opening_balance_cents=balance_cents,
        insufficient_reason=None,
    )
