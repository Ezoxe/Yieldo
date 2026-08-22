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
from app.engines.capacity import MonthlyEntry, MonthObservation, complete_months
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
class ResidualHistory:
    """The measured history `project_cashflow` runs on: the residual months, and
    how many complete months the ledger they came out of actually covers.

    The two travel together **on purpose**. They are different numbers (a month
    whose whole activity was recurring carries no residual and is absent from
    `observations`), the engine needs both to name the right cause when it
    refuses, and a caller holding two loose values will eventually pass one and
    forget the other. Build it with `build_observations` rather than by hand.
    """

    observations: list[MonthObservation]
    ledger_months_observed: int

    def __post_init__(self) -> None:
        if self.ledger_months_observed < len(self.observations):
            raise ValueError(
                f"L'historique ne peut pas compter moins de mois complets "
                f"({self.ledger_months_observed}) que le résidu qui en a été "
                f"extrait ({len(self.observations)})."
            )


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
    # The two scales the band is built from, published so a screen can explain a
    # band without re-measuring it. They answer different questions and are
    # measured over different populations -- see `project_cashflow`.
    #
    # What a month varies by, month to month, seasonal swing included. The scale
    # for every projected month that has no seasonal estimate of its own.
    # 0 on a refusal, where nothing was measured -- read `insufficient_reason`
    # first, never this field on its own.
    pooled_scale_cents: int
    # What a given calendar month varies by against itself, year on year. The
    # scale for months projected seasonally. None when no observed calendar month
    # reached `MIN_OBSERVATIONS_FOR_SEASONALITY`, so nothing measured it -- None
    # rather than 0, because "not measured" and "measured as zero" are different
    # answers and only the second is a reason to refuse.
    seasonal_scale_cents: int | None
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


def build_observations(
    entries: list[LedgerEntry],
    recurrences: list[Recurrence],
    ledger_start: date,
    ledger_end: date,
) -> ResidualHistory:
    """Everything `project_cashflow` needs from a ledger, in one call.

    This is the whole of what a caller has to do, and it exists so that the two
    ways of getting the split wrong are unrepresentable rather than merely
    documented: the residual is windowed here (see `residual_entries`), and the
    ledger's own month count is measured here over the *same* bounds, so it
    cannot be forgotten, mismatched, or filled in with the residual count.

    **`ledger_start` / `ledger_end` must be the actual extent of the imported
    data** -- the minimum and maximum transaction date genuinely covered by
    imported statements -- never a requested display window such as a "last 12
    months" filter or a date-range picker. `complete_months` cannot tell the two
    apart: it only checks a month's calendar bounds against these, so bounds
    wider than the data really covers silently admit a month holding one week of
    statements as a complete one. That defeats the partial-month guard from the
    caller's side and makes every rate measured downstream a fraction of the
    truth. Task 10 carried this precondition forward; it binds here too, and it
    binds both of the counts below at once.
    """
    ledger = complete_months(
        [MonthlyEntry(on=entry.on, amount_cents=entry.amount_cents) for entry in entries],
        ledger_start,
        ledger_end,
    )
    residual = complete_months(
        residual_entries(entries, recurrences), ledger_start, ledger_end
    )
    return ResidualHistory(
        observations=residual, ledger_months_observed=len(ledger)
    )


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
        pooled_scale_cents=0,
        seasonal_scale_cents=None,
        threshold_cents=threshold_cents,
        first_breach_key=None,
        opening_balance_cents=balance_cents,
        insufficient_reason=reason,
    )


