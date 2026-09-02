"""`GET /api/projection`: Monte Carlo, FIRE, French tax and the three
historical stress tests, assembled over the requesting user's OWN portfolio
and OWN measured savings capacity.

Phase 3 plan Task 15. This router owns no arithmetic: it resolves the
household's real inputs, hands them to four pure engines, and turns each
engine's refusal into a French sentence on a 200. Every query filters
`user_id` -- through `get_current_user` for the ledger, and through
`api.portfolio.valuation_inputs` (already user-scoped, already
archived-account-aware) for the portfolio, reused rather than re-derived so
`/projection` and `/patrimoine` can never disagree about what is held.

**The seed is a required query parameter and travels back in the response.**
No default, no `random` fallback, no clock-derived value: a Monte Carlo run
nobody can reproduce is not a measurement, and `engines.montecarlo` refuses
to invent one for exactly that reason. It comes back twice -- on
`assumptions.seed` (the request, echoed) and on
`monte_carlo.assumptions.seed` (the engine's own record of what it ran).

**The refused response is the shape this module was designed around.** The
operator holds zero positions and his measured savings capacity is
-746,19 EUR/month, so all four engines refuse on his real data, each for a
genuinely different reason and each pointing at a different remedy:

* Monte Carlo -- there is no starting capital to grow. A run from 0 EUR
  produces no band at all, only a line, which would violate the one rule
  that engine exists to enforce (percentile bands, never a single number).
  Remedy: enter positions, or fix why they could not be priced.
* FIRE -- the capacity is measured and NEGATIVE, so independence is not
  approaching slowly, it is receding. The engine's own sentence, verbatim.
  Remedy: the ledger, not the portfolio.
* Tax -- there is no latent gain, so no regime applies to anything. Remedy:
  lots, with their cost basis and acquisition dates.
* Stress -- there is no allocation by asset class for a shock to hit.
  Applying -54 % to nothing would print -0,00 EUR, which reads as "measured,
  no effect" and is the fabricated figure this project forbids. Remedy:
  positions whose asset class is declared.

A French sentence naming the WRONG cause is this project's most repeated
defect. `_PortfolioGap` below exists so the CAUSE is classified once, from
the valuation's own counts, and each panel then words its own REMEDY --
rather than four panels each re-deciding, and drifting.

**Query-parameter bounds are the engines' own constants**, imported rather
than restated (`MAX_PROJECTION_MONTHS`, `MAX_TRIALS`), so a bound can never
drift from the engine that enforces it; `api/errors.py` renders the refusal
in French. `annual_return_bps` deliberately accepts a NEGATIVE value:
`engines.montecarlo`'s docstring states that refusing to model a sustained
bear market "would defeat half the reason this module exists". The three
engines that cannot accept one (`fire.project_independence` through
`savings.months_to_target`, and `fire.project_retirement`) refuse in their
own words, on their own panel, rather than taking the page down with them.
"""

