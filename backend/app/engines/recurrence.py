"""Recurrence detection. Pure: no session, no network, no implicit clock."""

from collections import Counter
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from app.engines.robust import Spread, describe


@dataclass(frozen=True)
class RecurringTx:
    """The minimal shape recurrence detection needs. Deliberately not an ORM object.

    `label_key` is the normalised grouping key, computed by the caller from
    `label_raw` -- never read from the stored `label_clean`, whose contents
    depend on which importer version wrote the row.
    """

    on: date
    amount_cents: int
    label_key: str
    label_raw: str
    category_id: int | None


Periodicity = Literal["weekly", "biweekly", "monthly", "quarterly", "yearly"]
RecurrenceStatus = Literal["active", "missing", "ended"]
Confidence = Literal["probable", "confirmed"]

# (name, nominal interval in days, tolerance in days). The tolerances do not
# overlap -- [5,9], [11,17], [25,35], [81,101], [335,395] -- so a median
# interval matches at most one shape and there is no precedence to argue about.
# 30 +/- 5 covers every calendar month plus the weekend drift a direct debit
# picks up when the due date falls on a Saturday.
PERIODS: tuple[tuple[Periodicity, int, int], ...] = (
    ("weekly", 7, 2),
    ("biweekly", 14, 3),
    ("monthly", 30, 5),
    ("quarterly", 91, 10),
    ("yearly", 365, 30),
)

PERIOD_BOUNDS: dict[Periodicity, tuple[int, int]] = {
    name: (nominal, tolerance) for name, nominal, tolerance in PERIODS
}

OCCURRENCES_PER_YEAR: dict[Periodicity, int] = {
    "weekly": 52, "biweekly": 26, "monthly": 12, "quarterly": 4, "yearly": 1,
}

# Three charges give two intervals -- the minimum from which regularity can be
# tested at all. Two charges give one interval and no way to tell a rhythm from
# a coincidence, so two is never a recurrence.
MIN_OCCURRENCES = 3
# Four or more, having already passed the regularity test, is called confirmed.
# Exactly three is reported as probable and the screen says so.
CONFIRMED_OCCURRENCES = 4

# How far the intervals may wander from their own median and still count as
# regular: a quarter of the period, with a two-day floor so a weekly charge is
# not held to 1.75 days.
MAX_INTERVAL_MAD_RATIO = 0.25
MIN_INTERVAL_MAD_DAYS = 2

# The longest single gap a rhythm may be claimed across, in whole periods. The
# MAD above tests the *typical* interval and, being a median, is blind to a
# minority of gaps however enormous: eight small gaps and four huge ones give a
# small MAD, so a merchant charged in two dense bursts either side of an empty
# year passes the wobble test and is announced as a weekly subscription. It is
# the exact confident-from-nothing answer this engine exists to refuse, so every
# gap is checked, not only the middle one.
#
# Two periods, the same line the `ended` status draws: one missed cycle is a
# failed payment and the subscription continues; a silence longer than the
# window in which we would have pronounced it dead is a hole, and a rhythm
# cannot be claimed across a hole.
MAX_GAP_PERIODS = 2

# You may not multiply to a year what you watched for less than a quarter.
#
# Detection and annualisation are different claims and this engine had been
# treating them as one. Six card purchases three weeks apart in December are
# genuinely a weekly-shaped series -- refusing to detect them would be its own
# lie -- but multiplying their median by 52 turns three weeks of Christmas
# shopping into an 8 365 EUR "subscription". So the series is still reported;
# only the extrapolation is withheld, along with a place in any total and in
# `recurring_keys`, which is what carries a label into the cash-flow forecast.
#
# One quarter, reusing the quarterly period's own nominal rather than inventing
# a number: below it, not one full billing quarter of the behaviour has been
# seen, and there is nothing to project twelve months from.
MIN_ANNUALISATION_SPAN_DAYS = PERIOD_BOUNDS["quarterly"][0]

# A level change below 2 % is rounding, a VAT tweak or a partial month -- not a
# price rise worth telling anyone about.
PRICE_CHANGE_MIN_RATIO = 0.02

