"""The rules: what the model is asked, what it is never asked, and how an
answer becomes a size.

This module is the mandate's other half. `engines/trading_risk` says what may
be sent; this says what may even be considered. Between them the model's
authority is bounded on both sides, and what is left to it is exactly three
questions with exactly three answer types.

**The model never chooses a size.** It answers "acheter / vendre / ne rien
faire", a conviction from 0 to 10, and a probability that the move continues.
`size_intent` below turns those into a quantity with arithmetic a person can
read and a test can pin. This is `llm/tools.py`'s rule -- "the model never
calculates" -- carried into a place where the consequence of breaking it is
money rather than a wrong figure on a screen.

**The model is not asked at all when the situation is one the rules already
answer.** `prefilter` runs first, on the features alone, and a refusal there
costs nothing and cannot be argued with. Volatility above the mandate's
ceiling, a position already at its limit, an instrument off the whitelist: the
model is never consulted, so it never has the chance to be persuasive about
it.

**Everything the model sees is a figure an engine computed.** `build_context`
hands it `MarketFeatures` and the position, both integers, both already
persisted as the decision's inputs. No free text from the outside world
reaches it -- no news headline, no ticker description, no label a third party
wrote. That is the prompt-injection boundary, and it is drawn by what this
function is physically able to put in the context rather than by an
instruction asking the model to behave.
"""

from dataclasses import dataclass
from decimal import ROUND_DOWN, Context, Decimal
from typing import Any

from app.decision.contract import ChoiceQuestion, Decision, ProbabilityQuestion, ScoreQuestion
from app.engines.quantity import SCALE, Quantity
from app.engines.signals import MarketFeatures
from app.engines.trading_risk import BPS_WHOLE, Mandate, OrderIntent

_FLOOR = Context(prec=100, rounding=ROUND_DOWN)
_UNIT_QUANTUM = Decimal(1).scaleb(-SCALE)

BUY = "acheter"
SELL = "vendre"
HOLD = "ne rien faire"

DIRECTION = ChoiceQuestion(
    key="direction",
    prompt=(
        "Au vu des seuls indicateurs fournis, quelle action sur cet instrument ? "
        "Réponds par une des options exactement."
    ),
    options=(BUY, SELL, HOLD),
)

CONVICTION = ScoreQuestion(
    key="conviction",
    prompt=(
        "À quel point cette lecture des indicateurs est-elle nette ? "
        "0 = les indicateurs se contredisent, 10 = ils vont tous dans le même sens."
    ),
    minimum=0,
    maximum=10,
)

CONTINUATION = ProbabilityQuestion(
    key="continuation",
    statement=(
        "Le mouvement décrit par ces indicateurs se poursuit sur la prochaine période "
        "plutôt que de s'inverser."
    ),
)

# The three, in the order they are asked. A tuple because the order is part of
# the contract: `direction` first, so a HOLD short-circuits the other two and
# costs one call instead of three.
QUESTIONS = (DIRECTION, CONVICTION, CONTINUATION)

# The rules, in French, as the household reads them on the Salle de contrôle
# screen. Data, not prose buried in a branch: the screen prints this tuple, and
# a rule that changes in the code changes here too or the screen lies.
DECLARED_RULES = (
    "Le modèle ne voit que des indicateurs calculés par Yieldo — jamais un titre "
    "d'actualité, jamais un texte écrit par un tiers.",
    "Le modèle ne choisit jamais une taille de position : il donne un sens, une "
    "conviction et une probabilité ; la taille est calculée par Yieldo.",
    "Une conviction inférieure au seuil du mandat, ou une probabilité inférieure à son "
    "seuil, ne déclenche aucun ordre.",
    "Une volatilité supérieure au plafond du mandat écarte l'instrument sans consulter "
    "le modèle.",
    "Une réponse hors du type attendu est écartée, jamais corrigée.",
    "Tout ordre passe ensuite par le mandat, qui peut le réduire ou le refuser.",
)


