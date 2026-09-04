"""Executing a parsed chat query against the engines already shipped. Design
§8.1: "Chaque réponse affiche la requête exécutée, en clair."

`answer_query` takes a `ParsedQuery` from `engines/intent.py` and a
`ChatContext` -- every primitive an engine might need, already fetched by the
caller -- and returns an `Answer`: the exact figure, in French, together with
the query that produced it. **An engine refusal travels through unchanged.**
When `feasibility.assess_feasibility`, `goal.evaluate_goals` or
`recurrence.detect_recurrences` hands back a French reason it could not
answer, that string becomes `Answer.text` verbatim -- never softened, never
rephrased, never replaced with a friendlier sentence. Every refusal already
names its own cause and its own remedy; restating it here would be the exact
"French sentence naming the wrong cause" defect this project keeps paying to
fix.

`Answer.query_description` is populated on every path, including a refusal:
design §8.1 requires the user to be able to check what was computed, and a
refused answer was still computed FROM something -- the period, the category,
the amount that was actually asked about.

Pure: no session, no network, no implicit clock -- `today` is a parameter.
`ChatContext` bundles data the caller already fetched through
`api/common.py`-style helpers; this module never queries a database.
"""

import unicodedata
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Literal

from app.engines.aggregate import bucket_key, compare_periods
from app.engines.capacity import (
    MonthObservation,
    measure_expense_rate,
    measure_income_rate,
    measure_savings_capacity,
)
from app.engines.feasibility import (
    LIQUID_HORIZON_MONTHS,
    Assumptions,
    PurchaseRequest,
    assess_feasibility,
)
from app.engines.goal import GoalInput, GoalProgress, evaluate_goals
from app.engines.intent import MONTH_NAMES_FR, ParsedPeriod, ParsedQuery
from app.engines.ownership import DEFAULT_OWNERSHIP_YEARS
from app.engines.period import resolve_range
from app.engines.recurrence import RecurringTx, detect_recurrences
from app.engines.savings import (
    DEFAULT_ANNUAL_RETURN_BPS,
    SavingsProjection,
    project_savings,
)

# Declared defaults, never measurements -- exactly the distinction
# `api/feasibility.py`'s own module docstring draws for its identical
# constants. A chat question rarely states a horizon or a loan rate, and
# every sentence below that uses one of these says so explicitly, so the
# reader can tell an assumption from a measured figure (design §10).
DEFAULT_FEASIBILITY_HORIZON_MONTHS = 12
DEFAULT_LOAN_RATE_BPS = 500
DEFAULT_LOAN_MONTHS = 60
DEFAULT_SAVINGS_HORIZON_MONTHS = 12
DEFAULT_PROJECTION_HORIZON_MONTHS = LIQUID_HORIZON_MONTHS

VERDICT_FR: dict[str, str] = {
    "comfortable": "atteignable confortablement",
    "tight": "atteignable en serrant",
    "out_of_reach": "hors de portée",
}


@dataclass(frozen=True)
class PortfolioSnapshot:
    """The three counts `/api/projection` already classifies a portfolio gap
    from (`_PortfolioGap` there). Reproduced here as plain ints rather than
    imported, so this module never depends on `engines/portfolio.py`'s
    heavier valuation shapes for a chat answer that only ever needs a total."""

    market_value_cents: int
    positions_total: int
    positions_valued: int


@dataclass(frozen=True)
class ChatContext:
    """Everything a chat answer might need, already fetched by the caller.

    Every field is a primitive or a frozen dataclass an engine already
    declares. `transactions` is built exactly like `api/common.py`'s
    `recurrence_points` -- the WHOLE ledger, transfers already excluded --
    and is reused for every intent that reads the ledger (category totals,
    period comparisons, transaction search, subscription detection): one
    fetch, four intents, never four queries that could drift apart.
    """

    ledger_start: date | None
    ledger_end: date | None
    transactions: list[RecurringTx]
    categories: dict[int, str]
    months: list[MonthObservation]
    # The clock `detect_recurrences` is run against -- the ledger's own last
    # transaction date, never the real `today`, for the identical reason
    # `api/engagement.py` gives: the real clock would mark every subscription
    # on a ledger that stopped importing months ago as "ended".
    recurrence_anchor: date
    balance_cents: int
    existing_debt_payments_cents: int
    goals: list[GoalInput]
    portfolio: PortfolioSnapshot


ChartKind = Literal["bars", "line"]


@dataclass(frozen=True)
class AnswerPoint:
    """One column of a bar chart or one reading of a line. `label` is already
    French and already displayable -- the caller never reformats it."""

    label: str
    amount_cents: int


