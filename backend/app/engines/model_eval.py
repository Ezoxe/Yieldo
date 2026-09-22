"""Un modèle décide-t-il, ou devine-t-il ? Le protocole qui tranche.

Pure. On lui donne, pour une série d'états, ce que le modèle a répondu et ce
que le marché a fait ensuite, et il rend trois chiffres qu'une opinion ne
peut pas contredire :

* **l'exactitude**, et ce que vaudrait le MÊME mélange de réponses tiré au
  hasard. Répondre « acheter » partout sur un marché qui monte donne une
  belle exactitude et aucune compétence ;
* **le p par permutation** : sur des vérités mélangées mille fois, à quelle
  fréquence ce score est-il atteint ? Au-dessus de 0,05, il n'y a rien ;
* **l'edge net**, en points de base : le mouvement moyen qui suit un achat,
  MOINS celui du marché sur la même fenêtre, MOINS le coût d'exécution.
  C'est le seul des trois qui parle d'argent, et le seul qui décide.

**Un edge mesuré sur une fenêtre n'est pas un edge.** Le marché du bac à
sable a des cycles ; une fenêtre qui monte fait briller n'importe quel
modèle qui achète. `compare_windows` exige deux fenêtres éloignées et ne
déclare un signal que si les deux le montrent -- c'est exactement le test
qui a disqualifié Laya en zero-shot : edge +69 bps sur la première fenêtre,
-19 bps sur la seconde, à horizon 48.
"""

import random
import statistics
from collections.abc import Sequence
from dataclasses import dataclass

BUY = "acheter"

# Un aller-retour au carnet simulé : dix points de base de chaque côté.
DEFAULT_COST_BPS = 20
PERMUTATION_DRAWS = 2_000


@dataclass(frozen=True)
class Verdict:
    states: int
    accuracy_bps: int
    chance_accuracy_bps: int
    p_value_bps: int
    buys: int
    buy_move_bps: int
    market_move_bps: int
    edge_bps: int
    net_edge_bps: int

    @property
    def significant(self) -> bool:
        """Le score dépasse-t-il le hasard ? Statistique seulement."""
        return self.p_value_bps < 500

    @property
    def profitable(self) -> bool:
        """Et l'edge paie-t-il l'exécution ? La seule question qui compte."""
        return self.net_edge_bps > 0


def _accuracy(predictions: Sequence[str], labels: Sequence[str]) -> float:
    if not labels:
        return 0.0
    pairs = zip(predictions, labels, strict=True)
    return sum(1 for answer, truth in pairs if answer == truth) / len(labels)


def _chance(predictions: Sequence[str], labels: Sequence[str]) -> float:
    """Ce que vaudrait le même mélange de réponses, indépendant de l'état."""
    if not labels:
        return 0.0
    total = len(labels)
    classes = set(labels) | set(predictions)
    return sum(
        (sum(1 for p in predictions if p == c) / total)
        * (sum(1 for truth in labels if truth == c) / total)
        for c in classes
    )


def _permutation_p(
    predictions: Sequence[str], labels: Sequence[str], draws: int, seed: int
) -> float:
    observed = _accuracy(predictions, labels)
    rng = random.Random(seed)
    shuffled = list(labels)
    beaten = 0
    for _ in range(draws):
        rng.shuffle(shuffled)
        if _accuracy(predictions, shuffled) >= observed:
            beaten += 1
    return (beaten + 1) / (draws + 1)


def evaluate(
    predictions: Sequence[str],
    labels: Sequence[str],
    moves_bps: Sequence[int],
    *,
    cost_bps: int = DEFAULT_COST_BPS,
    draws: int = PERMUTATION_DRAWS,
    seed: int = 7,
) -> Verdict:
    """Un verdict sur une fenêtre. `moves_bps` est ce que le marché a fait
    après chaque état, sur l'horizon choisi par l'appelant."""
    if not labels or len(labels) != len(predictions) or len(labels) != len(moves_bps):
        raise ValueError(
            "Il faut autant de réponses que d'étiquettes et de mouvements, "
            "et au moins un état."
        )
    picked = [
        move for answer, move in zip(predictions, moves_bps, strict=True)
        if answer == BUY
    ]
    buy_move = statistics.mean(picked) if picked else 0.0
    market_move = statistics.mean(moves_bps)
    edge = buy_move - market_move if picked else 0.0
    return Verdict(
        states=len(labels),
        accuracy_bps=round(_accuracy(predictions, labels) * 10_000),
        chance_accuracy_bps=round(_chance(predictions, labels) * 10_000),
        p_value_bps=round(_permutation_p(predictions, labels, draws, seed) * 10_000),
        buys=len(picked),
        buy_move_bps=round(buy_move),
        market_move_bps=round(market_move),
        edge_bps=round(edge),
        net_edge_bps=round(edge - cost_bps) if picked else 0,
    )


def compare_windows(first: Verdict, second: Verdict) -> tuple[bool, str]:
    """Deux fenêtres éloignées, et la phrase française qui les lit.

    Un signal n'est retenu que s'il tient sur les deux : c'est ce qui sépare
    une compétence d'une fenêtre favorable.
    """
    if not (first.significant and second.significant):
        weak = first if not first.significant else second
        return False, (
            f"Sur une des deux fenêtres, le score ({weak.accuracy_bps / 100:.1f} %) ne se "
            f"distingue pas du hasard (p = {weak.p_value_bps / 100:.2f} %). Ce modèle ne "
            "décide pas : il répond."
        )
    if not (first.profitable and second.profitable):
        return False, (
            f"Le modèle bat le hasard, mais son avantage ne paie pas l'exécution sur les "
            f"deux fenêtres : {first.net_edge_bps} et {second.net_edge_bps} points de base "
            "nets. Un avantage inférieur au coût d'un aller-retour fait perdre de l'argent "
            "à chaque ordre."
        )
    return True, (
        f"Le modèle bat le hasard sur les deux fenêtres et son avantage paie l'exécution : "
        f"{first.net_edge_bps} et {second.net_edge_bps} points de base nets."
    )