@dataclass(frozen=True)
class StrategySettings:
    """The thresholds a household sets, beside the mandate's own ceilings.

    Separate from `Mandate` because they answer a different question: the
    mandate limits what may be risked, these decide when the model's answer is
    considered worth acting on at all. A household that wants to watch without
    trading raises `minimum_conviction` to 11 and nothing ever fires.
    """

    minimum_conviction: int = 6
    minimum_probability_bps: int = 5_500
    # Above this, the instrument is skipped without asking the model.
    max_volatility_bps: int = 1_500
    # The share of the per-position ceiling a conviction of 10 would commit.
    # 10 000 = the whole ceiling; 5 000 = half of it at maximum conviction.
    full_conviction_share_bps: int = 10_000


@dataclass(frozen=True)
class PositionSnapshot:
    """What is held, as the model is told it. Integers only."""

    quantity: Quantity
    average_price_cents: int
    market_value_cents: int
    unrealised_pnl_bps: int


@dataclass(frozen=True)
class Skip:
    """The instrument was not put to the model, and why. A French sentence,
    shown on the Salle de contrôle beside the instruments that WERE examined --
    an instrument silently absent from a decision feed is indistinguishable
    from one the pipeline forgot."""

    rule: str
    message: str


def prefilter(
    features: MarketFeatures, mandate: Mandate, settings: StrategySettings
) -> Skip | None:
    """The rules that answer without the model. Cheapest first."""
    if features.symbol.upper() not in {s.upper() for s in mandate.allowed_symbols}:
        return Skip(
            "symbol_not_allowed",
            f"« {features.symbol} » n'est pas dans la liste du mandat : le modèle n'est "
            "pas consulté.",
        )
    if features.volatility_bps > settings.max_volatility_bps:
        return Skip(
            "volatility_ceiling",
            f"La volatilité de « {features.symbol} » ({features.volatility_bps / 100:.2f} %) "
            f"dépasse le plafond du mandat ({settings.max_volatility_bps / 100:.2f} %) : "
            "le modèle n'est pas consulté.",
        )
    if features.last_price_cents <= 0:
        return Skip(
            "no_price",
            f"Aucun cours exploitable pour « {features.symbol} » : le modèle n'est pas "
            "consulté.",
        )
    return None


def _euros(cents: int) -> str:
    """A price the way a reader reads it. `Decimal` at the display boundary
    and nowhere before it -- and this IS a display boundary: the model reads
    the context, and « 3086 » invites it to reason about three thousand."""
    return f"{Decimal(cents) / 100:.2f} €".replace(".", ",")


def _percent(bps: int, *, signed: bool = False) -> str:
    body = f"{Decimal(bps) / 100:.2f}".replace(".", ",")
    sign = "+" if signed and bps > 0 else ""
    return f"{sign}{body} %"


def _reading(features: MarketFeatures) -> str:
    """One sentence naming what the indicators say, in words rather than in
    figures. An encoder reads « la moyenne courte est sous la longue » far
    better than it reads a negative integer of basis points."""
    trend = (
        "la moyenne courte est au-dessus de la longue (tendance en hausse)"
        if features.trend_bps > 0
        else "la moyenne courte est sous la longue (tendance en baisse)"
        if features.trend_bps < 0
        else "les deux moyennes sont confondues (pas de tendance)"
    )
    momentum = (
        "le cours monte sur la fenêtre récente"
        if features.momentum_bps > 0
        else "le cours baisse sur la fenêtre récente"
        if features.momentum_bps < 0
        else "le cours est stable sur la fenêtre récente"
    )
    rsi = (
        "le RSI est haut (acheteurs dominants, risque de surachat)"
        if features.rsi_bps >= 7_000
        else "le RSI est bas (vendeurs dominants, possible survente)"
        if features.rsi_bps <= 3_000
        else "le RSI est au milieu de sa plage"
    )
    canal = (
        "le cours est en haut de son canal"
        if features.range_position_bps >= 7_500
        else "le cours est en bas de son canal"
        if features.range_position_bps <= 2_500
        else "le cours est au milieu de son canal"
    )
    return f"{trend} ; {momentum} ; {rsi} ; {canal}."


