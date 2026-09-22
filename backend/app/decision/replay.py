"""The deterministic provider: the same three questions, answered by rules.

Not a fallback. Nothing selects it automatically, and no failure of the other
two providers ever degrades into it -- CLAUDE.md's no-silent-failures rule
forbids exactly that, and a fabricated trading decision is the worst possible
instance of it. It is one of three providers a household may *choose*, in
Investissement → Modèle de décision, and the screen names it for what it is:
« moteur déterministe intégré ».

It earns its place three times over:

* **The sandbox has a baseline.** A model is worth its latency only if it beats
  rules anyone can read. Run the bac à sable on `replay` for a week and you
  have the line every other provider has to clear.
* **The test suite has a model.** Every test of `trading/service.py` needs a
  provider; a network one would make the suite non-deterministic, and a mock
  would test the mock. This is neither.
* **The oversight replay has something to compare against.** Re-running a
  stored decision through a sampled model tells you little; re-running it
  through this one tells you exactly what the rules said at the time.

Pure in everything but the clock it reads to report its own latency, which no
`canonical()` includes.
"""

import json
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

NAME = "replay"
MODEL = "yieldo-regles-1"

# Where each indicator stops being noise. Basis points, and deliberately
# round: these are a baseline, not a tuned strategy, and pretending to a
# precision nobody measured would be the wrong kind of confidence.
_TREND_EDGE_BPS = 50          # 0,50 % between the two moving averages
_MOMENTUM_EDGE_BPS = 100      # 1,00 % over the momentum window
_RSI_OVERBOUGHT_BPS = 7_000
_RSI_OVERSOLD_BPS = 3_000


def _votes(context: dict[str, Any]) -> tuple[int, int, int]:
    """(up, down, total) -- how many indicators point each way.

    Reading the context rather than `MarketFeatures` keeps this provider
    honest: it sees exactly what a hosted model would be sent, no more.
    """
    trend = int(context.get("tendance_points_de_base", 0))
    momentum = int(context.get("momentum_points_de_base", 0))
    rsi = int(context.get("rsi_points_de_base", 5_000))
    channel = int(context.get("position_dans_le_canal_points_de_base", 5_000))

    up = 0
    down = 0
    for pointing_up, pointing_down in (
        (trend > _TREND_EDGE_BPS, trend < -_TREND_EDGE_BPS),
        (momentum > _MOMENTUM_EDGE_BPS, momentum < -_MOMENTUM_EDGE_BPS),
        # An oversold instrument is a reason to buy, an overbought one a reason
        # to sell -- the mean-reversion reading, held against the two trend
        # indicators on purpose so agreement means something.
        (rsi < _RSI_OVERSOLD_BPS, rsi > _RSI_OVERBOUGHT_BPS),
        (channel < 2_000, channel > 8_000),
    ):
        up += 1 if pointing_up else 0
        down += 1 if pointing_down else 0
    return up, down, 4


class ReplayProvider:
    name = NAME

    def decide(self, question: Question, context: dict[str, Any]) -> Decision:
        started = perf_counter()
        up, down, total = _votes(context)

        if isinstance(question, ChoiceQuestion):
            if up > down:
                answer: Any = BUY
            elif down > up:
                answer = SELL
            else:
                answer = HOLD
            if answer not in question.options:
                # Yieldo asks only for what can be executed: with nothing held
                # the sale is not offered (`strategy.direction_question`), and
                # the honest verdict is then « ne rien faire » -- the engine
                # read a fall, and doing nothing IS what a fall with an empty
                # book allows. Anything else offered and refused would mean the
                # catalogue changed under this provider, and that is a failure.
                if answer == SELL and HOLD in question.options:
                    answer = HOLD
                else:
                    raise decision_error(
                        DecisionFailureCause.OFF_CONTRACT, NAME,
                        f"« {answer} » n'est pas une des options proposées",
                    )
            fields = {"choice": answer, "score_value": None, "probability_bps": None}
        elif isinstance(question, ScoreQuestion):
            # Conviction is agreement: four indicators all pointing one way is
            # the top of the scale, a two-two split is the bottom.
            margin = abs(up - down)
            span = question.maximum - question.minimum
            value = question.minimum + round(margin * span / total)
            fields = {"choice": None, "score_value": int(value), "probability_bps": None}
        else:
            # A monotone map from agreement to probability, centred on 50 %:
            # four agreeing indicators read 70 %, none read 50 %. Never 0 or
            # 100 -- a rule engine that claims certainty is lying about itself,
            # and `engines/calibration.py` would score it accordingly.
            leaning = max(up, down)
            fields = {
                "choice": None, "score_value": None,
                "probability_bps": 5_000 + leaning * 500,
            }

        return Decision(
            question_key=question.key, kind=question.kind,
            latency_ms=int((perf_counter() - started) * 1000),
            provider=NAME, model=MODEL,
            raw=json.dumps(
                {"votes_haussiers": up, "votes_baissiers": down, "indicateurs": total},
                ensure_ascii=False, sort_keys=True,
            ),
            confidence_bps=None,
            **fields,
        )
