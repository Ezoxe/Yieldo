"""The hosted provider: TypeSafe's Jev, behind the same contract as the rest.

Written against the published API -- `POST https://api.typesafe.ai/v1/systemone`,
a bearer key, a body carrying `state`, `model` and a map of typed questions,
and an `answers` map whose entries are `noul`, `choice` or `score`. It exists
so a household that wants the fastest available System One model can have it
without `app/trading/` knowing, and so the comparison between a hosted model
and a self-hosted one is a setting rather than a rewrite.

**The trade this provider makes, stated plainly:** the features leave the
machine. Everything Yieldo otherwise does runs on the household's own hardware;
choosing Jev sends the instrument, its indicators and the current position to a
third party on every decision. That is a legitimate choice and it is not the
default. `decision/local.py` is.

**Three shape differences from the contract, reconciled here and nowhere
else:**

* Jev's `score` is CONTINUOUS over ordered levels (1.05 across three levels),
  where `ScoreQuestion` is a whole number on a scale. Each integer of the scale
  becomes one level, and the returned position is rounded half-up back to an
  integer. Parsed through `Decimal`, never `float`.
* Jev's `noul` is a probability between 0 and 1; the contract carries basis
  points. 0.95 becomes 9 500, again through `Decimal`.
* Jev reports a `confidence` on choice and score answers. It is carried on
  `Decision.confidence_bps` and deliberately left out of `canonical()` -- it
  describes the run, not the decision, and a replay must not differ from the
  run it replays because a distribution shifted in the third decimal.

The question body and the number conversions are `decision/systemone.py`,
shared with Laya. `parse_answer` is not used here: Jev's answers are already typed by the
service, so there is no JSON-in-a-string to re-parse. The type is checked all
the same -- a `choice` outside the criteria offered is `OFF_CONTRACT`, exactly
as it would be from a local model.
"""

import json
from decimal import Decimal, InvalidOperation
from time import perf_counter
from typing import Any

import httpx

from app.decision.contract import (
    ChoiceQuestion,
    Decision,
    DecisionFailureCause,
    Question,
    ScoreQuestion,
    decision_error,
)
from app.decision.systemone import CONTEXT, bps, questions_payload, to_decimal

NAME = "jev"

DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone"
DEFAULT_MODEL = "jev-latest"

# One key per request. Jev accepts a map of questions in one call; this provider
# asks one at a time because the contract's `decide` is one question, and
# because a HOLD on the first question must cost one call rather than three.
_KEY = "q"


def _confidence_bps(answer: dict[str, Any]) -> int | None:
    if "confidence" not in answer:
        return None
    try:
        return bps(to_decimal(answer["confidence"]))
    except (ValueError, InvalidOperation):
        return None


class JevProvider:
    name = NAME

    def __init__(
        self, *, endpoint_url: str | None, model_name: str | None, api_key: str | None,
        timeout_ms: int,
    ) -> None:
        self.endpoint_url = (endpoint_url or DEFAULT_ENDPOINT).rstrip("/")
        self.model_name = model_name or DEFAULT_MODEL
        self._api_key = api_key
        self.timeout_ms = timeout_ms

    def decide(self, question: Question, context: dict[str, Any]) -> Decision:
        if not self._api_key:
            raise decision_error(
                DecisionFailureCause.MODEL_REJECTED, NAME, "aucune clé enregistrée"
            )
        payload = {
            "state": context,
            "model": self.model_name,
            "questions": {_KEY: questions_payload(question)},
        }
        started = perf_counter()
        try:
            response = httpx.post(
                self.endpoint_url,
                json=payload,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                timeout=self.timeout_ms / 1000,
            )
        except httpx.TimeoutException as exc:
            raise decision_error(
                DecisionFailureCause.TOO_SLOW, NAME, f"délai de {self.timeout_ms} ms dépassé"
            ) from exc
        except httpx.HTTPError as exc:
            raise decision_error(
                DecisionFailureCause.SERVICE_UNREACHABLE, NAME, str(exc)
            ) from exc
        latency_ms = int((perf_counter() - started) * 1000)

        if response.status_code in (401, 403):
            raise decision_error(
                DecisionFailureCause.MODEL_REJECTED, NAME, f"HTTP {response.status_code}"
            )
        if response.status_code >= 400:
            raise decision_error(
                DecisionFailureCause.SERVICE_UNREACHABLE, NAME,
                f"HTTP {response.status_code}",
            )

        raw = response.text
        try:
            # parse_float=Decimal: Jev's score and noul are decimals on the
            # wire, and float() would lose the exactness before it is rounded.
            body = json.loads(raw, parse_float=Decimal)
            answer = body["answers"][_KEY]
        except (ValueError, KeyError, TypeError) as exc:
            raise decision_error(
                DecisionFailureCause.OFF_CONTRACT, NAME, "réponse sans réponse exploitable"
            ) from exc

        model = str(body.get("model") or self.model_name)
        common = {
            "question_key": question.key, "kind": question.kind, "latency_ms": latency_ms,
            "provider": NAME, "model": model, "raw": raw,
        }

        if isinstance(question, ChoiceQuestion):
            chosen = answer.get("choice")
            if not isinstance(chosen, str) or chosen not in question.options:
                raise decision_error(
                    DecisionFailureCause.OFF_CONTRACT, NAME,
                    f"« {chosen} » n'est pas une des options proposées",
                )
            return Decision(
                choice=chosen, score_value=None, probability_bps=None,
                confidence_bps=_confidence_bps(answer), **common,
            )

        if isinstance(question, ScoreQuestion):
            try:
                position = to_decimal(answer.get("score"))
            except (ValueError, InvalidOperation) as exc:
                raise decision_error(
                    DecisionFailureCause.OFF_CONTRACT, NAME,
                    f"« {answer.get('score')} » n'est pas une note",
                ) from exc
            level = int(CONTEXT.quantize(position, Decimal(1))) + question.minimum
            if not question.minimum <= level <= question.maximum:
                raise decision_error(
                    DecisionFailureCause.OFF_CONTRACT, NAME,
                    f"la note {level} sort de l'échelle {question.minimum}-{question.maximum}",
                )
            return Decision(
                choice=None, score_value=level, probability_bps=None,
                confidence_bps=_confidence_bps(answer), **common,
            )

        try:
            probability = to_decimal(answer.get("noul"))
        except (ValueError, InvalidOperation) as exc:
            raise decision_error(
                DecisionFailureCause.OFF_CONTRACT, NAME,
                f"« {answer.get('noul')} » n'est pas une probabilité",
            ) from exc
        if not Decimal(0) <= probability <= Decimal(1):
            raise decision_error(
                DecisionFailureCause.OFF_CONTRACT, NAME,
                f"la probabilité {probability} sort de 0-1",
            )
        return Decision(
            choice=None, score_value=None,
            probability_bps=bps(probability),
            confidence_bps=None, **common,
        )