def build_context(
    features: MarketFeatures, position: PositionSnapshot | None
) -> dict[str, Any]:
    """Everything the model is given, and nothing else.

    French keys, because they are shown to the household verbatim on the
    decision's detail panel: the screen prints the context as it was sent, so a
    reader sees the model's actual input rather than a summary of it.

    **Every figure travels twice**, as the integer the engines carry and as
    the string a reader reads. The integers are the audited input; the strings
    are what a text encoder can actually use, and a model sent « 3086 » reads
    three thousand and eighty-six of something rather than thirty euros.

    **What is possible is stated, not implied.** With nothing held, a sale is
    impossible (short selling is a mandate permission, and the pipeline refuses
    a sale of nothing); saying so in the context is the difference between a
    model that answers « vendre » into the void -- measured: 217 of 234
    decisions on one simulated day, 158 of them dying on « rien à vendre » --
    and a model choosing among the options it actually has. The mandate still
    checks everything afterwards: this tells the model the truth, it does not
    trust it.
    """
    context: dict[str, Any] = {
        "instrument": features.symbol,
        "dernier_cours_centimes": features.last_price_cents,
        "dernier_cours": _euros(features.last_price_cents),
        "moyenne_courte_centimes": features.sma_short_cents,
        "moyenne_courte": _euros(features.sma_short_cents),
        "moyenne_longue_centimes": features.sma_long_cents,
        "moyenne_longue": _euros(features.sma_long_cents),
        "tendance_points_de_base": features.trend_bps,
        "tendance": _percent(features.trend_bps),
        "momentum_points_de_base": features.momentum_bps,
        "momentum": _percent(features.momentum_bps),
        "rsi_points_de_base": features.rsi_bps,
        "rsi": _percent(features.rsi_bps),
        "volatilite_points_de_base": features.volatility_bps,
        "volatilite": _percent(features.volatility_bps),
        "repli_depuis_le_plus_haut_points_de_base": features.drawdown_bps,
        "repli_depuis_le_plus_haut": _percent(features.drawdown_bps),
        "position_dans_le_canal_points_de_base": features.range_position_bps,
        "position_dans_le_canal": _percent(features.range_position_bps),
        "cours_observes": features.closes_seen,
        "lecture": _reading(features),
    }
    if position is None or position.quantity.value == 0:
        context["position_detenue"] = None
        context["actions_possibles"] = [BUY, HOLD]
        context["situation"] = (
            f"Vous ne détenez aucune position sur {features.symbol}. Vendre est impossible : "
            "il n'y a rien à vendre. Les seules réponses utiles sont « acheter » ou "
            "« ne rien faire »."
        )
    else:
        context["position_detenue"] = {
            "quantite": str(position.quantity),
            "prix_de_revient_centimes": position.average_price_cents,
            "prix_de_revient": _euros(position.average_price_cents),
            "valeur_centimes": position.market_value_cents,
            "valeur": _euros(position.market_value_cents),
            "plus_ou_moins_value_points_de_base": position.unrealised_pnl_bps,
            "plus_ou_moins_value": _percent(position.unrealised_pnl_bps, signed=True),
        }
        context["actions_possibles"] = [BUY, SELL, HOLD]
        context["situation"] = (
            f"Vous détenez {position.quantity} {features.symbol}, achetés en moyenne à "
            f"{_euros(position.average_price_cents)}, soit "
            f"{_percent(position.unrealised_pnl_bps, signed=True)} pour l'instant. Vous pouvez "
            "acheter davantage, vendre ce que vous détenez, ou ne rien faire."
        )
    return context


@dataclass(frozen=True)
class Bundle:
    """The three answers together, as one decision about one instrument."""

    direction: Decision
    conviction: Decision | None
    continuation: Decision | None

    @property
    def acts(self) -> bool:
        return self.direction.choice in (BUY, SELL)

    def canonical(self) -> dict[str, Any]:
        return {
            "direction": self.direction.canonical(),
            "conviction": None if self.conviction is None else self.conviction.canonical(),
            "continuation": (
                None if self.continuation is None else self.continuation.canonical()
            ),
        }


