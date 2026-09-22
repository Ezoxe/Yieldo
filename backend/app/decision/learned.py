"""Le modèle que le foyer a entraîné lui-même, sur son propre processeur.

Cinquième fournisseur, et le seul qui n'attend rien de personne : pas de
réseau, pas de clé, pas de carte graphique. Les poids viennent de
`engines/logistic`, entraînés en quelques secondes sur le marché du bac à
sable, et vivent dans `DecisionSettings.learned_model`.

**Pourquoi il existe.** Mesuré avec `engines/model_eval`, deux fenêtres
lointaines : Laya en zero-shot obtient 51 % d'exactitude et un avantage NET
de -9,5 points de base, qui s'inverse d'une fenêtre à l'autre ; ce modèle-ci
obtient 63 à 66 % et +157 à +228 points de base nets sur deux fenêtres
jamais vues. Neuf nombres se lisent avec neuf poids, pas avec 421 millions.

**Il répond dans le contrat, comme les autres.** Une probabilité de hausse
devient un sens (acheter au-dessus du seuil, vendre sous son miroir quand
la vente est offerte, ne rien faire entre les deux), une conviction (la
distance au pile-ou-face, sur dix), et la probabilité elle-même pour la
question de continuation. Le mandat vérifie tout derrière, inchangé.

**Ce qu'il sait, et ce qu'il ne sait pas.** Il apprend le marché sur lequel
il a été entraîné. Entraîné sur le bac à sable, il connaît le bac à sable ;
ses poids ne disent rien d'un vrai marché tant qu'ils n'ont pas été
réentraînés sur de vrais cours, et le garde-fou d'armement reste le juge.
"""

from time import perf_counter
from typing import Any

from app.decision.contract import (
    ChoiceQuestion,
    Decision,
    DecisionFailureCause,
    Question,
    ScoreQuestion,
    decision_error,
)
from app.decision.strategy import BUY, HOLD, SELL
from app.engines.logistic import LearnedModel, vector_of
from app.engines.signals import MarketFeatures

NAME = "learned"

# Au-dessus, le modèle achète ; sous son miroir (1 - seuil), il vend ce qu'il
# détient. Entre les deux il ne fait rien : mesuré, un seuil de 0,7 double
# l'avantage net d'un seuil de 0,5 en divisant par quatre le nombre d'ordres.
DEFAULT_THRESHOLD = 0.7


class LearnedProvider:
    name = NAME

    def __init__(self, *, model: LearnedModel, threshold: float = DEFAULT_THRESHOLD) -> None:
        self.model = model
        self.threshold = threshold

    def _probability(self, context: dict[str, Any]) -> float:
        features = _features_of(context)
        return self.model.probability(vector_of(features))

    def decide(self, question: Question, context: dict[str, Any]) -> Decision:
        started = perf_counter()
        probability = self._probability(context)
        latency_ms = int((perf_counter() - started) * 1000)
        common = {
            "question_key": question.key, "kind": question.kind, "latency_ms": latency_ms,
            "provider": NAME, "model": f"logistique-{len(self.model.weights)}",
            "raw": f"p={probability:.4f}",
            "confidence_bps": round(abs(probability - 0.5) * 2 * 10_000),
        }

        if isinstance(question, ChoiceQuestion):
            if probability >= self.threshold and BUY in question.options:
                choice = BUY
            elif probability <= 1 - self.threshold and SELL in question.options:
                choice = SELL
            else:
                choice = HOLD
            if choice not in question.options:
                raise decision_error(
                    DecisionFailureCause.OFF_CONTRACT, NAME,
                    f"« {choice} » n'est pas une des options proposées",
                )
            return Decision(choice=choice, score_value=None, probability_bps=None, **common)

        if isinstance(question, ScoreQuestion):
            # La conviction est la distance au pile-ou-face, sur l'échelle
            # offerte : 0,5 donne 0, 1,0 ou 0,0 donnent le maximum.
            span = question.maximum - question.minimum
            level = question.minimum + round(abs(probability - 0.5) * 2 * span)
            return Decision(
                choice=None, score_value=max(question.minimum, min(question.maximum, level)),
                probability_bps=None, **common,
            )

        return Decision(
            choice=None, score_value=None,
            probability_bps=round(max(probability, 1 - probability) * 10_000), **common,
        )


def _features_of(context: dict[str, Any]) -> MarketFeatures:
    """Le contexte porte les entiers d'origine à côté de leur forme lisible ;
    ce sont eux que le modèle lit. Une clé manquante est une erreur nommée,
    jamais un zéro qui se fait passer pour une mesure."""
    try:
        return MarketFeatures(
            symbol=str(context["instrument"]),
            closes_seen=int(context.get("cours_observes") or 0),
            last_price_cents=int(context["dernier_cours_centimes"]),
            sma_short_cents=int(context["moyenne_courte_centimes"]),
            sma_long_cents=int(context["moyenne_longue_centimes"]),
            trend_bps=int(context["tendance_points_de_base"]),
            momentum_bps=int(context["momentum_points_de_base"]),
            rsi_bps=int(context["rsi_points_de_base"]),
            volatility_bps=int(context["volatilite_points_de_base"]),
            drawdown_bps=int(context["repli_depuis_le_plus_haut_points_de_base"]),
            range_position_bps=int(context["position_dans_le_canal_points_de_base"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise decision_error(
            DecisionFailureCause.OFF_CONTRACT, NAME,
            "le contexte ne porte pas les indicateurs attendus",
        ) from exc
