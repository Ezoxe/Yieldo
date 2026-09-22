"""What a simulated day teaches: labelled examples for a fine-tune.

Yieldo measured, over 1 032 decisions on its own sandbox, that Laya's answers
correlate 0,003 to 0,028 with what the market did next -- indistinguishable
from zero. An encoder with a decision head does not learn a domain from a
better prompt; its authors say so plainly (« fine-tuning is where most of the
value is »), and a base checkpoint scores near random on typed decisions.

The one thing a fine-tune needs is labelled examples, and the sandbox is the
one place where the label is not a guess: the market is deterministic, so for
every state a model was shown, what happened next is knowable exactly. This
engine turns a day into that dataset -- pure, no session, no clock.

**The label is what could have been executed, not what would have been
clever.** With nothing held, a fall labels « ne rien faire » rather than
« vendre »: the pipeline could not have sold, and training a model to answer
an option it will never be offered teaches it nothing. That is the same rule
`strategy.direction_question` applies at decision time, on the other side of
the loop.

**The dead band is what makes a label honest.** A move of ten basis points
over one step is noise, and labelling it « acheter » teaches a model to trade
on noise -- which costs the spread every time. Below the band, the answer is
« ne rien faire », and its conviction is zero.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

BUY = "acheter"
SELL = "vendre"
HOLD = "ne rien faire"

# The move, in basis points, above which a step is a signal rather than noise.
DEFAULT_DEAD_BAND_BPS = 100
# How many steps ahead the label looks.
DEFAULT_HORIZON = 3
# A move this far past the dead band is the top of the conviction scale.
FULL_CONVICTION_MULTIPLE = 4


@dataclass(frozen=True)
class Example:
    """One state and the three answers the future says were right."""

    state: dict[str, Any]
    options: tuple[str, ...]
    direction: str
    conviction: int
    continuation: bool
    move_bps: int

    def canonical(self) -> dict[str, Any]:
        """The row a trainer reads, in Laya's own `predict` vocabulary."""
        return {
            "state": self.state,
            "questions": {
                "direction": {
                    "type": "choice",
                    "instructions": (
                        "Au vu des seuls indicateurs fournis, quelle action sur cet "
                        "instrument ? Réponds par une des options exactement."
                    ),
                    "criteria": {option: option for option in self.options},
                },
                "conviction": {
                    "type": "score",
                    "instructions": (
                        "À quel point cette lecture des indicateurs est-elle nette ? "
                        "0 = les indicateurs se contredisent, 10 = ils vont tous dans le "
                        "même sens."
                    ),
                    "criteria": [str(level) for level in range(11)],
                },
                "continuation": {
                    "type": "noul",
                    "instructions": (
                        "Le mouvement décrit par ces indicateurs se poursuit sur la "
                        "prochaine période plutôt que de s'inverser."
                    ),
                    "criteria": {"true": "L'affirmation est vraie.",
                                 "false": "L'affirmation est fausse."},
                },
            },
            "answers": {
                "direction": self.direction,
                "conviction": self.conviction,
                "continuation": self.continuation,
            },
            "move_bps": self.move_bps,
        }


def _bps(before: int, after: int) -> int:
    if before == 0:
        return 0
    return int((Decimal(after - before) * 10_000 / Decimal(before)).quantize(
        Decimal(1), rounding=ROUND_HALF_UP))


def _conviction(move_bps: int, dead_band_bps: int) -> int:
    """0 inside the band, 10 at `FULL_CONVICTION_MULTIPLE` times it."""
    size = abs(move_bps)
    if size <= dead_band_bps:
        return 0
    span = dead_band_bps * (FULL_CONVICTION_MULTIPLE - 1)
    if span <= 0:
        return 10
    steps = int((Decimal(size - dead_band_bps) * 10 / Decimal(span)).quantize(
        Decimal(1), rounding=ROUND_HALF_UP))
    return max(0, min(10, steps))


def label_examples(
    states: Sequence[tuple[dict[str, Any], int, Sequence[str]]],
    *,
    horizon: int = DEFAULT_HORIZON,
    dead_band_bps: int = DEFAULT_DEAD_BAND_BPS,
) -> tuple[Example, ...]:
    """`(state, price at that state, options offered)` in order, in; labelled
    examples out. The last `horizon` states have no future and are left out --
    an example whose label had to be guessed is worse than no example."""
    out: list[Example] = []
    for index in range(len(states) - horizon):
        state, price, options = states[index]
        _, later_price, _ = states[index + horizon]
        move = _bps(price, later_price)
        can_sell = SELL in options
        if move > dead_band_bps:
            direction = BUY if BUY in options else HOLD
        elif move < -dead_band_bps:
            direction = SELL if can_sell else HOLD
        else:
            direction = HOLD
        conviction = 0 if direction == HOLD else _conviction(move, dead_band_bps)
        out.append(Example(
            state=state, options=tuple(options), direction=direction,
            conviction=conviction, continuation=abs(move) > dead_band_bps,
            move_bps=move,
        ))
    return tuple(out)
