"""Laya, self-hosted: an encoder that answers in the System One dialect.

`convaiinnovations/laya` is ModernBERT-large with a decision head -- not a
language model. It cannot write prose, so an answer outside the type is not
refused so much as unrepresentable; the type is checked here all the same,
because a server in front of money is trusted for what it returns, not for
what it is. It runs on the household's own hardware (a CPU is enough:
~650 ms a question on ten cores) behind `tools/laya-server/`, which speaks
the same body as Jev and returns more.

**What this provider carries that Jev does not.** Laya returns its whole
distribution -- the probability mass per option for a choice, per level for a
score -- and the act probability of its act/escalate head. Both land on the
`Decision` as `mass_bps` and `act_bps`, in basis points through `Decimal`,
outside `canonical()`: they describe this run's output, and the screen shows
them so a household can see whether « acheter » at 0,36 is a decision or a
coin toss. That visibility is the point: Laya's authors report it
over-confident out of the box and near random zero-shot on typed decisions,
and the mass makes both readable on the first decision rather than after
fifty.

**No key by default.** The server is on the household's network; a key is
sent only when one is stored, and then as a bearer. The default endpoint is
none at all -- `build_provider` refuses a Laya row without an address, which
names the screen to open.

`probe()` reads `GET /health` for Modèle de décision's card: the checkpoint,
the machine, the percentiles. It fails the way a decision fails.
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
from app.decision.systemone import CONTEXT, bps, mass_bps, questions_payload, to_decimal

NAME = "laya"

# One question per call, as Jev: a HOLD on the first costs one call, and on
# a CPU three questions in one call take three times as long anyway.
_KEY = "q"


def _optional_bps(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return bps(to_decimal(value))
    except (ValueError, InvalidOperation):
        return None


class LayaProvider:
    name = NAME

    def __init__(
        self, *, endpoint_url: str, model_name: str | None, api_key: str | None,
        timeout_ms: int,
    ) -> None:
        self.endpoint_url = endpoint_url.rstrip("/")
        self.model_name = model_name
        self._api_key = api_key
        self.timeout_ms = timeout_ms

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def probe(self) -> dict[str, Any]:
        """The server's health card, or the same failure a decision would raise."""
        try:
            response = httpx.get(
                f"{self.endpoint_url}/health", headers=self._headers(),
                timeout=self.timeout_ms / 1000,
            )
        except httpx.TimeoutException as exc:
            raise decision_error(
                DecisionFailureCause.TOO_SLOW, NAME, f"délai de {self.timeout_ms} ms dépassé"
            ) from exc
        except httpx.HTTPError as exc:
            raise decision_error(DecisionFailureCause.SERVICE_UNREACHABLE, NAME, str(exc)) from exc
        if response.status_code >= 400:
            raise decision_error(
                DecisionFailureCause.SERVICE_UNREACHABLE, NAME, f"HTTP {response.status_code}"
            )
        try:
            body = response.json()
        except ValueError as exc:
            raise decision_error(
                DecisionFailureCause.OFF_CONTRACT, NAME, "carte de santé illisible"
            ) from exc
        if not isinstance(body, dict):
            raise decision_error(
                DecisionFailureCause.OFF_CONTRACT, NAME, "carte de santé illisible"
            )
        return body

    def decide(self, question: Question, context: dict[str, Any]) -> Decision:
        payload = {"state": context, "questions": {_KEY: questions_payload(question)}}
        started = perf_counter()
        try:
            response = httpx.post(
                f"{self.endpoint_url}/v1/systemone", json=payload, headers=self._headers(),
                timeout=self.timeout_ms / 1000,
            )
        except httpx.TimeoutException as exc:
            raise decision_error(
                DecisionFailureCause.TOO_SLOW, NAME, f"délai de {self.timeout_ms} ms dépassé"
            ) from exc
        except httpx.HTTPError as exc:
            raise decision_error(DecisionFailureCause.SERVICE_UNREACHABLE, NAME, str(exc)) from exc
        latency_ms = int((perf_counter() - started) * 1000)

        if response.status_code in (401, 403):
            raise decision_error(
                DecisionFailureCause.MODEL_REJECTED, NAME, f"HTTP {response.status_code}"
            )
        if response.status_code >= 400:
            raise decision_error(
                DecisionFailureCause.SERVICE_UNREACHABLE, NAME, f"HTTP {response.status_code}"
            )

        raw = response.text
        try:
            # parse_float=Decimal: the score, the probabilities and the mass
            # are decimals on the wire, and float() would lose the exactness
            # before it is rounded.
            body = json.loads(raw, parse_float=Decimal)
            answer = body["answers"][_KEY]
            if not isinstance(answer, dict):
                raise TypeError(answer)
        except (ValueError, KeyError, TypeError) as exc:
            raise decision_error(
                DecisionFailureCause.OFF_CONTRACT, NAME, "réponse sans réponse exploitable"
            ) from exc

        model = str(body.get("model") or self.model_name or NAME)
        common = {
            "question_key": question.key, "kind": question.kind, "latency_ms": latency_ms,
            "provider": NAME, "model": model, "raw": raw,
            "confidence_bps": _optional_bps(answer.get("confidence")),
            "act_bps": _optional_bps(answer.get("act_probability")),
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
                mass_bps=mass_bps(answer.get("probabilities")), **common,
            )

        if isinstance(question, ScoreQuestion):
            try:
                position = to_decimal(answer.get("score"))
            except (ValueError, InvalidOperation) as exc:
                raise decision_error(
                    DecisionFailureCause.OFF_CONTRACT, NAME,
                    f"« {answer.get('score')} » n'est pas une note",
                ) from exc
            # Laya's score is a continuous position from 0 over the levels
            # offered; the levels were offered from `minimum` upward.
            level = int(CONTEXT.quantize(position, Decimal(1))) + question.minimum
            if not question.minimum <= level <= question.maximum:
                raise decision_error(
                    DecisionFailureCause.OFF_CONTRACT, NAME,
                    f"la note {level} sort de l'échelle {question.minimum}-{question.maximum}",
                )
            return Decision(
                choice=None, score_value=level, probability_bps=None,
                mass_bps=mass_bps(answer.get("probabilities")), **common,
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
            choice=None, score_value=None, probability_bps=bps(probability),
            mass_bps=None, **common,
        )
