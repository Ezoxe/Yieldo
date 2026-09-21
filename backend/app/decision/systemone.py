"""The System One dialect: what Jev and Laya both speak.

TypeSafe published it for Jev; Laya describes itself as Jev-compatible and
`tools/laya-server/` serves it the same way. The question body and the two
number conversions live here once, so the two providers cannot drift from
each other on how an option, a level or a probability is written on the wire
or read back.

Everything numeric is `Decimal`: a score is a continuous position over the
levels (1.05 across three levels), a probability is 0..1, and both are
rounded half-up into the contract's integers exactly once, here.
"""

from decimal import ROUND_HALF_UP, Context, Decimal, InvalidOperation
from typing import Any

from app.decision.contract import BPS_WHOLE, ChoiceQuestion, Question, ScoreQuestion

CONTEXT = Context(prec=50, rounding=ROUND_HALF_UP)


def questions_payload(question: Question) -> dict[str, Any]:
    """One question in the dialect: `type`, `instructions`, `criteria`."""
    if isinstance(question, ChoiceQuestion):
        return {
            "type": "choice",
            "instructions": question.prompt,
            # The criteria map an option to what it means. The options here
            # are already French sentences a person wrote, so each describes
            # itself; sending the option twice is honest rather than clever.
            "criteria": {option: option for option in question.options},
        }
    if isinstance(question, ScoreQuestion):
        return {
            "type": "score",
            "instructions": question.prompt,
            "criteria": [str(level) for level in range(question.minimum, question.maximum + 1)],
        }
    return {
        "type": "noul",
        "instructions": question.statement,
        "criteria": {
            "true": "L'affirmation est vraie.",
            "false": "L'affirmation est fausse.",
        },
    }


def to_decimal(value: Any) -> Decimal:
    """A number off the wire as an exact Decimal. Bodies are parsed with
    `parse_float=Decimal`, so a float here is a caller's mistake, not data."""
    if isinstance(value, Decimal):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return Decimal(value)
    raise ValueError(f"valeur numérique attendue, reçu {value!r}")


def bps(value: Decimal) -> int:
    """0..1 into 0..10 000, rounded half-up."""
    return int(CONTEXT.quantize(CONTEXT.multiply(value, Decimal(BPS_WHOLE)), Decimal(1)))


def mass_bps(probabilities: Any) -> dict[str, int] | None:
    """A `{label: probability}` map into `{label: bps}`; anything that is not
    such a map, or holds a value that is not a number, is None rather than a
    half-parsed dict -- the screen then shows no distribution, never a wrong one."""
    if not isinstance(probabilities, dict) or not probabilities:
        return None
    out: dict[str, int] = {}
    for label, value in probabilities.items():
        try:
            out[str(label)] = bps(to_decimal(value))
        except (ValueError, InvalidOperation):
            return None
    return out