def gate(bundle: Bundle, settings: StrategySettings) -> Skip | None:
    """The thresholds, applied to the answers. Returns None when the bundle
    clears them and an order should be sized."""
    if not bundle.acts:
        return Skip("hold", "Le modèle ne propose aucune action sur cet instrument.")
    if bundle.conviction is None or bundle.conviction.score_value is None:
        return Skip(
            "no_conviction",
            "Aucune conviction n'a été obtenue : aucun ordre n'est dimensionné sans elle.",
        )
    if bundle.conviction.score_value < settings.minimum_conviction:
        return Skip(
            "conviction_threshold",
            f"Conviction {bundle.conviction.score_value}/10, pour un seuil de "
            f"{settings.minimum_conviction}/10 : aucun ordre.",
        )
    if bundle.continuation is None or bundle.continuation.probability_bps is None:
        return Skip(
            "no_probability",
            "Aucune probabilité n'a été obtenue : aucun ordre n'est dimensionné sans elle.",
        )
    if bundle.continuation.probability_bps < settings.minimum_probability_bps:
        return Skip(
            "probability_threshold",
            f"Probabilité de continuation {bundle.continuation.probability_bps / 100:.0f} %, "
            f"pour un seuil de {settings.minimum_probability_bps / 100:.0f} % : aucun ordre.",
        )
    return None


def size_intent(
    *,
    features: MarketFeatures,
    bundle: Bundle,
    mandate: Mandate,
    settings: StrategySettings,
    position: PositionSnapshot | None,
) -> OrderIntent | Skip:
    """The answers, as a quantity. All arithmetic, no model.

    A buy commits a share of the per-position ceiling proportional to the
    conviction: conviction 10 commits `full_conviction_share_bps` of it,
    conviction 6 commits six tenths of that. A sell closes the same proportion
    of what is actually held -- never more, and never a short, because the
    mandate forbids one and this module does not try.
    """
    blocked = gate(bundle, settings)
    if blocked is not None:
        return blocked

    assert bundle.conviction is not None and bundle.conviction.score_value is not None
    conviction = bundle.conviction.score_value
    side = "buy" if bundle.direction.choice == BUY else "sell"

    share_bps = _FLOOR.divide(
        _FLOOR.multiply(Decimal(settings.full_conviction_share_bps), Decimal(conviction)),
        Decimal(CONVICTION.maximum),
    )

    if side == "buy":
        budget = _FLOOR.divide(
            _FLOOR.multiply(Decimal(mandate.max_position_cents), share_bps),
            Decimal(BPS_WHOLE),
        )
        quantity = Quantity(
            _FLOOR.quantize(
                _FLOOR.divide(budget, Decimal(features.last_price_cents)), _UNIT_QUANTUM
            )
        )
        if quantity.value <= 0:
            return Skip(
                "budget_too_small",
                f"La part du plafond engagée à cette conviction ne suffit pas à acheter une "
                f"fraction de « {features.symbol} » : aucun ordre.",
            )
    else:
        if position is None or position.quantity.value <= 0:
            return Skip(
                "nothing_held",
                f"Le modèle propose de vendre « {features.symbol} », mais rien n'est "
                "détenu et le mandat interdit la vente à découvert.",
            )
        quantity = Quantity(
            _FLOOR.quantize(
                _FLOOR.divide(
                    _FLOOR.multiply(position.quantity.value, share_bps), Decimal(BPS_WHOLE)
                ),
                _UNIT_QUANTUM,
            )
        )
        if quantity.value <= 0:
            return Skip(
                "sale_too_small",
                "La part de la position à vendre à cette conviction est nulle : aucun ordre.",
            )

    return OrderIntent(
        symbol=features.symbol,
        side=side,
        quantity=quantity,
        order_type="market",
        reference_price_cents=features.last_price_cents,
    )
