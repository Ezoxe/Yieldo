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
    # `modified_z` scored this transaction against.
    category_median_cents: int
    # Robust deviation from that median, in Iglewicz & Hoaglin's modified
    # z-score units. Signed: positive when the amount's magnitude sits above
    # the median, negative when below. A dimensionless ratio, not money --
    # the one field in this module allowed to be a float under CLAUDE.md's
    # money rule.
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
    # Sorted by |modified_z| descending: the most unusual transaction first,
    # across every scored category together.
    anomalies: list[Anomaly]
    skipped: list[SkippedCategory]
    # Count of category+sign groups that met MIN_HISTORY and were scored --
    # regardless of whether scoring found anything. Distinct from
    # `len(skipped)`, which counts the groups that did NOT meet it.
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
    this plan.

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
        if len(rows) < MIN_HISTORY:
            skipped.append(SkippedCategory(
                category_id=category_id,
                direction=sign,
                observations=len(rows),
                reason=(
                    f"Pas assez de données pour conclure : il faut au moins "
                    f"{MIN_HISTORY} opérations dans cette catégorie pour juger "
                    f"qu'un montant sort de l'ordinaire, et celle-ci en compte "
                    f"{len(rows)}."
                ),
            ))
            continue

        magnitudes = [abs(row.amount_cents) for row in rows]
        spread = describe(magnitudes)
        scored_groups += 1

        for row in rows:
            if row.on < window_start or row.on > window_end:
                continue
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

    anomalies.sort(key=lambda item: abs(item.modified_z), reverse=True)
    return AnomalyReport(anomalies=anomalies, skipped=skipped, scored_groups=scored_groups)
