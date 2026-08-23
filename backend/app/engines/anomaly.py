"""Robust anomaly detection. Pure: no session, no network, no implicit clock.

Design spec (2026-08-09-yieldo-design.md, section 6.2): "Ecart statistique par
rapport a l'historique de la categorie, methode robuste (mediane et ecart
absolu median) pour ne pas etre faussee par les valeurs extremes. Evite les
seuils arbitraires." The outlier cutoff (`robust.OUTLIER_Z = 3.5`) is Iglewicz
& Hoaglin's own published threshold for the modified z-score -- not tuned
here. This module only decides two things on top of `robust.py`: how many
observations a category needs before any claim is made at all
(`MIN_HISTORY`), and how to group transactions before scoring them.
"""

from dataclasses import dataclass
from datetime import date
from typing import Literal

from app.engines.robust import OUTLIER_Z, describe, modified_z

Direction = Literal["high", "low"]

# The design plan sets this at >=10 observations per category (Lot E overview:
# "Anomalies | >=10 observations in the category | 19 categories, ~10 rows
# each | mixed -- some scored, some skipped"). Below it, the median and MAD
# describe the four or five points themselves rather than the category's
# habits, and any "outlier" claim built on them is arithmetic dressed up as
# statistics. This is a project threshold, not a citation: robust.py's
# OUTLIER_Z is the one constant here that comes from the published method.
MIN_HISTORY = 10

# French label for each sign group, used in a skipped group's own reason so
# it names what it actually counted -- "10 dépenses" or "10 recettes" -- never
# a bare "opérations" that could be misread as the whole category's total.
_SIGN_LABELS = {"expense": "dépenses", "income": "recettes"}


@dataclass(frozen=True)
class AnomalyTx:
    """One transaction, as the anomaly scorer needs it."""

    id: int
    on: date
    amount_cents: int
    label: str
    category_id: int | None


@dataclass(frozen=True)
class Anomaly:
    transaction_id: int
    on: date
    amount_cents: int
    label: str
    category_id: int | None
    # The category's own usual amount, as a positive magnitude -- the centre
    # `modified_z` scored this transaction against. UNSIGNED, unlike
    # `amount_cents`: subtracting the two directly is wrong for an expense
    # (whose `amount_cents` is negative) -- compare `abs(amount_cents)`
    # against this field, never `amount_cents` itself.
    category_median_cents: int
    # Robust deviation from that median, in Iglewicz & Hoaglin's modified
    # z-score units. Signed: positive when the amount's magnitude sits above
    # the median, negative when below. A dimensionless ratio, not money --
    # the one field in this module allowed to be a float under CLAUDE.md's
    # money rule. INFORMATIONAL ONLY: this is what decided whether the
    # transaction crossed `OUTLIER_Z`, but `AnomalyReport.anomalies` is NOT
    # ordered by it -- see that field's own comment for why raw z is unsafe
    # to compare across categories.
    modified_z: float
    direction: Direction


@dataclass(frozen=True)
class SkippedCategory:
    category_id: int | None
    # Which sign group was skipped inside this category -- "expense" or
    # "income", NOT "high"/"low". Scoring groups a category's rows by sign
    # before it ever reaches the point of asking whether a value sits high or
    # low against the centre, so a skip is reported in the sign vocabulary,
    # never the direction vocabulary `Anomaly.direction` uses.
    direction: str
    observations: int
    # French, and names this group's OWN count -- never another group's, and
    # never just the threshold with no count at all.
    reason: str


@dataclass(frozen=True)
class AnomalyReport:
    # Sorted by relative deviation from the category's own median, descending
    # -- the transaction that departed furthest, PROPORTIONALLY, from what
    # its category usually costs, first. Deliberately NOT sorted by raw
    # `|modified_z|`: whenever a group's MAD is 0 (the mean-absolute-
    # deviation fallback -- the common case for a fixed-amount subscription,
    # and the shape most of this module's own tests use), the resulting
    # score is approximately `group_size / MODIFIED_Z_MEAN_AD_CONSTANT`,
    # independent of how large the differing value actually is. Verified: a
    # 15-cent subscription repricing in a 30-row category scores z ~= 11.97,
    # HIGHER than an 860 EUR grocery spike in a 12-row category at z ~= 9.57
    # (`test_the_ranking_metric_is_relative_deviation_not_raw_modified_z`).
    # Sorting by raw z would put the fifteen-cent change at the top of the
    # feed. A group whose median is 0 (reachable: at least half its
    # magnitudes are themselves 0) ranks first rather than raising -- see
    # `test_a_category_whose_median_is_zero_ranks_first_rather_than_crashing`.
    anomalies: list[Anomaly]
    # Scoped to the window exactly like `anomalies` is: a category+sign group
    # with zero transactions inside [window_start, window_end] appears in
    # NEITHER this list nor counted by `scored_groups`, however much history
    # it holds outside the window. Reporting it either way would describe a
    # period the reader is not looking at (see `test_a_category_entirely_
    # outside_the_window_is_neither_scored_nor_skipped`). The MIN_HISTORY
    # decision itself still reads the group's WHOLE history, unaffected by
    # the window -- only whether the outcome is surfaced at all is gated.
    skipped: list[SkippedCategory]
    # Count of category+sign groups that had at least one transaction inside
    # the window, met MIN_HISTORY over their WHOLE history, and were scored
    # -- regardless of whether scoring found anything. Distinct from
    # `len(skipped)`, which counts the window-visible groups that did NOT
    # meet it. Same window-scoping as `skipped`, see above.
    scored_groups: int