from collections import defaultdict
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.goals import observed_months, rate_out
from app.api.portfolio import valuation_inputs
from app.db import get_db
from app.engines import portfolio as portfolio_engine
from app.engines import stress as stress_engine
from app.engines.capacity import (
    MIN_MONTHS_FOR_RATE,
    MeasuredRate,
    measure_expense_rate,
    measure_savings_capacity,
)
from app.engines.fire import (
    compute_target_capital,
    project_independence,
    project_retirement,
)
from app.engines.montecarlo import (
    DEFAULT_PERCENTILES,
    DEFAULT_TRIALS,
    MAX_TRIALS,
    project_monte_carlo,
)
from app.engines.period import month_end
from app.engines.savings import DEFAULT_ANNUAL_RETURN_BPS, MAX_PROJECTION_MONTHS
from app.engines.tax_fr import (
    compute_assurance_vie_gain,
    compute_bareme,
    compute_pea_gain,
    compute_pfu,
)
from app.models import InvestmentAccount, User
from app.schemas.projection import (
    FireOut,
    IndependenceOut,
    MonteCarloAssumptionsOut,
    MonteCarloOut,
    MonteCarloPointOut,
    ProjectionAssumptionsOut,
    ProjectionOut,
    ProjectionPortfolioOut,
    RetirementOut,
    StressOut,
    StressScenarioOut,
    StressShockOut,
    TargetCapitalOut,
    TaxAccountOut,
    TaxOut,
    TaxRegimeResultOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/projection", tags=["projection"])

# --- Declared assumptions, never measurements. Echoed back on every response
# --- so a screen prints the hypothesis beside the figure it produced
# --- (design §10), exactly as `api/feasibility.py` already does.

# 15,00 %: the order of magnitude of a diversified world-equity portfolio's
# annual standard deviation. A STATED hypothesis -- Yieldo has no price
# history of its own to measure a real volatility from, and
# `engines.montecarlo` says so in its own docstring. The user overrides it.
DEFAULT_ANNUAL_VOLATILITY_BPS = 1_500

# 4,00 %: the "règle des 4 %" this project quotes by name. Also a stated
# assumption, displayed beside every figure it produced.
DEFAULT_WITHDRAWAL_RATE_BPS = 400

# Twenty years. Long enough for compounding to separate the percentiles,
# short enough that a browser draws 240 points rather than 600.
DEFAULT_MONTHS = 240

# `engines.tax_fr.REGIMES`, in French, so no euro figure is ever printed
# without the rule that produced it. Keyed on the engine's own `regime`
# string rather than re-derived from the account kind: the account kind is
# the QUESTION, the regime is the ANSWER, and a PEA can answer either
# "pea_exempt" or "pfu" depending only on its holding period.
REGIME_LABELS: dict[str, str] = {
    "pfu": "PFU — prélèvement forfaitaire unique, 30 % (12,8 % IR + 17,2 % PS)",
    "bareme": "Barème progressif de l'impôt sur le revenu (+ 17,2 % PS)",
    "pea_exempt": "PEA exonéré d'impôt sur le revenu (art. 157, 5° bis CGI) — 17,2 % PS dus",
    "assurance_vie_reduced": (
        "Assurance-vie de plus de 8 ans — taux réduit 7,5 % (art. 125-0 A, I bis CGI)"
    ),
}

# Envelopes `engines.tax_fr` has no regime for. A PER is taxed on EXIT, as
# income (or as a capital gain on the gains portion), under rules that depend
# on whether the contributions were deducted on the way in -- article 163
# quatervicies CGI. None of that is in `engines.tax_fr`, and applying PFU to
# a PER would be a confident, wrong tax answer rather than a missing one.
_UNSUPPORTED_ACCOUNT_KINDS = {"per"}

# PEA-PME follows the PEA's own five-year rule (article L221-32-1 du code
# monétaire et financier renvoie au régime du PEA), so both map to the same
# engine function.
_PEA_KINDS = {"pea", "pea_pme"}


# --------------------------------------------------------------------------
# The cause, classified once.
# --------------------------------------------------------------------------


class _PortfolioGap:
    """Why the portfolio cannot feed a projection -- or `None` when it can.

    Four panels need the SAME classification and four different remedies.
    Deciding the cause in one place is what stops one panel saying "aucune
    position" while the panel beside it says "prix indisponible" about the
    identical portfolio.
    """

    NO_POSITIONS = "no_positions"
    NO_PRICE = "no_price"
    NO_VALUE = "no_value"

    @staticmethod
    def classify(total: portfolio_engine.PortfolioTotal) -> str | None:
        if total.positions_total == 0:
            return _PortfolioGap.NO_POSITIONS
        if total.positions_valued == 0:
            return _PortfolioGap.NO_PRICE
        if total.market_value_cents == 0:
            return _PortfolioGap.NO_VALUE
        return None


def _positions(count: int) -> str:
    return f"{count} position" if count <= 1 else f"{count} positions"


def _unpriced_clause(total: portfolio_engine.PortfolioTotal) -> str:
    """Names how many positions could not be priced, and points at the one
    remedy that actually fixes it. `market/quota.py` and `market/client.py`
    already attached the real cause to each position; this sentence names the
    ACTION, and `/patrimoine` shows the per-position causes."""
    return (
        f"Aucune de vos {_positions(total.positions_total)} n'a pu être valorisée : "
        "le prix n'a pas pu être obtenu. Renseignez une clé de marché dans "
        "Réglages → Connexions, ou attendez la réinitialisation du quota — le détail "
        "par position est sur l'écran Patrimoine."
    )


def _monte_carlo_refusal(gap: str, total: portfolio_engine.PortfolioTotal) -> str:
    if gap == _PortfolioGap.NO_POSITIONS:
        return (
            "Aucun capital de départ : vous ne détenez aucune position. Une simulation "
            "partant de 0 € ne produirait pas de bande de centiles, seulement une ligne — "
            "et une ligne n'est pas une mesure du risque. Saisissez vos comptes, vos "
            "positions et leurs lots sur l'écran Patrimoine."
        )
    if gap == _PortfolioGap.NO_PRICE:
        return (
            f"Le capital de départ est inconnu. {_unpriced_clause(total)}"
        )
    return (
        "Le capital de départ valorisé est de 0 € : vos lots totalisent une quantité "
        "nulle. Saisissez les quantités réellement détenues sur l'écran Patrimoine."
    )


def _tax_refusal(gap: str, total: portfolio_engine.PortfolioTotal) -> str:
    if gap == _PortfolioGap.NO_POSITIONS:
        return (
            "Aucune plus-value latente à imposer : vous ne détenez aucune position. "
            "La fiscalité française (PFU, barème, PEA, assurance-vie) porte sur un gain, "
            "et un gain se calcule à partir des lots — quantité, prix de revient et date "
            "d'acquisition. Saisissez-les sur l'écran Patrimoine, avec la date "
            "d'ouverture de chaque enveloppe."
        )
    if gap == _PortfolioGap.NO_PRICE:
        return (
            f"La plus-value latente, donc l'impôt, ne peut pas être calculée : sans prix "
            f"de marché il n'y a rien à comparer au prix de revient de vos lots. "
            f"{_unpriced_clause(total)}"
        )
    return (
        "Aucune plus-value latente à imposer : vos positions valorisées totalisent 0 €. "
        "Saisissez les quantités réellement détenues sur l'écran Patrimoine."
    )


def _stress_refusal(gap: str, total: portfolio_engine.PortfolioTotal) -> str:
    if gap == _PortfolioGap.NO_POSITIONS:
        return (
            "Aucune classe d'actifs à soumettre à un choc : vous ne détenez aucune "
            "position. Appliquer −54 % à un patrimoine vide afficherait −0,00 €, ce qui se "
            "lirait comme « mesuré, sans effet » — c'est un chiffre inventé, pas une "
            "mesure. Les trois épisodes restent affichés ci-dessous avec leurs périodes et "
            "leurs sources. Saisissez vos positions et leur classe d'actifs sur l'écran "
            "Patrimoine."
        )
    if gap == _PortfolioGap.NO_PRICE:
        return (
            f"Aucune valeur par classe d'actifs : un choc historique n'a rien à quoi "
            f"s'appliquer. {_unpriced_clause(total)}"
        )
    return (
        "Aucune valeur par classe d'actifs : vos positions valorisées totalisent 0 €. "
        "Saisissez les quantités réellement détenues sur l'écran Patrimoine."
    )


# "trois", spelled out, not `MIN_MONTHS_FOR_RATE` interpolated: every other
# refusal in this codebase that names this floor spells it out
# (`engines.fire._reason_capacity_unmeasurable`,
# `api/feasibility.py`'s own), and a household reading "3 mois" on one screen
# and "trois mois" on the next would reasonably wonder whether they are the
# same rule. The assertion below fails loudly if the engine's floor ever moves.
assert MIN_MONTHS_FOR_RATE == 3, (
    "MIN_MONTHS_FOR_RATE moved: the French sentences below spell the floor out "
    "and must be reworded."
)

_NO_EXPENSE_RATE_REASON = (
    "Votre dépense mensuelle n'a pas pu être mesurée : il faut au moins trois mois "
    "complets de relevés pour en tirer une médiane. Sans elle, aucun capital cible "
    "d'indépendance financière ne peut être calculé. Importez davantage de relevés "
    "sur l'écran Import."
)

_NO_CAPACITY_REASON = (
    "Votre capacité d'épargne n'a pas pu être mesurée : il faut au moins trois mois "
    "complets de relevés. Importez davantage de relevés sur l'écran Import."
)


def _retirement_refusal(gap: str | None, total: portfolio_engine.PortfolioTotal) -> str:
    if gap == _PortfolioGap.NO_PRICE:
        return (
            f"La phase de retrait se calcule sur un capital constitué, et celui-ci est "
            f"inconnu. {_unpriced_clause(total)}"
        )
    return (
        "Aucune rente ne peut être projetée : votre capital constitué est de 0 €. "
        "La phase de retrait suppose un capital déjà là — le délai pour l'atteindre est "
        "la ligne au-dessus."
    )


# --------------------------------------------------------------------------
# Tax, per envelope.
# --------------------------------------------------------------------------


def _regime_result(result, regime: str) -> TaxRegimeResultOut:
    return TaxRegimeResultOut(
        regime=regime, regime_label=REGIME_LABELS[regime],
        gross_gain_cents=result.gross_gain_cents,
        income_tax_cents=result.income_tax_cents,
        social_levies_cents=result.social_levies_cents,
        total_tax_cents=result.total_tax_cents,
        net_gain_cents=result.net_gain_cents,
    )


def _unavailable_account(
    account: InvestmentAccount, positions_total: int, positions_valued: int, reason: str
) -> TaxAccountOut:
    """A refused envelope: every taxed figure is `None` together, including
    `regime`. A regime without a figure would be as misleading as a figure
    without a regime -- the two are only ever both present or both absent."""
    return TaxAccountOut(
        account_id=account.id, account_name=account.name, account_kind=account.kind,
        opened_on=account.opened_on, positions_total=positions_total,
        positions_valued=positions_valued, unrealised_gain_cents=None, regime=None,
        regime_label=None, income_tax_cents=None, social_levies_cents=None,
        total_tax_cents=None, net_gain_cents=None, exempt=None, years_held=None,
        abatement_applied_cents=None, alternative=None, unavailable_reason=reason,
    )


def _tax_account(
    account: InvestmentAccount, valuations: list[portfolio_engine.PositionValuation],
    today: date, marginal_rate_bps: int | None, joint_taxation: bool,
    total_premiums_cents: int,
) -> TaxAccountOut:
    """One envelope's latent gain, taxed under the regime its own `kind` and
    `opened_on` select.

    **Latent, not realised.** Nothing has been sold; this prices what WOULD be
    owed if the whole envelope were liquidated today, which is the only tax
    question a portfolio screen can answer without a disposal to point at.
    The gain is `engines.portfolio`'s own `unrealised_gain_reporting_cents`,
    summed over the envelope's positions -- the same weighted-average cost
    (PMPA) `engines.tax_fr.compute_capital_gain` would apply, since a full
    liquidation sells every lot and the weighting is then the identity.

    An envelope with even ONE position missing a price refuses as a whole: a
    partial gain taxed as though it were the total would understate the bill
    without saying so.
    """
    total = len(valuations)
    valued = sum(1 for v in valuations if v.unrealised_gain_reporting_cents is not None)

    if account.kind in _UNSUPPORTED_ACCOUNT_KINDS:
        return _unavailable_account(account, total, valued, (
            "Yieldo ne calcule pas la fiscalité d'un PER : elle dépend de la déduction "
            "des versements à l'entrée et du mode de sortie choisi (rente ou capital), "
            "que Yieldo ne connaît pas. Aucun chiffre n'est avancé plutôt qu'un chiffre "
            "faux — les autres enveloppes ci-dessous restent calculées."
        ))

    if valued < total:
        return _unavailable_account(account, total, valued, (
            f"{_positions(total - valued)} de cette enveloppe n'ont pas de prix : la "
            "plus-value latente de l'enveloppe entière ne peut pas être calculée. Un "
            "gain partiel imposé comme s'il était le total sous-estimerait la note sans "
            "le dire."
        ))

    gain = sum(v.unrealised_gain_reporting_cents or 0 for v in valuations)
    is_pea = account.kind in _PEA_KINDS
    is_av = account.kind == "assurance_vie"

    if (is_pea or is_av) and account.opened_on is None:
        return _unavailable_account(account, total, valued, (
            "Cette enveloppe n'a pas de date d'ouverture. L'exonération du PEA "
            "(5 ans, art. 157, 5° bis CGI) et l'abattement de l'assurance-vie (8 ans, "
            "art. 125-0 A, I CGI) se comptent depuis l'ouverture du plan, jamais depuis "
            "l'acquisition d'un lot. Renseignez-la sur l'écran Patrimoine."
        ))

    try:
        if is_pea:
            primary = compute_pea_gain(gain, account.opened_on, today)
            alternative_result = (
                None if marginal_rate_bps is None
                else compute_pea_gain(gain, account.opened_on, today, marginal_rate_bps)
            )
        elif is_av:
            primary = compute_assurance_vie_gain(
                gain, account.opened_on, today, total_premiums_cents, joint_taxation
            )
            alternative_result = (
                None if marginal_rate_bps is None
                else compute_assurance_vie_gain(
                    gain, account.opened_on, today, total_premiums_cents, joint_taxation,
                    marginal_rate_bps,
                )
            )
        else:
            primary = compute_pfu(gain)
            alternative_result = (
                None if marginal_rate_bps is None
                else compute_bareme(gain, marginal_rate_bps)
            )
    except ValueError as exc:
        # `_validate_dates` refuses an `opened_on` later than today -- a value
        # `InvestmentAccountIn` accepts and stores. One bad envelope refuses
        # alone, in the engine's own French, rather than 422-ing a page whose
        # three other panels are perfectly computable.
        return _unavailable_account(account, total, valued, (
            f"{exc} Corrigez la date d'ouverture de cette enveloppe sur l'écran "
            "Patrimoine."
        ))

    # Published only when the barème actually IS a different treatment. On an
    # exempt PEA the election changes nothing (`compute_pea_gain` still
    # answers "pea_exempt"), and printing an identical figure twice under two
    # headings would suggest a choice the taxpayer does not have.
    alternative = (
        _regime_result(alternative_result, "bareme")
        if alternative_result is not None and alternative_result.regime == "bareme"
        else None
    )

    return TaxAccountOut(
        account_id=account.id, account_name=account.name, account_kind=account.kind,
        opened_on=account.opened_on, positions_total=total, positions_valued=valued,
        unrealised_gain_cents=gain, regime=primary.regime,
        regime_label=REGIME_LABELS[primary.regime],
        income_tax_cents=primary.income_tax_cents,
        social_levies_cents=primary.social_levies_cents,
        total_tax_cents=primary.total_tax_cents, net_gain_cents=primary.net_gain_cents,
        exempt=getattr(primary, "exempt", None),
        years_held=getattr(primary, "years_held", None),
        abatement_applied_cents=getattr(primary, "abatement_applied_cents", None),
        alternative=alternative, unavailable_reason=None,
    )


def _build_tax(
    db: Session, user: User, valuation: portfolio_engine.PortfolioValuation, today: date,
    marginal_rate_bps: int | None, joint_taxation: bool,
) -> TaxOut:
    by_account: dict[int, list[portfolio_engine.PositionValuation]] = defaultdict(list)
    for position in valuation.positions:
        by_account[position.account_id].append(position)

    accounts = (
        db.query(InvestmentAccount)
        .filter(
            InvestmentAccount.user_id == user.id,
            InvestmentAccount.id.in_(by_account.keys()),
        )
        .order_by(InvestmentAccount.id)
        .all()
    )

    # Article 125-0 A, I bis-1 CGI's 150 000 EUR threshold is per POLICYHOLDER,
    # across every assurance-vie contract held -- not per contract. Derived
    # from the cost basis of the household's assurance-vie holdings, which is
    # what was actually paid in, rather than asked for as yet another number
    # the user would have to look up. Positions whose cost basis could not be
    # converted contribute nothing: their own envelope is refused above, so
    # they never reach a figure this total feeds.
    total_premiums_cents = sum(
        position.cost_basis_reporting_cents or 0
        for account in accounts if account.kind == "assurance_vie"
        for position in by_account[account.id]
    )

    out = [
        _tax_account(account, by_account[account.id], today, marginal_rate_bps,
                     joint_taxation, total_premiums_cents)
        for account in accounts
    ]

    taxed = [row for row in out if row.unavailable_reason is None]
    with_alternative = [row for row in taxed if row.alternative is not None]
    cheaper: str | None = None
    if with_alternative:
        primary_total = sum(row.total_tax_cents or 0 for row in with_alternative)
        alternative_total = sum(row.alternative.total_tax_cents for row in with_alternative)
        # A tie goes to PFU: it is the regime that applies with no election at
        # all, the same rule `engines.tax_fr.compare_regimes` documents.
        cheaper = "bareme" if alternative_total < primary_total else "pfu"

    return TaxOut(
        total_unrealised_gain_cents=sum(row.unrealised_gain_cents or 0 for row in taxed),
        total_tax_cents=sum(row.total_tax_cents or 0 for row in taxed),
        accounts_unavailable=len(out) - len(taxed),
        accounts=out, cheaper=cheaper,
    )


# --------------------------------------------------------------------------
# FIRE.
# --------------------------------------------------------------------------


def _build_fire(
    expense_rate: MeasuredRate, capacity: MeasuredRate | None, capital_cents: int,
    gap: str | None, total: portfolio_engine.PortfolioTotal, today: date,
    annual_return_bps: int, withdrawal_rate_bps: int, months: int,
    marginal_rate_bps: int | None,
) -> FireOut:
    target = compute_target_capital(expense_rate.median_cents * 12, withdrawal_rate_bps)

    try:
        independence = project_independence(
            target_capital_cents=target.target_capital_cents,
            current_capital_cents=capital_cents, capacity=capacity,
            annual_return_bps=annual_return_bps,
            withdrawal_rate_bps=withdrawal_rate_bps, today=today,
        )
        independence_out = IndependenceOut(
            target_capital_cents=independence.target_capital_cents,
            current_capital_cents=independence.current_capital_cents,
            withdrawal_rate_bps=independence.withdrawal_rate_bps,
            annual_return_bps=independence.annual_return_bps,
            capacity=rate_out(independence.capacity),
            months_to_independence=independence.months_to_independence,
            independent_on=independence.independent_on,
            unavailable_reason=independence.unavailable_reason,
        )
    except ValueError as exc:
        # `savings.months_to_target` refuses a negative return rate, which
        # `engines.montecarlo` deliberately accepts. The panel refuses in the
        # engine's own French rather than the page 422-ing around it.
        independence_out = IndependenceOut(
            target_capital_cents=target.target_capital_cents,
            current_capital_cents=capital_cents,
            withdrawal_rate_bps=withdrawal_rate_bps, annual_return_bps=annual_return_bps,
            capacity=rate_out(capacity), months_to_independence=None,
            independent_on=None, unavailable_reason=str(exc),
        )

    retirement_out: RetirementOut | None = None
    retirement_reason: str | None = None
    if capital_cents <= 0:
        retirement_reason = _retirement_refusal(gap, total)
    else:
        try:
            retirement = project_retirement(
                initial_cents=capital_cents, annual_return_bps=annual_return_bps,
                withdrawal_rate_bps=withdrawal_rate_bps, months=months, today=today,
                marginal_rate_bps=marginal_rate_bps,
            )
            retirement_out = RetirementOut.model_validate(retirement)
        except ValueError as exc:
            retirement_reason = str(exc)

    return FireOut(
        target=TargetCapitalOut.model_validate(target), independence=independence_out,
        retirement=retirement_out, retirement_unavailable_reason=retirement_reason,
    )


# --------------------------------------------------------------------------
# The route.
# --------------------------------------------------------------------------


@router.get("", response_model=ProjectionOut)
def get_projection(
    # REQUIRED. See the module docstring: this API never generates a seed.
    seed: int = Query(),
    months: int = Query(default=DEFAULT_MONTHS, ge=1, le=MAX_PROJECTION_MONTHS),
    annual_return_bps: int = Query(
        default=DEFAULT_ANNUAL_RETURN_BPS, ge=-10_000, le=10_000
    ),
    annual_volatility_bps: int = Query(
        default=DEFAULT_ANNUAL_VOLATILITY_BPS, ge=0, le=100_000
    ),
    trials: int = Query(default=DEFAULT_TRIALS, ge=1, le=MAX_TRIALS),
    withdrawal_rate_bps: int = Query(
        default=DEFAULT_WITHDRAWAL_RATE_BPS, ge=1, le=10_000
    ),
    marginal_rate_bps: int | None = Query(default=None, ge=0, le=10_000),
    joint_taxation: bool = Query(default=False),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectionOut:
    """Design §10's projection panel, end to end.

    The clock is `date.today()`, read here and handed to every engine as a
    parameter -- the same decision `api/feasibility.py` documents: a horizon
    counts forward from now, not from whenever the last statement was
    imported. It is NOT the ledger-anchored clock `/api/cashflow/forecast`
    uses, and the two are separate decisions.
    """
    today = date.today()
    now = datetime.now(UTC)
    reporting_currency = portfolio_engine.DEFAULT_REPORTING_CURRENCY

    # User-scoped and archived-account-aware, by reuse rather than by a second
    # query that could drift from /patrimoine's.
    inputs = valuation_inputs(db, user, now, reporting_currency)
    valuation = portfolio_engine.value_portfolio(inputs, reporting_currency)
    total = valuation.total
    gap = _PortfolioGap.classify(total)

    observed = observed_months(db, user.id)
    capacity = measure_savings_capacity(observed)
    expense_rate = measure_expense_rate(observed)

    try:
        # --- Monte Carlo.
        monte_carlo: MonteCarloOut | None = None
        monte_carlo_reason: str | None = None
        if gap is not None:
            monte_carlo_reason = _monte_carlo_refusal(gap, total)
        else:
            projection = project_monte_carlo(
                initial_cents=total.market_value_cents,
                # Signed, exactly as measured. A household spending more than
                # it earns contributes a negative amount and the band goes
                # down -- no abs(), no clamp. Zero when unmeasurable, which is
                # the honest "we know of no contribution", not a guess.
                monthly_cents=0 if capacity is None else capacity.median_cents,
                annual_return_bps=annual_return_bps,
                annual_volatility_bps=annual_volatility_bps, months=months,
                today=today, seed=seed, trials=trials, percentiles=DEFAULT_PERCENTILES,
            )
            monte_carlo = MonteCarloOut(
                initial_cents=projection.initial_cents, months=projection.months,
                assumptions=MonteCarloAssumptionsOut(
                    annual_return_bps=projection.assumptions.annual_return_bps,
                    annual_volatility_bps=projection.assumptions.annual_volatility_bps,
                    monthly_cents=projection.assumptions.monthly_cents,
                    trials=projection.assumptions.trials,
                    seed=projection.assumptions.seed,
                    percentiles=list(projection.assumptions.percentiles),
                ),
                points=[
                    MonteCarloPointOut(
                        month=point.month, on=month_end(today, point.month),
                        percentiles_cents=point.percentiles_cents,
                    )
                    for point in projection.points
                ],
                horizon_end_on=projection.horizon_end_on,
            )

        # --- FIRE.
        fire: FireOut | None = None
        fire_reason: str | None = None
        if expense_rate is None:
            fire_reason = _NO_EXPENSE_RATE_REASON
        else:
            fire = _build_fire(
                expense_rate, capacity, total.market_value_cents, gap, total, today,
                annual_return_bps, withdrawal_rate_bps, months, marginal_rate_bps,
            )

        # --- French tax.
        tax: TaxOut | None = None
        tax_reason: str | None = None
        if gap is not None:
            tax_reason = _tax_refusal(gap, total)
        else:
            tax = _build_tax(db, user, valuation, today, marginal_rate_bps, joint_taxation)

        # --- Stress tests. `shocks` is published either way: the periods and
        # the sources are facts about market history, not about this
        # household, and the screen must be able to print them regardless.
        shocks = [
            StressShockOut.model_validate(shock) for shock in stress_engine.SHOCKS
        ]
        scenarios: list[StressScenarioOut] = []
        stress_reason: str | None = None
        if gap is not None:
            stress_reason = _stress_refusal(gap, total)
        else:
            scenarios = [
                StressScenarioOut.model_validate(
                    stress_engine.apply_shock(valuation.weight_by_asset_class, shock)
                )
                for shock in stress_engine.SHOCKS
            ]
    except ValueError as exc:
        # Defence in depth for an engine bound this route does not mirror on
        # its query parameters. The engines raise in French already -- the
        # same catch-and-forward idiom `api/feasibility.py` uses.
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return ProjectionOut(
        as_of=today, reporting_currency=reporting_currency,
        assumptions=ProjectionAssumptionsOut(
            seed=seed, months=months, annual_return_bps=annual_return_bps,
            annual_volatility_bps=annual_volatility_bps, trials=trials,
            withdrawal_rate_bps=withdrawal_rate_bps, marginal_rate_bps=marginal_rate_bps,
            joint_taxation=joint_taxation, reporting_currency=reporting_currency,
            horizon_end_on=month_end(today, months),
        ),
        months_observed=len(observed),
        capacity=rate_out(capacity),
        capacity_unavailable_reason=None if capacity is not None else _NO_CAPACITY_REASON,
        expense_rate=rate_out(expense_rate),
        portfolio=ProjectionPortfolioOut(
            market_value_cents=total.market_value_cents,
            cost_basis_cents=total.cost_basis_cents,
            unrealised_gain_cents=total.unrealised_gain_cents,
            positions_total=total.positions_total,
            positions_valued=total.positions_valued,
            positions_missing_price=total.positions_missing_price,
            positions_missing_fx=total.positions_missing_fx,
            weight_by_asset_class=[
                group.__dict__ for group in valuation.weight_by_asset_class
            ],
        ),
        monte_carlo=monte_carlo, monte_carlo_unavailable_reason=monte_carlo_reason,
        fire=fire, fire_unavailable_reason=fire_reason,
        tax=tax, tax_unavailable_reason=tax_reason,
        stress=StressOut(shocks=shocks, scenarios=scenarios),
        stress_unavailable_reason=stress_reason,
    )
