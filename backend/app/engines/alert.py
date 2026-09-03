"""The five alert conditions, measured from the ledger. Design §12, phase 4
plan Task 10.

Pure: no session, no network, no implicit clock -- `today` is a parameter,
exactly like every other module under `app/engines/`.

**Every alert names three things**: what was measured, over what period, and
what would clear it. `Alert.measured`, `.period` and `.clears_when` are three
separate fields rather than one paragraph, because a screen that cannot put
them in three places will run them together and a reader cannot then tell a
measurement from a remedy.

**NO ALERT FIRES ON DATA THAT WAS NOT MEASURED.** This is the whole reason
the module exists, and it is not a slogan: the operator's ledger runs from
2025-01-24 to 2026-01-09 with EIGHT calendar months inside that span holding
no imported transaction at all. A subscription whose next charge fell in one
of those months is not a missed payment -- there is simply no statement in
which it could have appeared. Announcing "prélèvement non constaté" there
would be a French sentence naming the wrong cause, which is the defect this
project has now corrected in seventeen tasks. `_missing_debit_alerts` gates
on `LedgerCoverage` for exactly this, and withholds the subject with a
sentence naming the *import gap* instead.

**Every condition ends up in exactly one of three places**, and the report
publishes all three so a screen can never quietly drop one:

* `alerts` -- it fired;
* a `ConditionState` with `measured=True` -- it was measured and found
  nothing, which is a real answer and must be shown as one. A blank screen
  is indistinguishable from a broken one;
* a `ConditionState` with `measured=False` -- it could not be measured at
  all, carrying the French cause and its own remedy. `ConditionState.withheld`
  carries the per-subject refusals (the import gaps above), which are neither
  an alert nor a clean bill of health.

**A threshold the user never set is not zero.** `BalanceFloorInput.floor_cents`
is `None` until the household stores one, and `None` is never coerced: the
balance condition reads unmeasured, with its own sentence, however deep in
the red the projection goes. A stored floor of exactly 0 is a real floor and
does fire -- see `test_a_threshold_stored_at_zero_is_a_real_threshold_and_does_fire`.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal

from app.engines.aggregate import bucket_key
from app.engines.anomaly import MIN_HISTORY, Anomaly
from app.engines.budget import BudgetLine
from app.engines.forecast import ForecastReport
from app.engines.intent import MONTH_NAMES_FR
from app.engines.recurrence import Periodicity, Recurrence

AlertKind = Literal[
    "balance_floor", "price_rise", "budget_crossed", "anomaly", "missing_debit"
]
Severity = Literal["critical", "warning", "info"]

# The order every report publishes its conditions in, and the order the alerts
# themselves are ranked by severity band. Fixed here so a screen can lay out
# five stable slots rather than whatever happened to fire today.
ALERT_KINDS: tuple[AlertKind, ...] = (
    "balance_floor", "missing_debit", "price_rise", "budget_crossed", "anomaly",
)

CONDITION_LABELS: dict[AlertKind, str] = {
    "balance_floor": "Solde projeté sous un seuil",
    "missing_debit": "Prélèvement attendu non constaté",
    "price_rise": "Hausse de prix d'un abonnement",
    "budget_crossed": "Budget mensuel dépassé",
    "anomaly": "Montant inhabituel pour sa catégorie",
}

# Severity is never carried by colour alone: this label is printed beside every
# alert, and it is what a reader without colour perception reads instead.
SEVERITY_LABELS: dict[Severity, str] = {
    "critical": "Critique",
    "warning": "À surveiller",
    "info": "Pour information",
}

_SEVERITY_RANK: dict[Severity, int] = {"critical": 0, "warning": 1, "info": 2}

# How much a charge may wobble around its own level and still read as ONE
# price. `detect_recurrences`' own docstring is explicit that this gate is the
# CALLER's job -- "no gate in this engine looks at amount stability... the
# caller must use it before putting any of this under a heading that says
# abonnements". A missing-debit alert is exactly such a heading: it says a
# scheduled payment did not arrive.
#
# A twentieth of the level, the same figure `frontend/src/features/recurrences/
# RecurrenceRow.tsx` uses for `UNSTABLE_SPREAD_RATIO` and for the same reason:
# a real direct debit moves by an FX rounding or not at all, and anything past
# that is a group of different purchases wearing one label. `normalize_label`
# strips the card suffix, so a household's weekly pharmacy or supermarket card
# spend collapses into one flawlessly rhythmic key of wildly varying amounts.
# Announcing "prélèvement attendu non constaté" for a card purchase nobody
# scheduled is the same wrong-cause defect as announcing one for a month that
# was never imported, one level up.
MAX_STABLE_SPREAD_RATIO = 0.05

PERIODICITY_LABELS: dict[Periodicity, str] = {
    "weekly": "hebdomadaire",
    "biweekly": "toutes les deux semaines",
    "monthly": "mensuel",
    "quarterly": "trimestriel",
    "yearly": "annuel",
}


# -- Formatting -------------------------------------------------------------
#
# Local rather than shared with `engines/answer.py`: these sentences are built
# here, and a formatter imported across engines is how two screens end up
# disagreeing about what a minus sign looks like. `Decimal`, never a float --
# CLAUDE.md draws no exception for formatting.


def _fmt_eur(cents: int) -> str:
    sign = "−" if cents < 0 else ""
    body = f"{Decimal(abs(cents)) / 100:,.2f}".replace(",", " ").replace(".", ",")
    return f"{sign}{body} €"


def _fmt_date(on: date) -> str:
    day = "1er" if on.day == 1 else str(on.day)
    return f"{day} {MONTH_NAMES_FR[on.month]} {on.year}"


def _fmt_month(key: str) -> str:
    year, month = key.split("-")
    return f"{MONTH_NAMES_FR[int(month)]} {year}"


def _fmt_ratio(ratio: float) -> str:
    """A signed percentage with one decimal: 0.1668 is "+16,7 %".

    A ratio is not money -- it is the dimensionless figure `recurrence.py`
    publishes -- so it is the one number in this module allowed to arrive as a
    float. It is still never multiplied against an amount here.
    """
    sign = "+" if ratio > 0 else "−"
    return f"{sign}{abs(ratio) * 100:.1f} %".replace(".", ",")


def _fmt_percent(ratio: float) -> str:
    return f"{ratio * 100:.0f} %"


def _next_month_first(month_start: date) -> date:
    if month_start.month == 12:
        return date(month_start.year + 1, 1, 1)
    return date(month_start.year, month_start.month + 1, 1)


# -- Coverage ---------------------------------------------------------------


@dataclass(frozen=True)
class LedgerCoverage:
    """Which calendar months the imported statements actually hold.

    `covered_months` is the set of `YYYY-MM` keys carrying at least one
    transaction; `missing_months` is every month INSIDE `[first_on, last_on]`
    that carries none. Months after `last_on` are not "missing" -- the ledger
    simply stops there, which is a different fact with a different remedy, and
    `last_on` is what the missing-debit gate tests against for it.
    """

    first_on: date | None
    last_on: date | None
    covered_months: frozenset[str]
    missing_months: tuple[str, ...]


def measure_coverage(dates: Iterable[date]) -> LedgerCoverage:
    """The coverage of one ledger, from its transaction dates alone.

    Pure and total: an empty ledger yields an empty coverage with no span,
    never an invented one.
    """
    ordered = sorted(dates)
    if not ordered:
        return LedgerCoverage(
            first_on=None, last_on=None, covered_months=frozenset(), missing_months=()
        )

    first, last = ordered[0], ordered[-1]
    covered = frozenset(bucket_key(on, "month") for on in ordered)

    missing: list[str] = []
    year, month = first.year, first.month
    while (year, month) <= (last.year, last.month):
        key = f"{year}-{month:02d}"
        if key not in covered:
            missing.append(key)
        month += 1
        if month > 12:
            month, year = 1, year + 1

    return LedgerCoverage(
        first_on=first, last_on=last, covered_months=covered,
        missing_months=tuple(missing),
    )


# -- Inputs -----------------------------------------------------------------


@dataclass(frozen=True)
class BalanceFloorInput:
    """The stored floor, and the projection to test it against.

    `floor_cents` is `None` -- never 0 -- until the household has actually
    stored one. `forecast` is required whenever a floor exists, and
    `evaluate_alerts` raises rather than inventing a projection for it: a
    silently absent forecast would read on screen as "measured, nothing
    found", which is the opposite of the truth.
    """

    floor_cents: int | None
    forecast: ForecastReport | None


@dataclass(frozen=True)
class BudgetSubject:
    category_name: str
    line: BudgetLine


@dataclass(frozen=True)
class BudgetInput:
    # The month the lines were evaluated over. None when there is no ledger to
    # pick a month from at all.
    month_start: date | None
    lines: tuple[BudgetSubject, ...]


@dataclass(frozen=True)
class AnomalySubject:
    anomaly: Anomaly
    category_name: str


@dataclass(frozen=True)
class AnomalyInput:
    # The reported window, `[start, end]`. None when there is no ledger.
    window: tuple[date, date] | None
    # How many category+sign groups actually met `anomaly.MIN_HISTORY`. 0 means
    # nothing was scored, which is NOT the same claim as "nothing was unusual".
    scored_groups: int
    anomalies: tuple[AnomalySubject, ...]


# -- Outputs ----------------------------------------------------------------


@dataclass(frozen=True)
class Alert:
    kind: AlertKind
    severity: Severity
    # Stable across runs for the same subject, so a screen can key a list on it
    # without React inventing an index key.
    key: str
    title: str
    # What was measured. Always names the figure AND the population it was
    # measured over.
    measured: str
    # Over what period, in the ledger's own dates.
    period: str
    # What would make this alert go away. Never "contactez le support".
    clears_when: str
    # The amount the alert is about, signed, or None where the condition has no
    # single amount. Integer cents, like every monetary field in this project.
    amount_cents: int | None
    on: date | None


@dataclass(frozen=True)
class ConditionState:
    kind: AlertKind
    label: str
    # False means this condition could not be measured at all -- read `detail`
    # before reading `alert_count`, which is 0 either way.
    measured: bool
    # French: what was measured over what period, or why nothing could be.
    detail: str
    alert_count: int
    # Subjects deliberately NOT judged, each carrying its own French cause.
    # The import-gap refusals live here: neither an alert nor a clean result.
    withheld: tuple[str, ...]


@dataclass(frozen=True)
class AlertReport:
    alerts: list[Alert]
    # Exactly one entry per `ALERT_KINDS`, in that order.
    conditions: list[ConditionState]
    coverage: LedgerCoverage
    # French, and set exactly when the ledger's own span holds unimported
    # months. It governs how every alert below it should be read, so it is
    # published once at the top rather than repeated on each card.
    notice: str | None


# -- The conditions ---------------------------------------------------------


def _balance_floor(
    balance: BalanceFloorInput, coverage: LedgerCoverage
) -> tuple[list[Alert], bool, str]:
    """`(alerts, measured, detail)` for the projected-balance floor."""
    if balance.floor_cents is None:
        if balance.forecast is not None and balance.forecast.first_breach_key is not None:
            # Deliberately still silent. The forecast was handed a threshold of
            # its own (0 by default) and may well report a breach against it;
            # that is not the household's floor, and treating it as one is the
            # exact "None as a fallback" failure this module refuses.
            pass
        return [], False, (
            "Aucun seuil de solde n'est enregistré. Un seuil absent n'est pas un "
            "seuil à 0 € : tant que vous n'en avez pas fixé un, Yieldo ne surveille "
            "aucun plancher et ne lève aucune alerte sur le solde projeté. "
            "Enregistrez-en un pour activer cette surveillance."
        )

    if balance.forecast is None:
        if coverage.last_on is None:
            # A floor stored before a single statement was imported. Nothing
            # went wrong -- there is simply nothing to project from, and that
            # is a different sentence from "no floor is set" and from "the
            # ledger is too short", each with its own remedy.
            return [], False, (
                f"Un seuil de {_fmt_eur(balance.floor_cents)} est enregistré, mais "
                "aucun relevé n'a encore été importé : il n'y a aucun solde à projeter, "
                "et donc rien à comparer à ce seuil. Importez un relevé pour activer "
                "cette surveillance."
            )
        raise ValueError(
            "Un seuil de solde est enregistré mais aucune projection n'a été "
            "fournie : impossible de dire si le seuil est franchi."
        )

    forecast = balance.forecast
    if forecast.insufficient_reason is not None:
        # An engine refusal travels through unchanged -- never softened, never
        # rephrased. `engines/answer.py` holds the same rule for the assistant.
        return [], False, forecast.insufficient_reason

    if forecast.threshold_cents != balance.floor_cents:
        raise ValueError(
            "La projection n'a pas été calculée contre le seuil enregistré "
            f"({_fmt_eur(forecast.threshold_cents)} au lieu de "
            f"{_fmt_eur(balance.floor_cents)})."
        )

    horizon = (
        f"{_fmt_month(forecast.months[0].key)} à {_fmt_month(forecast.months[-1].key)}"
        if forecast.months else "aucun mois"
    )
    detail = (
        f"Seuil surveillé : {_fmt_eur(balance.floor_cents)}. Projection mesurée sur "
        f"{forecast.ledger_months_observed} mois complets de relevés, horizon "
        f"{horizon}."
    )

    breach = next((m for m in forecast.months if m.below_threshold), None)
    if breach is None:
        return [], True, detail

    month_label = _fmt_month(breach.key)
    alert = Alert(
        kind="balance_floor",
        severity="critical",
        key=f"balance_floor:{breach.key}",
        title=f"Solde projeté sous votre seuil en {month_label}",
        measured=(
            f"Le pire dixième de la projection (P10) descend à "
            f"{_fmt_eur(breach.balance_p10_cents)} en {month_label}, sous le seuil de "
            f"{_fmt_eur(balance.floor_cents)} que vous avez enregistré. L'estimation "
            f"médiane du même mois est de {_fmt_eur(breach.balance_p50_cents)}."
        ),
        period=(
            f"Horizon projeté : {horizon}, à partir d'un solde de "
            f"{_fmt_eur(forecast.opening_balance_cents)} et de "
            f"{forecast.ledger_months_observed} mois complets de relevés. Premier mois "
            f"sous le seuil : {month_label}."
        ),
        clears_when=(
            f"Elle disparaîtra quand le pire dixième de {month_label} repassera "
            f"au-dessus de {_fmt_eur(balance.floor_cents)} — en important des relevés "
            "plus récents, ou en réduisant les dépenses que la projection reconduit. "
            "Vous pouvez aussi abaisser le seuil, ce qui change la question posée, pas "
            "la trajectoire."
        ),
        amount_cents=breach.balance_p10_cents,
        on=breach.end,
    )
    return [alert], True, detail


def _price_rise_alerts(recurrences: list[Recurrence]) -> tuple[list[Alert], bool, str]:
    if not recurrences:
        return [], False, (
            "Aucune récurrence n'a été détectée dans vos relevés : sans rythme repéré, "
            "aucune hausse de prix ne peut être constatée. Importez un historique plus "
            "long pour que cette surveillance devienne possible."
        )

    live = [item for item in recurrences if item.status != "ended"]
    detail = (
        f"{len(live)} récurrence(s) encore actives sur {len(recurrences)} détectées, "
        "comparées à leur propre niveau antérieur. Une variation de moins de 2 % ou "
        "une baisse de prix n'est pas signalée."
    )

    alerts: list[Alert] = []
    for item in live:
        change = item.price_change
        if change is None or change.ratio <= 0:
            continue
        alerts.append(Alert(
            kind="price_rise",
            severity="warning",
            key=f"price_rise:{item.label_key}:{change.changed_on.isoformat()}",
            title=f"Hausse de prix : {item.label}",
            measured=(
                f"Le prélèvement est passé de {_fmt_eur(abs(change.previous_cents))} à "
                f"{_fmt_eur(abs(change.current_cents))}, soit {_fmt_ratio(change.ratio)}, "
                f"mesuré sur {item.occurrences} prélèvements portant le même libellé."
            ),
            period=(
                f"Changement daté du {_fmt_date(change.changed_on)}. Série observée du "
                f"{_fmt_date(item.first_on)} au {_fmt_date(item.last_on)}, à un rythme "
                f"{PERIODICITY_LABELS[item.periodicity]}."
            ),
            clears_when=(
                "Elle disparaîtra quand deux prélèvements consécutifs seront revenus à "
                f"{_fmt_eur(abs(change.previous_cents))} ou moins, ou quand ce libellé "
                "cessera d'apparaître dans vos relevés — un abonnement résilié n'est "
                "plus une hausse de prix."
            ),
            amount_cents=change.current_cents,
            on=change.changed_on,
        ))
    return alerts, True, detail


def _is_one_price(item: Recurrence) -> bool:
    """Whether this recurrence's amounts describe a single scheduled price.

    See `MAX_STABLE_SPREAD_RATIO`. A level of 0 that scatters at all is never
    one price -- there is nothing to divide into, and an amount averaging
    nothing while moving is not a price.
    """
    spread = abs(item.amount_spread_cents)
    if spread == 0:
        return True
    level = abs(item.amount_cents)
    if level == 0:
        return False
    return spread / level < MAX_STABLE_SPREAD_RATIO


def _expected_charges(item: Recurrence, coverage: LedgerCoverage) -> Alert | None:
    """The alert itself, once the gate below has decided the silence is real."""
    expected = item.expected_next_on
    grace = max(3, round(item.median_interval_days * 0.2))
    ends_on = item.last_on + timedelta(days=2 * item.median_interval_days + grace)
    month_label = _fmt_month(bucket_key(expected, "month"))
    return Alert(
        kind="missing_debit",
        severity="warning",
        key=f"missing_debit:{item.label_key}:{expected.isoformat()}",
        title=f"Prélèvement attendu non constaté : {item.label}",
        measured=(
            f"{_fmt_eur(abs(item.amount_cents))} étaient attendus le "
            f"{_fmt_date(expected)} ; aucune opération portant ce libellé n'apparaît "
            f"depuis le {_fmt_date(item.last_on)}."
        ),
        period=(
            f"Rythme {PERIODICITY_LABELS[item.periodicity]} mesuré sur "
            f"{item.occurrences} prélèvements, du {_fmt_date(item.first_on)} au "
            f"{_fmt_date(item.last_on)}. {month_label} est couvert par vos relevés"
            + (
                f", importés jusqu'au {_fmt_date(coverage.last_on)}."
                if coverage.last_on is not None else "."
            )
        ),
        clears_when=(
            "Elle disparaîtra dès qu'un prélèvement portant ce libellé apparaîtra dans "
            f"un relevé importé. Si rien ne vient d'ici le {_fmt_date(ends_on)}, Yieldo "
            "considérera la série terminée et cessera de l'attendre."
        ),
        amount_cents=item.amount_cents,
        on=expected,
    )


def _missing_debit_alerts(
    recurrences: list[Recurrence], coverage: LedgerCoverage
) -> tuple[list[Alert], bool, str, tuple[str, ...]]:
    """`(alerts, measured, detail, withheld)`.

    **The gate.** A recurrence whose next charge never came is only a missed
    payment if there was a statement it could have appeared in. Two distinct
    ways there was not, each with its own cause and its own remedy:

    * the expected date's month is not in `coverage.covered_months` -- the
      operator has eight such months inside his own ledger's span;
    * the expected date is after `coverage.last_on` -- the month may well be
      covered, but the statements stop before the charge was due.

    Both are withheld, neither is an alert, and the two never share a sentence.
    """
    if not recurrences:
        return [], False, (
            "Aucune récurrence n'a été détectée dans vos relevés : sans rythme repéré, "
            "aucun prélèvement ne peut être déclaré manquant. Importez un historique "
            "plus long pour que cette surveillance devienne possible."
        ), ()

    candidates = [item for item in recurrences if item.status == "missing"]
    alerts: list[Alert] = []
    withheld: list[str] = []

    for item in candidates:
        expected = item.expected_next_on
        amount = _fmt_eur(abs(item.amount_cents))
        month_key = bucket_key(expected, "month")
        month_label = _fmt_month(month_key)

        if not _is_one_price(item):
            withheld.append(
                f"Aucune conclusion pour « {item.label} » : ce libellé revient à un "
                f"rythme {PERIODICITY_LABELS[item.periodicity]}, mais pour des montants "
                f"qui varient de ±{_fmt_eur(abs(item.amount_spread_cents))} autour de "
                f"{amount}. Un rythme n'est pas un prélèvement programmé : ce sont des "
                "achats différents sous un même libellé, et leur silence ne prouve "
                "aucun paiement manqué."
            )
            continue

        if month_key not in coverage.covered_months:
            withheld.append(
                f"Aucune conclusion pour « {item.label} » : le prélèvement de {amount} "
                f"attendu le {_fmt_date(expected)} tombe en {month_label}, un mois que "
                "vos relevés ne couvrent pas. Une absence dans un mois non importé est "
                "un trou dans les données, pas un paiement manqué. Importez le relevé "
                f"de {month_label} pour trancher."
            )
            continue

        if coverage.last_on is not None and expected > coverage.last_on:
            withheld.append(
                f"Aucune conclusion pour « {item.label} » : le prélèvement de {amount} "
                f"attendu le {_fmt_date(expected)} est postérieur au "
                f"{_fmt_date(coverage.last_on)}, dernière opération importée. Vos "
                "relevés s'arrêtent avant la date attendue : il n'y a encore rien à "
                "constater. Importez le relevé suivant pour trancher."
            )
            continue

        alert = _expected_charges(item, coverage)
        if alert is not None:
            alerts.append(alert)

    detail = (
        f"{len(candidates)} récurrence(s) sans prélèvement récent sur "
        f"{len(recurrences)} détectées. Une absence n'est retenue que si le libellé "
        "revient à un montant constant et que le mois attendu figure réellement dans "
        "vos relevés."
    )
    return alerts, True, detail, tuple(withheld)


def _budget_alerts(budgets: BudgetInput) -> tuple[list[Alert], bool, str]:
    if budgets.month_start is None or not budgets.lines:
        return [], False, (
            "Aucun budget mensuel n'est déclaré : sans plafond, il n'y a rien à "
            "dépasser. Fixez un budget sur une catégorie depuis l'écran Budgets pour "
            "activer cette surveillance."
        )

    month_start = budgets.month_start
    month_label = _fmt_month(bucket_key(month_start, "month"))
    detail = (
        f"{len(budgets.lines)} budget(s) mensuel(s) suivis sur {month_label}, comparés "
        "aux opérations importées de ce mois."
    )

    alerts: list[Alert] = []
    for subject in budgets.lines:
        line = subject.line
        if line.status != "over":
            continue
        # `spent_cents` is negative (an outflow); `remaining_cents` is a ceiling
        # figure and goes negative once the ceiling is passed.
        overrun = -line.remaining_cents
        alerts.append(Alert(
            kind="budget_crossed",
            severity="warning",
            key=f"budget_crossed:{line.category_id}:{bucket_key(month_start, 'month')}",
            title=f"Budget dépassé : {subject.category_name}",
            measured=(
                f"{_fmt_eur(-line.spent_cents)} dépensés sur un budget mensuel de "
                f"{_fmt_eur(line.budget_cents)}, soit "
                f"{_fmt_percent(line.consumed_ratio)} du plafond — un dépassement de "
                f"{_fmt_eur(overrun)}."
            ),
            period=(
                f"Mois de {month_label}, mesuré sur les opérations de "
                f"« {subject.category_name} » importées pour ce mois."
            ),
            clears_when=(
                f"Un budget mensuel se referme de lui-même : le compteur de "
                f"« {subject.category_name} » repart à zéro le "
                f"{_fmt_date(_next_month_first(month_start))}. Vous pouvez aussi "
                "relever le plafond de cette catégorie si "
                f"{_fmt_eur(line.budget_cents)} ne correspond plus à vos dépenses."
            ),
            amount_cents=line.spent_cents,
            on=month_start,
        ))
    return alerts, True, detail


def _anomaly_alerts(anomalies: AnomalyInput) -> tuple[list[Alert], bool, str]:
    if anomalies.window is None or anomalies.scored_groups == 0:
        return [], False, (
            "Aucune catégorie n'a assez d'historique pour juger qu'un montant sort de "
            f"l'ordinaire : il en faut au moins {MIN_HISTORY} opérations de même sens "
            "dans une même catégorie. Importez davantage de relevés, ou catégorisez "
            "les opérations qui ne le sont pas encore."
        )

    window_start, window_end = anomalies.window
    detail = (
        f"{anomalies.scored_groups} groupe(s) catégorie/sens comparés à leur propre "
        f"historique, sur la fenêtre du {_fmt_date(window_start)} au "
        f"{_fmt_date(window_end)}."
    )

    alerts: list[Alert] = []
    for subject in anomalies.anomalies:
        item = subject.anomaly
        deviation = abs(abs(item.amount_cents) - item.category_median_cents)
        alerts.append(Alert(
            kind="anomaly",
            severity="info",
            key=f"anomaly:{item.transaction_id}",
            title=f"Montant inhabituel : {item.label}",
            measured=(
                f"{_fmt_eur(abs(item.amount_cents))} dans « {subject.category_name} », "
                f"contre {_fmt_eur(item.category_median_cents)} habituellement — un "
                f"écart de {_fmt_eur(deviation)} par rapport à la médiane de la "
                f"catégorie (score robuste "
                f"{f'{item.modified_z:.1f}'.replace('.', ',')})."
            ),
            period=(
                f"Opération du {_fmt_date(item.on)}, comparée à l'ensemble de "
                "l'historique de sa catégorie et retenue parce qu'elle tombe dans la "
                f"fenêtre analysée, du {_fmt_date(window_start)} au "
                f"{_fmt_date(window_end)}."
            ),
            clears_when=(
                "Une opération passée ne se corrige pas : cette alerte quittera le fil "
                "quand l'opération sortira de la fenêtre analysée, à mesure que vous "
                "importerez des relevés plus récents. Elle disparaîtra aussi si vous "
                "reclassez l'opération dans une catégorie où ce montant est ordinaire."
            ),
            amount_cents=item.amount_cents,
            on=item.on,
        ))
    return alerts, True, detail


def _gap_notice(coverage: LedgerCoverage) -> str | None:
    if not coverage.missing_months:
        return None
    labels = ", ".join(_fmt_month(key) for key in coverage.missing_months)
    count = len(coverage.missing_months)
    plural = "mois" if count == 1 else "mois"
    return (
        f"{count} {plural} de votre historique ne sont pas importés ({labels}). "
        "Aucune alerte n'est levée sur ces mois : une absence dans un mois non importé "
        "est un trou dans les données, pas un événement. Importez ces relevés pour que "
        "Yieldo puisse s'y prononcer."
    )


def evaluate_alerts(
    *,
    today: date,
    coverage: LedgerCoverage,
    balance: BalanceFloorInput,
    recurrences: list[Recurrence],
    budgets: BudgetInput,
    anomalies: AnomalyInput,
) -> AlertReport:
    """The five conditions, each measured or each explaining why it was not.

    `today` is a parameter and is used for nothing but the ordering tie-break
    below: every date this module prints comes from the ledger or from an
    engine that was itself handed a clock by its caller. It is required all
    the same, so that no future condition here can quietly reach for
    `date.today()` and make the module untestable at any other date.
    """
    balance_alerts, balance_measured, balance_detail = _balance_floor(balance, coverage)
    rise_alerts, rise_measured, rise_detail = _price_rise_alerts(recurrences)
    missing_alerts, missing_measured, missing_detail, withheld = _missing_debit_alerts(
        recurrences, coverage
    )
    budget_alerts, budget_measured, budget_detail = _budget_alerts(budgets)
    anomaly_alerts, anomaly_measured, anomaly_detail = _anomaly_alerts(anomalies)

    by_kind: dict[AlertKind, tuple[list[Alert], bool, str, tuple[str, ...]]] = {
        "balance_floor": (balance_alerts, balance_measured, balance_detail, ()),
        "missing_debit": (missing_alerts, missing_measured, missing_detail, withheld),
        "price_rise": (rise_alerts, rise_measured, rise_detail, ()),
        "budget_crossed": (budget_alerts, budget_measured, budget_detail, ()),
        "anomaly": (anomaly_alerts, anomaly_measured, anomaly_detail, ()),
    }

    alerts = [alert for kind in ALERT_KINDS for alert in by_kind[kind][0]]
    # Worst first, then the largest amount, then a stable key. `today` breaks no
    # tie here on purpose: two runs on the same data must produce the same list.
    alerts.sort(key=lambda item: (
        _SEVERITY_RANK[item.severity],
        -abs(item.amount_cents or 0),
        item.key,
    ))

    conditions = [
        ConditionState(
            kind=kind,
            label=CONDITION_LABELS[kind],
            measured=by_kind[kind][1],
            detail=by_kind[kind][2],
            alert_count=len(by_kind[kind][0]),
            withheld=by_kind[kind][3],
        )
        for kind in ALERT_KINDS
    ]

    return AlertReport(
        alerts=alerts,
        conditions=conditions,
        coverage=coverage,
        notice=_gap_notice(coverage),
    )