# And a rise that costs less than this over a YEAR is not worth telling anyone
# about either, whatever its percentage.
#
# Found by the audit of 2026-09-06: the only alert an eighteen-month ledger
# raised was a sports-shop charge going from 28,07 EUR to 28,70 EUR -- +2,2 %,
# and sixty-three centimes. True, and worth nobody's attention. The relative
# floor above is blind to it precisely because 2 % of a small charge is small
# in euros too.
#
# Judged over a year rather than per instalment, because that is where the
# money is felt and because the two are not the same fact: 63 centimes once a
# month is 7,56 EUR a year and changes nothing, the same 63 centimes every week
# is 32,76 EUR and is a real subscription drift. Twelve euros is one euro a
# month -- the smallest rise on a monthly charge anyone would act on.
PRICE_CHANGE_MIN_ANNUAL_CENTS = 1_200
# Two occurrences on each side: one charge at a new amount is an adjustment,
# two is a level.
MIN_SIDE_OCCURRENCES = 2


@dataclass(frozen=True)
class PriceChange:
    previous_cents: int
    current_cents: int
    changed_on: date
    # A ratio, not money: 0.185 is +18,5 %. Measured on the *level*, so a charge
    # growing from -13,49 EUR to -15,99 EUR is +18,5 %, the same sign a salary
    # rise would carry. Signed -- a fall is a real result.
    ratio: float
    # Index, within the recurrence's own occurrences, of the first charge at the
    # new level. What lets the caller take the current level rather than the
    # median of the whole history.
    occurrence_index: int


@dataclass(frozen=True)
class Recurrence:
    label_key: str
    # The most recent raw label, for display. The key is for grouping only.
    label: str
    category_id: int | None
    periodicity: Periodicity
    occurrences: int
    first_on: date
    last_on: date
    median_interval_days: int
    # The level billed *now*: after a price rise this is the new price, not the
    # median of the whole history. Signed -- negative for an expense.
    amount_cents: int
    # MAD of the amounts at the current level: how much this charge wobbles.
    amount_spread_cents: int
    # This recurrence annualised at its current level, signed. A property of the
    # recurrence itself -- the report's subscription total decides separately
    # which of these to add up.
    annual_cents: int
    # How much of the calendar the analysed run actually covers. After a lapse
    # this is the trailing run's span, not the whole group's.
    observed_span_days: int
    # Whether `annual_cents` may be extrapolated from at all. False when the run
    # spans less than `MIN_ANNUALISATION_SPAN_DAYS`. `annual_cents` is published
    # either way -- the rate is a fact about what was seen -- but when this is
    # False the report keeps it out of every total and out of `recurring_keys`,
    # and the screen must present the recurrence as observed, not as a yearly
    # cost. A subscription is not the same claim as a rhythm.
    annualisable: bool
    expected_next_on: date
    status: RecurrenceStatus
    confidence: Confidence
    price_change: PriceChange | None


@dataclass(frozen=True)
class RecurrenceReport:
    recurrences: list[Recurrence]
    # The label keys that belong to a detected recurrence. The cash-flow
    # forecast subtracts these rows from the historical series before measuring
    # its residual, so a rent payment is not counted once as a recurrence and
    # again inside the month's average.
    # Only the annualisable ones: a label that has not been watched for a
    # quarter cannot be projected forward either, and letting it through here
    # would push the same unearned claim into the forecast by another door.
    #
    # A key is authoritative only over its own recurrence's `[first_on, last_on]`
    # window, never over every row that ever carried the label. After a lapse
    # the analysis ran on the trailing run alone, so a consumer that subtracts
    # by key would remove pre-lapse rows the analysis deliberately excluded.
    recurring_keys: frozenset[str]
    # Live expense recurrences only, annualised. Signed (negative).
    annual_subscription_cents: int
    monthly_subscription_cents: int
    analysed_groups: int
    rejected_thin: int
    rejected_irregular: int
    # French, and not None whenever nothing at all was detected: an empty list
    # with no explanation reads as "you have no subscriptions", which is a
    # different claim from "your history is too sparse to tell".
    notice: str | None


