"""Was the model right as often as it said it would be?

Pure. This is the one measurement that judges a decision model rather than a
strategy, and the distinction matters: a strategy can be profitable with a
badly calibrated model (it got lucky on size) and ruinous with a well
calibrated one (it sized badly). A household about to let software trade its
money is owed both readings, separately.

**Calibration, not accuracy.** A model that says "65 %" should be right about
sixty-five times in a hundred. Being right ninety times in a hundred while
saying 65 % is not a better model -- it is a model whose numbers do not mean
what they say, and a mandate that sizes positions off those numbers is sizing
off noise. `buckets()` below is that comparison, band by band.

**The Brier score, in basis points.** One number for the whole record: the
mean squared distance between the stated probability and what happened. Lower
is better, 0 is perfect, 2 500 bps is what a model that always says 50 % gets,
and anything above that is worse than a coin. Reported alongside that
reference line rather than alone, because a Brier score with nothing to
compare it to says nothing to a reader who has never seen one.

No float, here as everywhere: probabilities are basis points and the score is
basis points, computed through a local `decimal.Context`.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Context, Decimal

from app.french import counted

_CONTEXT = Context(prec=100, rounding=ROUND_HALF_UP)

BPS_WHOLE = 10_000

# A coin-flipping model's Brier score, in bps: 0,25 in the usual scale, and the
# line every real score is read against.
COIN_FLIP_BRIER_BPS = 2_500

# Ten-point bands. Narrower bands need more observations before any of them
# says anything; wider ones hide the dishonest tail where a model says 95 %.
_BAND_WIDTH_BPS = 1_000


@dataclass(frozen=True)
class Observation:
    """One stated probability and what actually happened.

    `probability_bps` is what the model said before the fact;
    `happened` is what the ledger recorded after it. Nothing in this module
    computes either -- it only compares them.
    """

    probability_bps: int
    happened: bool


@dataclass(frozen=True)
class Bucket:
    lower_bps: int
    upper_bps: int  # exclusive, except for the last band
    count: int
    # The mean probability the model stated inside this band.
    stated_bps: int
    # The share that actually happened.
    observed_bps: int
    # observed - stated. Positive means the model was too cautious in this
    # band, negative means too confident.
    gap_bps: int


@dataclass(frozen=True)
class CalibrationReport:
    observations: int
    buckets: tuple[Bucket, ...]
    brier_bps: int
    coin_flip_brier_bps: int
    # A one-sentence French reading, built here so the screen, the PDF and the
    # oversight API cannot word the same measurement three ways.
    verdict: str


def _mean_bps(values: list[int]) -> int:
    return int(
        _CONTEXT.quantize(
            _CONTEXT.divide(Decimal(sum(values)), Decimal(len(values))), Decimal(1)
        )
    )


def _brier_bps(observations: tuple[Observation, ...]) -> int:
    """Mean of (stated - outcome)², with both on the 0..1 scale, returned in
    basis points of that same squared scale."""
    total = Decimal(0)
    for observation in observations:
        outcome = Decimal(BPS_WHOLE if observation.happened else 0)
        difference = _CONTEXT.subtract(Decimal(observation.probability_bps), outcome)
        squared = _CONTEXT.multiply(difference, difference)
        # (difference/10 000)² × 10 000 = difference² / 10 000.
        total = _CONTEXT.add(total, _CONTEXT.divide(squared, Decimal(BPS_WHOLE)))
    return int(
        _CONTEXT.quantize(
            _CONTEXT.divide(total, Decimal(len(observations))), Decimal(1)
        )
    )


def _verdict(observations: int, brier_bps: int) -> str:
    if observations < 20:
        return (
            f"{counted(observations, 'décision probabilisée', 'décisions probabilisées')} "
            "seulement : trop peu pour juger la "
            "calibration. Laissez tourner le bac à sable plus longtemps."
        )
    if brier_bps >= COIN_FLIP_BRIER_BPS:
        return (
            "Le modèle fait moins bien qu'une pièce lancée en l'air : ses probabilités ne "
            "portent aucune information exploitable. Ne lui confiez pas d'argent réel."
        )
    if brier_bps >= 2_000:
        return (
            "Le modèle fait un peu mieux qu'une pièce lancée en l'air, sans plus. Ses "
            "probabilités sont trop bruitées pour dimensionner une position."
        )
    if brier_bps >= 1_200:
        return (
            "Le modèle est honnêtement calibré : ses probabilités veulent dire ce "
            "qu'elles disent."
        )
    return (
        "Le modèle est bien calibré. Vérifiez que les décisions ne portent pas toutes sur "
        "le même instrument avant d'en conclure quoi que ce soit."
    )


# How many probabilised decisions must have been followed by a next step
# before a track record means anything. Twenty is what `_verdict` already
# calls too few to judge; real money asks for the same floor.
TRACK_RECORD_MINIMUM = 20


def beats_a_coin_toss(report: "CalibrationReport") -> tuple[bool, str]:
    """Whether this model has EARNED real money, and the French sentence
    saying why not.

    A Brier score is the only figure in this application that compares a
    model's own claim to what happened. Below the floor there is nothing to
    read; at or above the coin-flip score the model's probabilities are worth
    no more than a toss, and a household about to hand it real money should
    hear that before typing the phrase, not after.
    """
    if report.observations < TRACK_RECORD_MINIMUM:
        return False, (
            f"Ce modèle n'a que {report.observations} décision"
            f"{'s' if report.observations > 1 else ''} probabilisée"
            f"{'s' if report.observations > 1 else ''} suivie"
            f"{'s' if report.observations > 1 else ''} d'un tour suivant, pour un minimum de "
            f"{TRACK_RECORD_MINIMUM} : rien ne permet encore de dire s'il fait mieux que "
            "pile ou face. Laissez-le tourner en mode papier, puis lisez « Le modèle dit-il "
            "vrai ? » sur la Salle de contrôle."
        )
    if report.brier_bps >= report.coin_flip_brier_bps:
        return False, (
            f"Sur {report.observations} décisions probabilisées, ce modèle obtient un score de "
            f"Brier de {report.brier_bps / 100:.2f} % pour un pile ou face à "
            f"{report.coin_flip_brier_bps / 100:.2f} % : ses probabilités ne valent pas mieux "
            "qu'un tirage. L'exécution réelle reste fermée. Le détail est sur la Salle de "
            "contrôle, panneau « Le modèle dit-il vrai ? »."
        )
    return True, ""


def evaluate_calibration(observations: tuple[Observation, ...]) -> CalibrationReport:
    if not observations:
        return CalibrationReport(
            observations=0, buckets=(), brier_bps=0,
            coin_flip_brier_bps=COIN_FLIP_BRIER_BPS,
            verdict="Aucune décision probabilisée n'a encore été enregistrée.",
        )

    bands: dict[int, list[Observation]] = {}
    for observation in observations:
        clamped = min(max(observation.probability_bps, 0), BPS_WHOLE)
        # The last band is closed on the right so a stated 100 % lands in
        # 90-100 rather than opening a band of its own.
        index = min(clamped // _BAND_WIDTH_BPS, BPS_WHOLE // _BAND_WIDTH_BPS - 1)
        bands.setdefault(index, []).append(observation)

    buckets: list[Bucket] = []
    for index in sorted(bands):
        inside = bands[index]
        stated = _mean_bps([o.probability_bps for o in inside])
        observed = _mean_bps([BPS_WHOLE if o.happened else 0 for o in inside])
        buckets.append(Bucket(
            lower_bps=index * _BAND_WIDTH_BPS,
            upper_bps=(index + 1) * _BAND_WIDTH_BPS,
            count=len(inside), stated_bps=stated, observed_bps=observed,
            gap_bps=observed - stated,
        ))

    brier = _brier_bps(observations)
    return CalibrationReport(
        observations=len(observations), buckets=tuple(buckets), brier_bps=brier,
        coin_flip_brier_bps=COIN_FLIP_BRIER_BPS,
        verdict=_verdict(len(observations), brier),
    )