def project_cashflow(
    balance_cents: int,
    history: ResidualHistory,
    recurrences: list[Recurrence],
    today: date,
    horizon_months: int = DEFAULT_HORIZON_MONTHS,
    threshold_cents: int = 0,
) -> ForecastReport:
    """Project the balance forward as a P10/P50/P90 band.

    `history` comes from `build_observations`, which is the only call a caller
    needs to make. It carries the residual months -- the ledger with the
    projected recurring rows windowed out -- together with the ledger's own
    complete-month count, because the engine needs both and they are not the same
    number.

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
    after.

    **Two scales, because there are two different claims.** A month projected
    from its own calendar month's median is uncertain by how much that month
    varies year on year (`seasonal_scale_cents`). A month projected from the
    pooled median is uncertain by how much *any* month varies, seasonal swing
    included, because that swing is precisely what has not been explained for it
    (`pooled_scale_cents`). Each is measured over the observations that bear on
    it, and each month is priced against the one whose centre it actually got.

    Measuring a single scale across both populations is the trap: with, say,
    eighteen observed months, six calendar months have two samples and six have
    one, and the tight seasonally-explained deviations dominate a MAD taken over
    the mixture. The six fallback months -- the least knowable months in the
    horizon -- would then be wrapped in a band sized by the jitter of the months
    the model *did* explain. `ForecastMonth.seasonal` would say False for them,
    but the band would not widen to say so, and a band that fails to widen where
    the estimate is weakest is decoration.

    Both cases collapse back to a single scale: with no seasonality every month
    uses the pooled one, and with every horizon month seasonal every month uses
    the seasonal one. The algebra is identical to the single-scale form that
    preceded it -- subtracting a constant from every value shifts the median by
    that same constant, leaving the MAD untouched -- but the arithmetic is not
    quite: the variance is now accumulated and rounded to whole cents before
    `quantile_offset_cents` scales it, where a single factored-out sigma was
    rounded once. A published band can therefore sit one cent off the figure the
    single-scale form produced. Same model, one extra rounding.

    A calendar month eligible for a seasonal centre whose samples never actually
    move yields no usable scale, and falls back to the pooled centre and scale
    rather than refusing -- see the `seasonal_scale` assignment.

    The estimated scale is treated as known. At six observations it carries
    roughly 30 % relative error of its own, which nothing here prices in -- that
    limitation is the reason `MIN_MONTHS_FOR_FORECAST` is 6 and not 3.
    """
    if not 1 <= horizon_months <= MAX_HORIZON_MONTHS:
        raise ValueError(
            f"L'horizon de projection doit être compris entre 1 et "
            f"{MAX_HORIZON_MONTHS} mois (reçu : {horizon_months})."
        )

    residual_observations = history.observations
    observed = len(residual_observations)
    ledger_months = history.ledger_months_observed

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
    # What a month varies by, month to month. Seasonal swing is *included*: for a
    # calendar month we cannot explain, "how much does a month cost" is exactly
    # the uncertainty we carry.
    pooled_scale = describe(nets).sigma

    by_calendar_month: dict[int, list[int]] = {}
    for observation in residual_observations:
        by_calendar_month.setdefault(observation.start.month, []).append(
            observation.net_cents
        )

    if pooled_scale == 0:
        # Every observed month is identical to the cent, so there is no scale to
        # measure against anywhere and any band drawn would be manufactured.
        # `robust.modified_z` refuses the same input for the same reason. This is
        # the *only* degenerate case that can refuse: a degenerate seasonal scale
        # is handled by falling back, below, and `pooled_scale == 0` implies every
        # seasonal deviation is 0 too, so this branch subsumes it.
        return _refusal(
            balance_cents, observed, ledger_months, threshold_cents,
            _reason_no_dispersion(observed),
        )

    def eligible(calendar_month: int) -> bool:
        """Whether this calendar month has been seen often enough to have a
        centre of its own. Eligibility is about sample *count*; whether a usable
        scale came out of those samples is decided once, below."""
        samples = by_calendar_month.get(calendar_month, [])
        return len(samples) >= MIN_OBSERVATIONS_FOR_SEASONALITY

    # What a calendar month varies by against *itself*, measured only over the
    # observations that have such a centre. Measuring one scale across both
    # populations would let these tight, seasonally-explained deviations dominate
    # the MAD and then price the fallback months -- the least known months in the
    # horizon -- with it.
    seasonal_deviations = [
        observation.net_cents - median_cents(by_calendar_month[observation.start.month])
        for observation in residual_observations
        if eligible(observation.start.month)
    ]
    seasonal_scale: int | None = None
    if seasonal_deviations:
        # `describe(...).sigma` is 0 only when every value is identical, so a zero
        # here means every doubled calendar month repeated to the cent. A calendar
        # month whose samples never move tells us nothing about how *that* month
        # varies, so there is no seasonal estimate to price it against and it
        # belongs on the pooled centre and scale like any other month the model
        # cannot explain. Refusing the whole projection instead would be a total
        # feature loss over a condition that says nothing about the validity of
        # the other months -- and it is reachable at thirteen observed months,
        # where a single doubled calendar month decides it.
        seasonal_scale = describe(seasonal_deviations).sigma or None

    def centre_of(calendar_month: int) -> tuple[int, bool, int]:
        """(residual, seasonal, sample size) for one calendar month."""
        if seasonal_scale is not None and eligible(calendar_month):
            samples = by_calendar_month[calendar_month]
            return median_cents(samples), True, len(samples)
        return pooled, False, observed

    keys = _future_month_keys(today, horizon_months)
    horizon_start = bucket_bounds(keys[0], "month")[0]
    horizon_end = bucket_bounds(keys[-1], "month")[1]
    recurring = _recurring_by_month(recurrences, keys, horizon_start, horizon_end)

    months: list[ForecastMonth] = []
    seasonality_used = False
    running = balance_cents
    first_breach: str | None = None
    # Months so far drawing on the single pooled estimate: their centre errors
    # are the same error, so they add before squaring.
    pooled_months = 0
    # Accumulated variance, in cents squared. Two scales now flow into it, so
    # neither can be factored out of the sqrt the way a single one could.
    noise_variance = 0.0
    seasonal_centre_variance = 0.0

    for key in keys:
        start, end = bucket_bounds(key, "month")
        residual, seasonal, samples = centre_of(start.month)
        seasonality_used = seasonality_used or seasonal
        # Each month is priced against the scale of the centre it actually got:
        # a month with no seasonal estimate is projected from the pooled median,
        # so its uncertainty is the full month-to-month spread, not the tight
        # year-on-year one that belongs to months the model did explain.
        if seasonal:
            month_scale = seasonal_scale
            seasonal_centre_variance += (
                MEDIAN_VARIANCE_FACTOR * month_scale**2 / samples
            )
        else:
            month_scale = pooled_scale
            pooled_months += 1
        noise_variance += month_scale**2

        recurring_cents = recurring[key]
        net = recurring_cents + residual
        running += net

        centre_variance = (
            MEDIAN_VARIANCE_FACTOR * pooled_months**2 * pooled_scale**2 / observed
            + seasonal_centre_variance
        )
        # Back to integer cents at the combined standard deviation, which is
        # itself a cents quantity, before `quantile_offset_cents` turns it into a
        # band half-width. No monetary value is ever stored as a float.
        #
        # Bare `round()` is banker's rounding, which this repository otherwise
        # avoids -- `robust._half` and `recurrence._divide` both exist because
        # rounding a signed amount to even biases a series of expenses one way
        # and a series of incomes the other. Nothing to bias here: this is a
        # square root of a sum of squares, so it is non-negative by construction
        # and never a signed amount. A half-cent tie resolves to even rather than
        # away from zero, which moves a band edge by at most one cent and cannot
        # accumulate a direction. `robust.describe` rounds its own sigma the same
        # way, for the same reason.
        combined_scale = round(math.sqrt(noise_variance + centre_variance))
        half_width = quantile_offset_cents(combined_scale, P90_SIGMAS)
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
        pooled_scale_cents=pooled_scale,
        seasonal_scale_cents=seasonal_scale,
        threshold_cents=threshold_cents,
        first_breach_key=first_breach,
        opening_balance_cents=balance_cents,
        insufficient_reason=None,
    )