def _divide(total: int, divisor: int) -> int:
    """Integer division rounded half away from zero. Money never goes float."""
    quotient, remainder = divmod(abs(total), divisor)
    magnitude = quotient + (1 if remainder * 2 >= divisor else 0)
    return magnitude if total >= 0 else -magnitude


def classify_period(median_interval_days: int) -> Periodicity | None:
    """The billing rhythm a median interval matches, or None.

    None rather than the nearest match: a 20-day rhythm is not something anyone
    bills on, and rounding it to "monthly" would manufacture a subscription out
    of shopping noise.
    """
    for name, nominal, tolerance in PERIODS:
        if abs(median_interval_days - nominal) <= tolerance:
            return name
    return None


def _analysable_run(dates: list[date]) -> tuple[int, Periodicity, Spread] | None:
    """The trailing stretch one rhythm can actually be claimed across.

    Returns the index that stretch starts at, the rhythm it keeps and the spread
    of its intervals -- or None when no stretch of it supports a rhythm at all.

    A hole is not a reason to throw the whole label away. Five clean years of
    Netflix with a three-month lapse in 2022, an expired card and a
    re-subscription, is still a live subscription today; reporting nothing at
    all, forever, because of one old interruption would be its own wrong answer,
    and the odds of some such hole only grow as a ledger lengthens. So the series
    is cut at its *last* hole and what follows is described on its own terms --
    which is why the caller must take its occurrence count, its first date and
    its price history from the run and not from the whole group.

    A gap counts as a hole past `MAX_GAP_PERIODS` of the rhythm's own nominal
    plus its tolerance, so no threshold is invented here: a monthly charge may
    skip one month (65 days), a weekly one one week (16 days), neither a year.

    Re-cut until stable, because trimming changes the median, which can change
    the rhythm, which changes what counts as a hole. Every pass strictly shortens
    the run, so this ends -- at the latest when fewer than `MIN_OCCURRENCES`
    remain and there is nothing left to describe.
    """
    start = 0
    while len(dates) - start >= MIN_OCCURRENCES:
        run = dates[start:]
        intervals = [(run[i] - run[i - 1]).days for i in range(1, len(run))]
        spread = describe(intervals)
        periodicity = classify_period(spread.median)
        if periodicity is None:
            return None
        nominal, tolerance = PERIOD_BOUNDS[periodicity]
        longest_gap = MAX_GAP_PERIODS * nominal + tolerance
        if max(intervals) <= longest_gap:
            return start, periodicity, spread
        last_hole = max(index for index, gap in enumerate(intervals) if gap > longest_gap)
        start += last_hole + 1
    return None