@dataclass(frozen=True)
class AnswerChart:
    """The chart an answer deserves, or nothing.

    **A chart is a decomposition of the figure that was already computed, never
    a second computation.** Every point below comes out of the same engine call
    the sentence quotes, so a bar chart of a monthly total sums back to that
    total exactly. Nothing here is smoothed, resampled or extrapolated.

    Three rules decide whether there is a chart at all:

    1. **A refusal never carries one.** There is no figure to decompose.
    2. **One point is not a chart** -- it is the figure already printed beside
       it, drawn twice.
    3. **An answer that decomposes into nothing gets nothing.** A goal's state,
       a price change, a transaction search: a chart there would be decoration
       standing where an explanation belongs.
    """

    kind: ChartKind
    # French, and specific enough to be read away from the sentence above it.
    title: str
    points: tuple[AnswerPoint, ...]


# One column is the figure the sentence already quotes, drawn a second time.
MIN_CHART_POINTS = 2


@dataclass(frozen=True)
class Answer:
    query_description: str
    text: str
    amount_cents: int | None = None
    is_refusal: bool = False
    # None on every refusal, and on every intent whose answer decomposes into
    # nothing. See `AnswerChart`.
    chart: AnswerChart | None = None


def _normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return stripped.lower().strip()


def _find_matches(hint: str, candidates: dict[int, str]) -> tuple[list[tuple[int, str]], bool]:
    """Every candidate whose name matches `hint`, and whether it was resolved
    by an EXACT name match. An exact match is taken alone even if some other
    candidate's name happens to contain it as a substring -- "Restaurant"
    typed against categories "Restaurant" and "Restaurant d'entreprise" must
    resolve to the first, not refuse as ambiguous."""
    norm_hint = _normalize(hint)
    exact = [(cid, name) for cid, name in candidates.items() if _normalize(name) == norm_hint]
    if len(exact) == 1:
        return exact, True
    partial = [(cid, name) for cid, name in candidates.items() if norm_hint in _normalize(name)]
    return partial, False


