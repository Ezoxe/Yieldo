"""The model against the rules: how often they agree on the direction.

Beside every decision a real model takes, `trading/service.py` stores what
the built-in deterministic engine would have answered on the same context
(`TradeDecision.second_opinion`). This engine reads those pairs and says how
often the two agreed, and lists where they did not, most recent first.

**Direction only.** Conviction and continuation shape the size; direction
is the answer that costs money, and a model that agrees with four momentum
rules on it nine times out of ten has not yet shown it is worth its latency.
That is the question this figure exists to keep visible.

**No opinion is not a disagreement.** A decision the model failed on has no
model choice; a decision taken by the deterministic engine itself has no
second opinion. Neither is compared.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from app.decision.contract import BPS_WHOLE

# Enough disagreements to read the pattern, few enough to fit in a panel.
DISAGREEMENTS_SHOWN = 8


@dataclass(frozen=True)
class Opinion:
    decision_id: int
    symbol: str
    created_at: datetime
    model_choice: str | None
    rules_choice: str | None


@dataclass(frozen=True)
class Disagreement:
    decision_id: int
    symbol: str
    model_choice: str
    rules_choice: str
    created_at: datetime


@dataclass(frozen=True)
class Agreement:
    compared: int
    agreed: int
    agreement_bps: int
    disagreements: tuple[Disagreement, ...]


def compare(opinions: Iterable[Opinion]) -> Agreement:
    compared = 0
    agreed = 0
    disagreements: list[Disagreement] = []
    for opinion in opinions:
        if opinion.model_choice is None or opinion.rules_choice is None:
            continue
        compared += 1
        if opinion.model_choice == opinion.rules_choice:
            agreed += 1
        else:
            disagreements.append(Disagreement(
                decision_id=opinion.decision_id, symbol=opinion.symbol,
                model_choice=opinion.model_choice, rules_choice=opinion.rules_choice,
                created_at=opinion.created_at,
            ))
    agreement_bps = 0
    if compared:
        agreement_bps = int(
            (Decimal(agreed) * BPS_WHOLE / Decimal(compared)).quantize(
                Decimal(1), rounding=ROUND_HALF_UP
            )
        )
    disagreements.sort(key=lambda row: (row.created_at, row.decision_id), reverse=True)
    return Agreement(
        compared=compared, agreed=agreed, agreement_bps=agreement_bps,
        disagreements=tuple(disagreements[:DISAGREEMENTS_SHOWN]),
    )