def find_price_change(
    amounts: list[int], dates: list[date], min_step_cents: int = 0
) -> PriceChange | None:
    """The clearest sustained level change in a series of charges, if any.

    Every split with at least `MIN_SIDE_OCCURRENCES` charges on each side is
    tried. A split only qualifies if the step clears THREE floors: a relative
    one (2 %, so rounding is not a rise), an absolute one in cents
    (`min_step_cents`, which the caller derives from the rhythm so materiality
    is judged over a year rather than per instalment), and the series' own noise
    (twice the larger of the two sides' MAD, so a charge that always wobbles is
    not read as having jumped). A split whose two sides disagree in sign never
    qualifies, because a label mixing charges and refunds has no single price
    level to speak of.

    `min_step_cents` defaults to 0, which is no absolute floor at all: this
    function answers "where did the level change", and how big a change has to
    be before it deserves a sentence is the caller's judgement, not this
    search's.

    The winner is the qualifying split with the largest step *net of the scatter
    it leaves behind* -- `|step| - (mean absolute deviation of each side)`. Size
    of step alone is not enough to pick the date: a median ignores a minority of
    contaminating values, so four charges at 13,49 EUR followed by four at
    15,99 EUR show the same 250-cent step at splits 2, 3, 4, 5 and 6. Only split
    4 leaves both sides perfectly flat, and only split 4 is the month the price
    actually changed. A tie keeps the earliest split, so the answer is a
    function of the data alone and not of the order the splits were tried in.
    """
    best: PriceChange | None = None
    best_score: int | None = None
    for split in range(MIN_SIDE_OCCURRENCES, len(amounts) - MIN_SIDE_OCCURRENCES + 1):
        before = describe(amounts[:split])
        after = describe(amounts[split:])
        if before.median == 0 or after.median == 0:
            continue
        if (before.median > 0) != (after.median > 0):
            # Charges on one side, refunds on the other: not a price level.
            continue
        # Measured on the level, not the signed amount, so an expense growing
        # from -13,49 to -15,99 EUR is +18,5 % and not -18,5 %.
        step = abs(after.median) - abs(before.median)
        ratio = step / abs(before.median)
        if abs(ratio) < PRICE_CHANGE_MIN_RATIO or abs(step) < min_step_cents:
            continue
        if abs(step) <= 2 * max(before.mad, after.mad):
            continue
        score = abs(step) - before.mean_ad - after.mean_ad
        if best_score is None or score > best_score:
            best_score = score
            best = PriceChange(
                previous_cents=before.median,
                current_cents=after.median,
                changed_on=dates[split],
                ratio=ratio,
                occurrence_index=split,
            )
    return best