def _fmt_eur(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    value = Decimal(abs(cents)) / 100
    return f"{sign}{value:,.2f} €".replace(",", " ").replace(".", ",")


def _month_label(key: str) -> str:
    """`"2026-03"` to `"mars 2026"`. The bucket key is the grouping mechanism;
    this is what a reader sees, and the two are deliberately not the same
    string."""
    year, month = key.split("-")
    return f"{MONTH_NAMES_FR[int(month)]} {year}"


def _monthly_bars(transactions: list[RecurringTx], title: str) -> AnswerChart | None:
    """One column per calendar month that CARRIES a transaction.

    Months with nothing in them are absent rather than drawn at zero: a zero
    column asserts "we looked and found nothing", which is true of a month
    inside the period and false of one the ledger simply does not cover, and
    this function cannot tell the two apart. `bucket_key` is the same monthly
    bucketing `engines/aggregate.py` uses everywhere else, so a month edge is
    never cut differently in two places.
    """
    totals: dict[str, int] = {}
    for tx in transactions:
        key = bucket_key(tx.on, "month")
        totals[key] = totals.get(key, 0) + tx.amount_cents
    if len(totals) < MIN_CHART_POINTS:
        return None
    return AnswerChart(
        kind="bars", title=title,
        points=tuple(
            AnswerPoint(label=_month_label(key), amount_cents=totals[key])
            for key in sorted(totals)
        ),
    )


def _balance_line(projection: SavingsProjection, title: str) -> AnswerChart | None:
    """The projected balance, month by month -- the exact series
    `engines/savings.py` returned, never a resampling of it. A one-month
    projection draws nothing: see `AnswerChart`'s rule 2."""
    if len(projection.points) < MIN_CHART_POINTS:
        return None
    return AnswerChart(
        kind="line", title=title,
        points=tuple(
            AnswerPoint(label=f"Mois {point.month}", amount_cents=point.balance_cents)
            for point in projection.points
        ),
    )


def _period_or_default(
    period: ParsedPeriod | None, ledger_start: date | None, ledger_end: date | None, today: date
) -> tuple[date, date, str]:
    if period is not None:
        return period.start, period.end, period.label
    start, end = resolve_range(None, None, ledger_start, ledger_end, today)
    return start, end, f"toute la période disponible ({start.isoformat()} au {end.isoformat()})"


# --------------------------------------------------------------------------
# total_by_category
# --------------------------------------------------------------------------


def _months_within(months: list[MonthObservation], start: date, end: date) -> int:
    return sum(1 for month in months if month.start >= start and month.end <= end)


def _answer_total_by_category(query: ParsedQuery, ctx: ChatContext, today: date) -> Answer:
    start, end, period_label = _period_or_default(
        query.period, ctx.ledger_start, ctx.ledger_end, today
    )

    category_id: int | None = None
    category_label = "toutes catégories confondues"
    if query.category_hint is not None:
        matches, _ = _find_matches(query.category_hint, ctx.categories)
        requested = (
            f"Total des dépenses, catégorie demandée : « {query.category_hint} », "
            f"période : {period_label}."
        )
        if not matches:
            names = ", ".join(f"« {name} »" for name in sorted(ctx.categories.values())) or "aucune"
            return Answer(
                query_description=requested,
                text=(
                    f"Aucune catégorie ne correspond à « {query.category_hint} ». "
                    f"Vos catégories sont : {names}."
                ),
                is_refusal=True,
            )
        if len(matches) > 1:
            names = ", ".join(f"« {name} »" for _, name in matches)
            return Answer(
                query_description=requested,
                text=(
                    f"Plusieurs catégories correspondent à « {query.category_hint} » : "
                    f"{names}. Précisez laquelle."
                ),
                is_refusal=True,
            )
        category_id, category_label = matches[0]

    mode_label = "moyenne mensuelle" if query.mode == "average" else "total"
    description = (
        f"{mode_label.capitalize()} des dépenses, catégorie : {category_label}, "
        f"période : {period_label}."
    )

    matching = [
        tx for tx in ctx.transactions
        if start <= tx.on <= end and tx.amount_cents < 0
        and (category_id is None or tx.category_id == category_id)
    ]
    total_cents = sum(tx.amount_cents for tx in matching)
    chart = _monthly_bars(matching, f"Dépenses par mois — {category_label}")

    if query.mode == "average":
        covered_months = _months_within(ctx.months, start, end)
        if covered_months == 0:
            return Answer(
                query_description=description,
                text=(
                    "Impossible de calculer une moyenne mensuelle : aucun mois complet "
                    "n'est observé sur cette période. Importez les relevés manquants."
                ),
                is_refusal=True,
            )
        # Floor division: a display average, never fed back into a further
        # computation, so a drift of at most one cent is immaterial.
        average = total_cents // covered_months
        return Answer(
            query_description=description,
            text=(
                f"Sur {covered_months} mois complets observés entre le {start.isoformat()} "
                f"et le {end.isoformat()}, vous avez dépensé {_fmt_eur(-total_cents)} en "
                f"{category_label}, soit une moyenne de {_fmt_eur(-average)} par mois."
            ),
            amount_cents=average,
            chart=chart,
        )

    return Answer(
        query_description=description,
        text=(
            f"Vous avez dépensé {_fmt_eur(-total_cents)} en {category_label} entre le "
            f"{start.isoformat()} et le {end.isoformat()} ({len(matching)} opération"
            f"{'s' if len(matching) != 1 else ''})."
        ),
        amount_cents=total_cents,
        chart=chart,
    )


# --------------------------------------------------------------------------
# period_comparison
# --------------------------------------------------------------------------


def _spend_magnitude_cents(transactions: list[RecurringTx], start: date, end: date) -> int:
    """Total spend as a POSITIVE magnitude -- `compare_periods` on the raw
    signed sums would read a bigger deficit as a "decrease", which is
    backwards for the sentence this builds. `answer.amount_cents` keeps the
    same convention: positive means spent MORE than the baseline."""
    return -sum(
        tx.amount_cents for tx in transactions
        if start <= tx.on <= end and tx.amount_cents < 0
    )


def _answer_period_comparison(query: ParsedQuery, ctx: ChatContext, today: date) -> Answer:
    assert query.period is not None and query.compare_period is not None
    compare = query.compare_period
    current = _spend_magnitude_cents(ctx.transactions, query.period.start, query.period.end)
    previous = _spend_magnitude_cents(ctx.transactions, compare.start, compare.end)
    comparison = compare_periods(current, previous)

    description = (
        f"Comparaison des dépenses entre {query.period.label} et {query.compare_period.label}."
    )
    if comparison.delta_cents == 0:
        verb_clause = "un montant identique"
    elif comparison.delta_cents > 0:
        verb_clause = f"{_fmt_eur(comparison.delta_cents)} de dépenses en plus"
    else:
        verb_clause = f"{_fmt_eur(-comparison.delta_cents)} de dépenses en moins"

    ratio_clause = ""
    if comparison.delta_ratio is not None:
        ratio_clause = f" (soit {comparison.delta_ratio * 100:.1f} %)"

    return Answer(
        query_description=description,
        text=(
            f"Vous avez dépensé {_fmt_eur(current)} sur {query.period.label}, contre "
            f"{_fmt_eur(previous)} sur {query.compare_period.label} : {verb_clause}"
            f"{ratio_clause}."
        ),
        amount_cents=comparison.delta_cents,
        # Two columns and exactly two: the pair the sentence weighed, in the
        # same positive-magnitude convention `_spend_magnitude_cents` uses, so
        # the taller bar is the heavier spend rather than the deeper deficit.
        chart=AnswerChart(
            kind="bars",
            title="Dépenses comparées",
            points=(
                AnswerPoint(label=query.period.label, amount_cents=current),
                AnswerPoint(label=compare.label, amount_cents=previous),
            ),
        ),
    )


# --------------------------------------------------------------------------
# recurrence_evolution / subscription_cost
# --------------------------------------------------------------------------


def _recurring_tx(ctx: ChatContext) -> list[RecurringTx]:
    return ctx.transactions


def _answer_recurrence_evolution(query: ParsedQuery, ctx: ChatContext, today: date) -> Answer:
    assert query.entity is not None
    description = f"Évolution de prix, recherche : « {query.entity} »."
    report = detect_recurrences(_recurring_tx(ctx), ctx.recurrence_anchor)
    if report.notice is not None:
        # The engine's own refusal, verbatim: it already names the real
        # cause (too few occurrences, no regular rhythm) and its own remedy.
        return Answer(query_description=description, text=report.notice, is_refusal=True)

    candidates = {index: item.label for index, item in enumerate(report.recurrences)}
    matches, _ = _find_matches(query.entity, candidates)
    if not matches:
        names = ", ".join(f"« {item.label} »" for item in report.recurrences[:8])
        return Answer(
            query_description=description,
            text=(
                f"Aucune récurrence ne correspond à « {query.entity} ». Récurrences "
                f"détectées : {names}."
            ),
            is_refusal=True,
        )
    if len(matches) > 1:
        names = ", ".join(f"« {name} »" for _, name in matches)
        return Answer(
            query_description=description,
            text=(
                f"Plusieurs récurrences correspondent à « {query.entity} » : {names}. "
                "Précisez laquelle."
            ),
            is_refusal=True,
        )
    index, label = matches[0]
    item = report.recurrences[index]
    description = f"Évolution de prix de « {label} »."

    if item.price_change is None:
        return Answer(
            query_description=description,
            text=(
                f"Aucun changement de prix détecté pour « {label} » : le montant est "
                f"resté stable à {_fmt_eur(-item.amount_cents)} par prélèvement depuis le "
                f"{item.first_on.isoformat()}."
            ),
            amount_cents=item.amount_cents,
        )
    change = item.price_change
    direction = "augmenté" if change.ratio > 0 else "baissé"
    return Answer(
        query_description=description,
        text=(
            f"Le prix de « {label} » a {direction} de {abs(change.ratio) * 100:.1f} % le "
            f"{change.changed_on.isoformat()}, passant de {_fmt_eur(-change.previous_cents)} "
            f"à {_fmt_eur(-change.current_cents)} par prélèvement."
        ),
        amount_cents=change.current_cents - change.previous_cents,
    )


def _answer_subscription_cost(query: ParsedQuery, ctx: ChatContext, today: date) -> Answer:
    description = "Coût total de vos abonnements actifs, annualisé."
    report = detect_recurrences(_recurring_tx(ctx), ctx.recurrence_anchor)
    if report.notice is not None:
        return Answer(query_description=description, text=report.notice, is_refusal=True)

    counted = [
        item for item in report.recurrences
        if item.annualisable and item.annual_cents < 0 and item.status != "ended"
    ]
    # Exactly the subscriptions the total was summed from, biggest first, as
    # positive annual magnitudes. Never a different list, and never one of them
    # aggregated into an "autres" column the reader cannot open.
    chart = (
        AnswerChart(
            kind="bars",
            title="Coût annuel par abonnement",
            points=tuple(
                AnswerPoint(label=item.label, amount_cents=-item.annual_cents)
                for item in sorted(counted, key=lambda item: item.annual_cents)
            ),
        )
        if len(counted) >= MIN_CHART_POINTS
        else None
    )
    return Answer(
        query_description=description,
        text=(
            f"Vos {len(counted)} abonnement{'s' if len(counted) != 1 else ''} actifs vous "
            f"coûtent {_fmt_eur(-report.annual_subscription_cents)} par an, soit "
            f"{_fmt_eur(-report.monthly_subscription_cents)} par mois."
        ),
        amount_cents=report.annual_subscription_cents,
        chart=chart,
    )


# --------------------------------------------------------------------------
# feasibility
# --------------------------------------------------------------------------


def _answer_feasibility(query: ParsedQuery, ctx: ChatContext, today: date) -> Answer:
    assert query.amount_cents is not None
    horizon = query.horizon_months or DEFAULT_FEASIBILITY_HORIZON_MONTHS
    nature = query.nature or "other"
    income = measure_income_rate(ctx.months)

    request = PurchaseRequest(
        target_cents=query.amount_cents, horizon_months=horizon,
        down_payment_cents=0, nature=nature,
    )
    assumptions = Assumptions(
        annual_return_bps=DEFAULT_ANNUAL_RETURN_BPS, loan_rate_bps=DEFAULT_LOAN_RATE_BPS,
        loan_months=DEFAULT_LOAN_MONTHS, ownership_years=DEFAULT_OWNERSHIP_YEARS,
        monthly_income_cents=None if income is None else income.median_cents,
        existing_debt_payments_cents=ctx.existing_debt_payments_cents,
    )

    horizon_note = (
        "" if query.horizon_months is not None
        else f" (échéance par défaut de {horizon} mois)"
    )
    description = (
        f"Faisabilité d'achat : {_fmt_eur(query.amount_cents)}, échéance {horizon} mois"
        f"{horizon_note}."
    )

    report = assess_feasibility(
        request, measure_savings_capacity(ctx.months), measure_expense_rate(ctx.months),
        ctx.balance_cents, assumptions, today,
    )
    if report.capacity_unavailable_reason is not None:
        return Answer(
            query_description=description, text=report.capacity_unavailable_reason, is_refusal=True,
        )

    verdict_fr = VERDICT_FR[report.verdict]
    return Answer(
        query_description=description,
        text=(
            f"Verdict : {verdict_fr}. À l'échéance du {report.horizon_end_on.isoformat()} "
            f"({horizon} mois), vous auriez {_fmt_eur(report.saved_at_horizon_cents)} de côté "
            f"pour un objectif de {_fmt_eur(query.amount_cents)}, soit un écart de "
            f"{_fmt_eur(report.gap_cents)}."
        ),
        amount_cents=report.gap_cents,
    )


# --------------------------------------------------------------------------
# savings_simulation
# --------------------------------------------------------------------------


def _answer_savings_simulation(query: ParsedQuery, ctx: ChatContext, today: date) -> Answer:
    assert query.amount_cents is not None
    horizon = query.horizon_months or DEFAULT_SAVINGS_HORIZON_MONTHS
    horizon_note = (
        "" if query.horizon_months is not None else f" (durée par défaut de {horizon} mois)"
    )
    description = (
        f"Simulation d'épargne : {_fmt_eur(query.amount_cents)} par mois, durée {horizon} mois"
        f"{horizon_note}, taux supposé {DEFAULT_ANNUAL_RETURN_BPS / 100:.2f} %/an."
    )
    projection = project_savings(0, query.amount_cents, DEFAULT_ANNUAL_RETURN_BPS, horizon)
    return Answer(
        query_description=description,
        text=(
            f"En épargnant {_fmt_eur(query.amount_cents)} par mois pendant {horizon} mois à un "
            f"taux supposé de {DEFAULT_ANNUAL_RETURN_BPS / 100:.2f} %/an, vous auriez "
            f"{_fmt_eur(projection.final_cents)}, dont {_fmt_eur(projection.interest_cents)} "
            f"d'intérêts."
        ),
        amount_cents=projection.final_cents,
        chart=_balance_line(projection, "Solde projeté, mois par mois"),
    )


# --------------------------------------------------------------------------
# goal_status
# --------------------------------------------------------------------------


def _goal_sentence(item: GoalProgress) -> str:
    if item.remaining_cents == 0:
        return f"« {item.name} » est atteint ({_fmt_eur(item.target_cents)})."
    if item.projection_unavailable_reason is not None:
        return f"« {item.name} » : {item.projection_unavailable_reason}"
    completion = (
        item.projected_completion_on.isoformat() if item.projected_completion_on else "?"
    )
    return (
        f"« {item.name} » : il manque {_fmt_eur(item.remaining_cents)} sur "
        f"{_fmt_eur(item.target_cents)}, atteint dans environ {item.months_to_completion} "
        f"mois ({completion})."
    )


def _answer_goal_status(query: ParsedQuery, ctx: ChatContext, today: date) -> Answer:
    if not ctx.goals:
        return Answer(
            query_description="État des objectifs.",
            text="Vous n'avez aucun objectif enregistré. Créez-en un depuis l'écran Objectifs.",
            is_refusal=True,
        )

    capacity = measure_savings_capacity(ctx.months)
    progress = evaluate_goals(ctx.goals, None if capacity is None else capacity.median_cents, today)

    if query.entity is None:
        description = "État de tous les objectifs."
        text = " ".join(_goal_sentence(item) for item in progress)
        return Answer(query_description=description, text=text)

    names = {item.goal_id: item.name for item in progress}
    matches, _ = _find_matches(query.entity, names)
    description = f"État de l'objectif « {query.entity} »."
    if not matches:
        available = ", ".join(f"« {name} »" for name in names.values()) or "aucun"
        return Answer(
            query_description=description,
            text=(
                f"Aucun objectif ne correspond à « {query.entity} ». "
                f"Vos objectifs : {available}."
            ),
            is_refusal=True,
        )
    if len(matches) > 1:
        available = ", ".join(f"« {name} »" for _, name in matches)
        return Answer(
            query_description=description,
            text=(
                f"Plusieurs objectifs correspondent à « {query.entity} » : {available}. "
                "Précisez lequel."
            ),
            is_refusal=True,
        )
    goal_id, name = matches[0]
    item = next(item for item in progress if item.goal_id == goal_id)
    description = f"État de l'objectif « {name} »."
    if item.remaining_cents > 0 and item.projection_unavailable_reason is not None:
        return Answer(
            query_description=description, text=item.projection_unavailable_reason,
            is_refusal=True,
        )
    return Answer(
        query_description=description, text=_goal_sentence(item),
        amount_cents=item.remaining_cents,
    )


# --------------------------------------------------------------------------
# transaction_search
# --------------------------------------------------------------------------


def _answer_transaction_search(query: ParsedQuery, ctx: ChatContext, today: date) -> Answer:
    start, end, period_label = _period_or_default(
        query.period, ctx.ledger_start, ctx.ledger_end, today
    )
    entity_label = f"« {query.entity} »" if query.entity is not None else "toutes opérations"
    description = f"Recherche de transactions : {entity_label}, période : {period_label}."

    norm_entity = _normalize(query.entity) if query.entity is not None else None
    matching = [
        tx for tx in ctx.transactions
        if start <= tx.on <= end
        and (norm_entity is None or norm_entity in _normalize(tx.label_raw))
    ]
    total_cents = sum(tx.amount_cents for tx in matching)

    if not matching:
        return Answer(
            query_description=description,
            text=f"Aucune opération ne correspond à {entity_label} sur la période {period_label}.",
            amount_cents=0,
        )

    return Answer(
        query_description=description,
        text=(
            f"{len(matching)} opération{'s' if len(matching) != 1 else ''} correspondent à "
            f"{entity_label} sur la période {period_label}, pour un total de "
            f"{_fmt_eur(total_cents)}."
        ),
        amount_cents=total_cents,
    )


# --------------------------------------------------------------------------
# patrimoine_projection
# --------------------------------------------------------------------------


def _answer_patrimoine_projection(query: ParsedQuery, ctx: ChatContext, today: date) -> Answer:
    horizon = query.horizon_months or DEFAULT_PROJECTION_HORIZON_MONTHS
    horizon_note = (
        "" if query.horizon_months is not None else f" (horizon par défaut de {horizon} mois)"
    )
    description = f"Projection de patrimoine à {horizon} mois{horizon_note}."

    portfolio = ctx.portfolio
    if portfolio.positions_total == 0:
        return Answer(
            query_description=description,
            text=(
                "Aucun capital de départ : vous ne détenez aucune position. Saisissez vos "
                "comptes, vos positions et leurs lots sur l'écran Patrimoine."
            ),
            is_refusal=True,
        )
    if portfolio.positions_valued == 0:
        return Answer(
            query_description=description,
            text=(
                "Le capital de départ est inconnu : aucune de vos positions n'a pu être "
                "valorisée. Renseignez une clé de marché dans Réglages → Connexions, ou "
                "attendez la réinitialisation du quota."
            ),
            is_refusal=True,
        )
    if portfolio.market_value_cents == 0:
        return Answer(
            query_description=description,
            text=(
                "Le capital de départ valorisé est de 0 € : vos lots totalisent une "
                "quantité nulle. Saisissez les quantités réellement détenues sur l'écran "
                "Patrimoine."
            ),
            is_refusal=True,
        )

    capacity = measure_savings_capacity(ctx.months)
    monthly = 0 if capacity is None else capacity.median_cents
    projection = project_savings(
        portfolio.market_value_cents, monthly, DEFAULT_ANNUAL_RETURN_BPS, horizon
    )
    capacity_clause = (
        f" et une capacité d'épargne mesurée de {_fmt_eur(monthly)} par mois"
        if capacity is not None else " (aucune capacité d'épargne mesurée, apport supposé nul)"
    )
    return Answer(
        query_description=description,
        text=(
            f"En partant de {_fmt_eur(portfolio.market_value_cents)} investis aujourd'hui"
            f"{capacity_clause}, avec un rendement supposé de "
            f"{DEFAULT_ANNUAL_RETURN_BPS / 100:.2f} %/an, votre patrimoine investi vaudrait "
            f"environ {_fmt_eur(projection.final_cents)} dans {horizon} mois."
        ),
        amount_cents=projection.final_cents,
        chart=_balance_line(projection, "Patrimoine investi projeté, mois par mois"),
    )


_HANDLERS = {
    "total_by_category": _answer_total_by_category,
    "period_comparison": _answer_period_comparison,
    "recurrence_evolution": _answer_recurrence_evolution,
    "subscription_cost": _answer_subscription_cost,
    "feasibility": _answer_feasibility,
    "savings_simulation": _answer_savings_simulation,
    "goal_status": _answer_goal_status,
    "transaction_search": _answer_transaction_search,
    "patrimoine_projection": _answer_patrimoine_projection,
}


# --------------------------------------------------------------------------
# The trace
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class AnswerStep:
    """One thing that actually happened on the way to the figure.

    The assistant has no model and no tool calls to narrate, so the honest
    account of "what it did" is the fixed sequence its own code runs: parse
    the sentence, read the ledger, call these engines. That sequence is
    knowable per intent, because each handler's imports are fixed -- so it is
    DECLARED, in `trace_query` below, next to `_HANDLERS`, and a test asserts
    the two tables cover the same intents.

    Nothing here is invented and nothing is timed: the front end may animate
    the reveal, but every line it reveals was produced by this module for
    this question.
    """

    #: The engine module or data source, verbatim -- "engines/aggregate",
    #: "releve". Displayed as written; it is a fact about the code.
    tool: str
    #: What it did, in French.
    label: str
    #: What it read, in French, with the counts THIS account actually has.
    #: A ledger of three operations must not read like one of three thousand.
    source: str
    #: The route showing the same data, so a reader can go and check it, or
    #: None when nothing on screen corresponds. Always a route the front end
    #: really serves -- `design/ai/targets.ts` holds the same list.
    screen: str | None = None


def _ledger_step(ctx: ChatContext) -> AnswerStep:
    span = (
        "aucune période couverte"
        if ctx.ledger_start is None or ctx.ledger_end is None
        else f"du {ctx.ledger_start.isoformat()} au {ctx.ledger_end.isoformat()}"
    )
    return AnswerStep(
        tool="relevé",
        label="Lecture du relevé",
        source=f"{len(ctx.transactions)} opérations, {len(ctx.categories)} catégories, {span}",
        screen="/transactions",
    )


def _months_step(ctx: ChatContext) -> AnswerStep:
    return AnswerStep(
        tool="engines/capacity",
        label="Mesure des rythmes mensuels",
        source=f"{len(ctx.months)} mois observés",
        screen="/tresorerie",
    )


def trace_query(query: ParsedQuery, ctx: ChatContext) -> tuple[AnswerStep, ...]:
    """The steps this query runs through, in the order the code runs them.

    One branch per intent, deliberately: a `dict` of static tuples could not
    carry the counts, and counting is what keeps this from being decoration.
    Adding an intent to `_HANDLERS` without adding it here fails
    `test_every_intent_declares_a_trace`.
    """
    read = AnswerStep(
        tool="engines/intent",
        label="Lecture de la question",
        source=f"intention reconnue : {query.intent}",
    )

    if query.intent == "total_by_category":
        return (
            read,
            _ledger_step(ctx),
            AnswerStep(
                tool="engines/period",
                label="Résolution de la période",
                source="aucune période" if query.period is None else query.period.label,
            ),
            AnswerStep(
                tool="engines/aggregate",
                label="Somme par catégorie",
                source=(
                    "toutes catégories"
                    if query.category_hint is None
                    else f"catégorie « {query.category_hint} »"
                ),
                screen="/budgets",
            ),
        )

    if query.intent == "period_comparison":
        return (
            read,
            _ledger_step(ctx),
            AnswerStep(
                tool="engines/aggregate",
                label="Comparaison de deux périodes",
                source=(
                    "périodes non résolues"
                    if query.period is None or query.compare_period is None
                    else f"{query.period.label} contre {query.compare_period.label}"
                ),
                screen="/analyse",
            ),
        )

    if query.intent in ("recurrence_evolution", "subscription_cost"):
        return (
            read,
            _ledger_step(ctx),
            AnswerStep(
                tool="engines/recurrence",
                label="Détection des prélèvements réguliers",
                source=(
                    f"relevé arrêté au {ctx.recurrence_anchor.isoformat()}"
                    + ("" if query.entity is None else f", filtré sur « {query.entity} »")
                ),
                screen="/recurrences",
            ),
        )

    if query.intent == "feasibility":
        return (
            read,
            _months_step(ctx),
            AnswerStep(
                tool="solde",
                label="Relevé du solde disponible",
                source=f"{_fmt_eur(ctx.balance_cents)} disponibles",
                screen="/tresorerie",
            ),
            AnswerStep(
                tool="engines/feasibility",
                label="Évaluation de la faisabilité",
                source=(
                    (
                        "montant non lu"
                        if query.amount_cents is None
                        else _fmt_eur(query.amount_cents)
                    )
                    + ", mensualités de dettes déjà engagées "
                    + _fmt_eur(ctx.existing_debt_payments_cents)
                ),
                screen="/faisabilite",
            ),
        )

    if query.intent == "savings_simulation":
        return (
            read,
            AnswerStep(
                tool="engines/savings",
                label="Projection d'épargne",
                source=(
                    (
                        "versement non lu"
                        if query.amount_cents is None
                        else f"{_fmt_eur(query.amount_cents)} par mois"
                    )
                    + f", taux supposé {DEFAULT_ANNUAL_RETURN_BPS / 100:.2f} %/an"
                ),
                screen="/projection",
            ),
        )

    if query.intent == "goal_status":
        return (
            read,
            _months_step(ctx),
            AnswerStep(
                tool="engines/goal",
                label="Avancement des objectifs",
                source=(
                    f"{len(ctx.goals)} objectifs"
                    + ("" if query.entity is None else f", filtré sur « {query.entity} »")
                ),
                screen="/objectifs",
            ),
        )

    if query.intent == "transaction_search":
        return (
            read,
            _ledger_step(ctx),
            AnswerStep(
                tool="engines/period",
                label="Résolution de la période",
                source="aucune période" if query.period is None else query.period.label,
            ),
            AnswerStep(
                tool="recherche",
                label="Filtrage des opérations",
                source=(
                    "aucun libellé"
                    if query.entity is None
                    else f"libellé « {query.entity} »"
                ),
                screen="/transactions",
            ),
        )

    if query.intent == "patrimoine_projection":
        return (
            read,
            AnswerStep(
                tool="engines/portfolio",
                label="Valorisation du portefeuille",
                source=(
                    f"{ctx.portfolio.positions_valued} lignes valorisées sur "
                    f"{ctx.portfolio.positions_total}, "
                    f"{_fmt_eur(ctx.portfolio.market_value_cents)}"
                ),
                screen="/patrimoine",
            ),
            _months_step(ctx),
            AnswerStep(
                tool="engines/savings",
                label="Projection du patrimoine",
                source=f"taux supposé {DEFAULT_ANNUAL_RETURN_BPS / 100:.2f} %/an",
                screen="/projection",
            ),
        )

    # Unreachable while `_HANDLERS` and this function agree, which is what
    # `test_every_intent_declares_a_trace` measures. Never a silent empty
    # tuple: a question that answered but reported nothing about how would
    # look like a defect in the panel rather than a gap in this table.
    raise ValueError(f"Aucune trace déclarée pour l'intention « {query.intent} ».")


def answer_query(query: ParsedQuery, ctx: ChatContext, today: date) -> Answer:
    """Execute one parsed query and return the figure with its provenance.

    May raise `ValueError` -- an engine's own refusal to compute at all on a
    malformed input, such as a horizon past `savings.MAX_PROJECTION_MONTHS`.
    That is a genuine bad request, not a "could not measure" refusal, and the
    caller is expected to translate it the same way every other router in
    this codebase does: `except ValueError as exc: raise HTTPException(422,
    str(exc))`.
    """
    return _HANDLERS[query.intent](query, ctx, today)
