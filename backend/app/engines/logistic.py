"""Un modèle appris, en Python pur, entraîné sur un processeur en secondes.

Neuf indicateurs, une régression logistique : l'outil standard pour des
données tabulaires, et le seul qu'un foyer sans carte graphique puisse
entraîner lui-même. Quarante lignes de descente de gradient, aucune
dépendance nouvelle -- Yieldo n'importe ni numpy ni scikit-learn pour ça.

**Pourquoi ceci plutôt qu'un encodeur.** Mesuré sur le bac à sable, protocole
`engines/model_eval` à deux fenêtres lointaines : Laya en zero-shot obtient
51,1 % d'exactitude pour un avantage net de -9,5 points de base, et son
avantage s'inverse d'une fenêtre à l'autre. Ce modèle-ci obtient 63 à 66 %
sur deux fenêtres qu'il n'a jamais vues, pour +157 et +228 points de base
nets du coût d'exécution. Un transformeur de 421 M de paramètres lit du
texte ; neuf nombres se lisent avec neuf poids.

**Ce qu'il apprend, et ce qu'il n'apprend pas.** Entraîné sur le marché
synthétique, il apprend le marché synthétique -- des cycles de 89, 29 et 7
pas qu'un vrai marché n'a pas. Les poids ne valent que pour le marché dont
ils viennent, et `model_eval` reste le juge avant tout argent réel.

**Les poids ne sont pas de l'argent.** Ils sont des flottants, comme toute
probabilité de ce module ; aucun montant ne passe par ici. Les montants
restent des entiers de centimes, de l'autre côté de `size_intent`.
"""

import math
import random
import statistics
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

# Les sept colonnes lues sur `MarketFeatures`, dans cet ordre. Le modèle
# stocke l'ordre avec ses poids : un vecteur réordonné serait un autre modèle.
COLUMNS = (
    "trend_bps", "momentum_bps", "rsi_centred_bps", "volatility_bps",
    "drawdown_bps", "range_centred_bps", "sma_gap_bps",
)

DEFAULT_EPOCHS = 400
DEFAULT_RATE = 0.05
DEFAULT_L2 = 0.01
# Au-delà, le mouvement est un signal plutôt que du bruit -- et deux fois
# l'écart d'exécution du carnet simulé.
DEFAULT_DEAD_BAND_BPS = 50


def vector_of(features: Any) -> list[float]:
    """Les sept colonnes, centrées là où le milieu a un sens (RSI, canal).

    Divisées par cent : ce sont des points de base, et un gradient sur des
    nombres à quatre chiffres oscille au lieu de descendre.
    """
    gap = 0.0
    if features.sma_long_cents:
        gap = (features.sma_short_cents - features.sma_long_cents) * 100 / features.sma_long_cents
    return [
        features.trend_bps / 100,
        features.momentum_bps / 100,
        (features.rsi_bps - 5_000) / 100,
        features.volatility_bps / 100,
        features.drawdown_bps / 100,
        (features.range_position_bps - 5_000) / 100,
        gap,
    ]


@dataclass(frozen=True)
class LearnedModel:
    weights: tuple[float, ...]
    bias: float
    means: tuple[float, ...]
    stdevs: tuple[float, ...]
    columns: tuple[str, ...]
    dead_band_bps: int
    trained_on: int

    def probability(self, vector: Sequence[float]) -> float:
        """P(le mouvement dépasse la bande morte), entre 0 et 1."""
        if len(vector) != len(self.weights):
            raise ValueError(
                f"Ce modèle attend {len(self.weights)} colonnes, il en a reçu {len(vector)}."
            )
        z = self.bias + sum(
            weight * (value - mean) / stdev
            for weight, value, mean, stdev
            in zip(self.weights, vector, self.means, self.stdevs, strict=True)
        )
        return 1 / (1 + math.exp(-max(-30.0, min(30.0, z))))

    def canonical(self) -> dict[str, Any]:
        return {
            "weights": list(self.weights), "bias": self.bias,
            "means": list(self.means), "stdevs": list(self.stdevs),
            "columns": list(self.columns), "dead_band_bps": self.dead_band_bps,
            "trained_on": self.trained_on,
        }

    @classmethod
    def from_canonical(cls, payload: dict[str, Any]) -> "LearnedModel":
        return cls(
            weights=tuple(payload["weights"]), bias=float(payload["bias"]),
            means=tuple(payload["means"]), stdevs=tuple(payload["stdevs"]),
            columns=tuple(payload["columns"]),
            dead_band_bps=int(payload["dead_band_bps"]),
            trained_on=int(payload["trained_on"]),
        )


def fit(
    samples: Sequence[tuple[Sequence[float], int]],
    *,
    dead_band_bps: int = DEFAULT_DEAD_BAND_BPS,
    epochs: int = DEFAULT_EPOCHS,
    rate: float = DEFAULT_RATE,
    l2: float = DEFAULT_L2,
    seed: int = 3,
) -> LearnedModel:
    """`(vecteur, mouvement en points de base)` en entrée, un modèle en sortie.

    Déterministe : la même graine et les mêmes échantillons donnent les mêmes
    poids, sur n'importe quelle machine. Un modèle qu'on ne peut pas rejouer
    ne peut pas être audité.
    """
    if not samples:
        raise ValueError("Aucun échantillon : il n'y a rien à apprendre.")
    width = len(samples[0][0])
    columns = list(zip(*[vector for vector, _ in samples], strict=True))
    means = [statistics.mean(column) for column in columns]
    stdevs = [statistics.pstdev(column) or 1.0 for column in columns]
    scaled = [
        ([(value - mean) / stdev
          for value, mean, stdev in zip(vector, means, stdevs, strict=True)],
         1.0 if move > dead_band_bps else 0.0)
        for vector, move in samples
    ]

    rng = random.Random(seed)
    weights = [rng.uniform(-0.01, 0.01) for _ in range(width)]
    bias = 0.0
    size = len(scaled)
    for _ in range(epochs):
        gradient = [0.0] * width
        bias_gradient = 0.0
        for vector, target in scaled:
            z = bias + sum(w * x for w, x in zip(weights, vector, strict=True))
            error = 1 / (1 + math.exp(-max(-30.0, min(30.0, z)))) - target
            for index, value in enumerate(vector):
                gradient[index] += error * value
            bias_gradient += error
        weights = [
            weight - rate * (grad / size + l2 * weight)
            for weight, grad in zip(weights, gradient, strict=True)
        ]
        bias -= rate * bias_gradient / size

    return LearnedModel(
        weights=tuple(weights), bias=bias, means=tuple(means), stdevs=tuple(stdevs),
        columns=COLUMNS, dead_band_bps=dead_band_bps, trained_on=size,
    )