def detect_recurrences(
    transactions: list[RecurringTx], today: date
) -> RecurrenceReport:
    """Group, test for regularity, and describe what survives.

    Detecting a rhythm and costing a year are two different claims, and only the
    first is made from a short window: **you may not multiply to a year what you
    watched for less than a quarter.** A run under `MIN_ANNUALISATION_SPAN_DAYS`
    is still detected and still returned, carrying `annualisable=False`, but it
    is kept out of the subscription totals and out of `recurring_keys`.

    Grouping is by label key **alone**, never by label and amount together: a
    price rise is a change of amount inside one recurrence, and grouping on
    amount would split Netflix in two and then be unable to notice that one
    replaced the other. Amount is used *within* a group instead, to locate the
    level change.

    Two known limitations of that key, documented rather than patched, and they
    run in opposite directions.

    It can **fragment**: a bank that appends a varying reference which
    `normalize_label` does not strip splits one subscription into several groups,
    each too thin to qualify. The engine then reports nothing rather than
    something wrong, which is the failure worth having.

    It can also **collide**, and that one is not safe on its own.
    `normalize_label` strips `carte 1234`, so every cash withdrawal in the ledger
    collapses to the single key `retrait dab`. Weekly withdrawals of wildly
    varying size are one group with a clean weekly rhythm and no hole, and
    nothing in here refuses them: no gate in this engine looks at amount
    stability, so `annual_cents` would be 52 times the median withdrawal, ready
    to be presented as a subscription. `Recurrence.amount_spread_cents` is
    published for exactly this reason, and **the caller must use it** before
    putting any of this under a heading that says "abonnements".
    """
    groups: dict[str, list[RecurringTx]] = {}
    for tx in transactions:
        if not tx.label_key:
            continue
        groups.setdefault(tx.label_key, []).append(tx)

    recurrences: list[Recurrence] = []
    rejected_thin = 0
    rejected_irregular = 0

    for key in sorted(groups):
        group = sorted(groups[key], key=lambda row: row.on)
        if len(group) < MIN_OCCURRENCES:
            rejected_thin += 1
            continue

        analysable = _analysable_run([row.on for row in group])
        if analysable is None:
            rejected_irregular += 1
            continue
        run_start, periodicity, interval_spread = analysable

        # Two independent gates, and each catches series the other lets past.
        # `_analysable_run` tests the *longest* gap; this tests the *typical*
        # one, so a series that never stops but never settles -- 30, 45, 18, 42,
        # 20 days apart, no gap long enough to be a hole -- is refused here.
        allowed_wobble = max(
            MIN_INTERVAL_MAD_DAYS,
            round(interval_spread.median * MAX_INTERVAL_MAD_RATIO),
        )
        if interval_spread.mad > allowed_wobble:
            rejected_irregular += 1
            continue

        # Everything below describes the analysed run, never the whole group. An
        # occurrence count, a first date or a price history reaching back across
        # a hole would claim a continuity that was never observed.
        rows = group[run_start:]
        dates = [row.on for row in rows]
        amounts = [row.amount_cents for row in rows]
        # The absolute floor is per-instalment, derived from the yearly one and
        # this rhythm's own frequency: the same sixty-three centimes is noise on
        # a monthly charge and a real drift on a weekly one.
        min_step = _divide(
            PRICE_CHANGE_MIN_ANNUAL_CENTS, OCCURRENCES_PER_YEAR[periodicity]
        )
        change = find_price_change(amounts, dates, min_step)
        current_level = amounts[change.occurrence_index:] if change else amounts
        level_spread = describe(current_level)
        amount_cents = level_spread.median

        interval_days = interval_spread.median
        expected_next = dates[-1] + timedelta(days=interval_days)
        # A grace period proportional to the rhythm: a weekly charge two days
        # late is nothing, a yearly one two days late is nothing either.
        grace = max(3, round(interval_days * 0.2))
        if today <= expected_next + timedelta(days=grace):
            status: RecurrenceStatus = "active"
        elif today <= dates[-1] + timedelta(days=2 * interval_days + grace):
            status = "missing"
        else:
            status = "ended"

        observed_span_days = (dates[-1] - dates[0]).days
        categories = Counter(row.category_id for row in rows if row.category_id is not None)
        category_id = categories.most_common(1)[0][0] if categories else None

        recurrences.append(Recurrence(
            label_key=key,
            label=rows[-1].label_raw,
            category_id=category_id,
            periodicity=periodicity,
            occurrences=len(rows),
            first_on=dates[0],
            last_on=dates[-1],
            median_interval_days=interval_days,
            amount_cents=amount_cents,
            amount_spread_cents=level_spread.mad,
            annual_cents=amount_cents * OCCURRENCES_PER_YEAR[periodicity],
            observed_span_days=observed_span_days,
            annualisable=observed_span_days >= MIN_ANNUALISATION_SPAN_DAYS,
            expected_next_on=expected_next,
            status=status,
            confidence="confirmed" if len(rows) >= CONFIRMED_OCCURRENCES else "probable",
            price_change=change,
        ))

    # Most expensive first: the reader opens this screen to find what to cancel.
    recurrences.sort(key=lambda item: abs(item.annual_cents), reverse=True)

    annual = sum(
        item.annual_cents
        for item in recurrences
        if item.annualisable and item.annual_cents < 0 and item.status != "ended"
    )

    notice: str | None = None
    if not recurrences:
        notice = (
            f"Aucune récurrence détectée : il faut au moins {MIN_OCCURRENCES} "
            "opérations portant le même libellé, espacées d'intervalles réguliers. "
            "Importez davantage de relevés et cette liste se remplira."
        )
    elif not any(item.annualisable for item in recurrences):
        # Detected something, annualised nothing. Without this the screen shows
        # rows and no total and explains neither -- which reads as a bug, or
        # worse, as "your subscriptions cost nothing".
        notice = (
            "Rien d'annualisable : tout ce qui a été repéré est observé sur moins "
            f"de {MIN_ANNUALISATION_SPAN_DAYS} jours, une fenêtre trop courte pour "
            "en déduire un coût annuel. Ces lignes sont affichées telles qu'elles "
            "ont été observées. Importez un historique plus long."
        )

    return RecurrenceReport(
        recurrences=recurrences,
        recurring_keys=frozenset(
            item.label_key for item in recurrences if item.annualisable
        ),
        annual_subscription_cents=annual,
        monthly_subscription_cents=_divide(annual, 12),
        analysed_groups=len(groups),
        rejected_thin=rejected_thin,
        rejected_irregular=rejected_irregular,
        notice=notice,
    )