def detect_anomalies(
    history: list[AnomalyTx], window_start: date, window_end: date
) -> AnomalyReport:
    """Transactions inside the window that are unusual for their own category.

    Scored against the category's **whole** history, reported only for the
    window on screen. Narrowing the history to the window would rescore every
    category against a handful of rows and turn ordinary spending into alerts
    whenever the reader zoomed in -- the same "quarter of the truth" failure
    task 10's runway and task 12's ledger bounds guard against elsewhere in
    this plan. This applies to the STATISTICS only: whether a category+sign
    group is surfaced at all, in `anomalies`, `skipped`, or `scored_groups`,
    still depends on it having at least one transaction inside the window --
    see `AnomalyReport.skipped`'s own comment.

    Grouped by category *and sign*: a 2 200 EUR salary is not an anomalous
    grocery run, and a category holding both would otherwise have its centre
    dragged toward whichever side has more rows, flagging the other side's
    ordinary transactions. Rows with no category (`category_id is None`, "Non
    catégorisé") are never scored -- that bucket is not a category, its rows
    share nothing, and a median over them describes nothing real.

    Zero-dispersion decision: `robust.modified_z` returns `None` when a
    group's MAD and mean-absolute-deviation are both 0 -- every observation in
    the group is identical to the cent. No value can be called unusual
    against a history that has never moved, so `None` here means "cannot say"
    and yields no anomaly, never a fabricated score standing in for one. The
    moment a single value differs from that history, dispersion stops being
    zero (the mean-absolute-deviation fallback picks it up) and the new value
    IS scored against the previously-unvarying centre -- deliberately: a
    charge that has never varied and then does is exactly the kind of change
    this engine exists to surface, however small the difference (see
    `test_a_single_different_charge_among_identical_ones_is_still_caught` and
    `test_an_annual_premium_among_monthly_charges_is_flagged`).
    """
    groups: dict[tuple[int, str], list[AnomalyTx]] = {}
    for row in history:
        if row.category_id is None:
            continue
        sign = "expense" if row.amount_cents < 0 else "income"
        groups.setdefault((row.category_id, sign), []).append(row)

    anomalies: list[Anomaly] = []
    skipped: list[SkippedCategory] = []
    scored_groups = 0

    for (category_id, sign), rows in sorted(groups.items()):
        in_window = [row for row in rows if window_start <= row.on <= window_end]
        if not in_window:
            # Nothing from this group falls inside the period on screen. It
            # has no bearing on what the reader is looking at, and counting
            # it -- scored or skipped -- would describe a period they did not
            # ask for. The MIN_HISTORY decision below still uses the group's
            # WHOLE history; this gate only decides whether that decision is
            # ever surfaced.
            continue

        if len(rows) < MIN_HISTORY:
            skipped.append(SkippedCategory(
                category_id=category_id,
                direction=sign,
                observations=len(rows),
                reason=(
                    f"Pas assez de données pour conclure : il faut au moins "
                    f"{MIN_HISTORY} {_SIGN_LABELS[sign]} dans cette catégorie "
                    f"pour juger qu'un montant sort de l'ordinaire, et elle "
                    f"n'en compte que {len(rows)}."
                ),
            ))
            continue

        magnitudes = [abs(row.amount_cents) for row in rows]
        spread = describe(magnitudes)
        scored_groups += 1

        for row in in_window:
            score = modified_z(abs(row.amount_cents), spread)
            if score is None or abs(score) <= OUTLIER_Z:
                continue
            anomalies.append(Anomaly(
                transaction_id=row.id,
                on=row.on,
                amount_cents=row.amount_cents,
                label=row.label,
                category_id=category_id,
                category_median_cents=spread.median,
                modified_z=score,
                direction="high" if abs(row.amount_cents) > spread.median else "low",
            ))

    anomalies.sort(key=_unusualness, reverse=True)
    return AnomalyReport(anomalies=anomalies, skipped=skipped, scored_groups=scored_groups)


def _unusualness(item: Anomaly) -> float:
    """How far `item` sits from its category's usual amount, as a fraction of
    that usual amount -- the metric `AnomalyReport.anomalies` is ranked by.
    See that field's comment for why raw `modified_z` is unsafe to compare
    across categories.

    A `category_median_cents` of 0 (reachable: at least half a group's
    magnitudes are themselves 0, e.g. `test_a_category_whose_median_is_zero_
    ranks_first_rather_than_crashing`) ranks first rather than dividing by
    it: any nonzero amount against a centre that has never moved is
    infinitely far away.
    """
    if item.category_median_cents == 0:
        return float("inf")
    return abs(abs(item.amount_cents) - item.category_median_cents) / item.category_median_cents
