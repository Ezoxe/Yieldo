"""The typed decision: what a decision model may be asked, and what it may
answer.

Yieldo's answer to Jev. TypeSafe's model returns a *typed decision* rather than
prose -- pick one of these options, score this on this scale, or give the
probability that this statement is true -- and that shape, not any particular
vendor, is what makes a model safe to put in front of money. This module is
that shape, written down once, so the three providers in this package
(`local`, `jev`, `replay`) are interchangeable and so a household can move
between them without a single line of `app/trading/` changing.

**The type is enforced here, not hoped for.** `parse_*` below refuses an
answer that is not exactly in the type: an option that was never offered, a
score outside the scale, a probability outside 0-100. There is no fuzzy match,
no nearest-option, no "the model probably meant buy". A model that answers off
contract has failed, and `OFF_CONTRACT` is a named failure with its own French
sentence -- not a value silently coerced into range. That refusal is the entire
reason a model may be handed a trading pipeline at all: the worst an
off-contract answer can do is stop the run.

**The model is never asked what to do.** It is asked a bounded question from
`decision/strategy.py`, whose options were written by a person and stored in
the mandate. "Acheter, vendre ou ne rien faire" is a choice among three known
strings; it is not an instruction the model composes. Everything downstream --
sizing, the mandate, the venue -- is code.

**Five failure causes, never collapsed into each other**, exactly as
`market/client.py` argues at length for its own five: no model configured, the
model refused the credentials, the service could not be reached, it answered
too late for a decision that is only useful in milliseconds, or it answered
outside its own type. Each names a different remedy. `failure_message` is the
one place their French is written.
"""

import json
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Protocol, runtime_checkable

# What a question asks for. The three shapes a System One model answers in --
# the same three Jev exposes, because they are the three that can be checked.
KINDS = ("choice", "score", "probability")

BPS_WHOLE = 10_000

# Where a decision came from. Stored on every decision row so a household can
# tell a sandbox replay from a real model answer months later.
PROVIDERS = ("local", "jev", "laya", "replay")

PROVIDER_LABELS = {
    "local": "modèle auto-hébergé",
    "jev": "Jev (TypeSafe)",
    "laya": "Laya (auto-hébergé)",
    "replay": "moteur déterministe intégré",
}


class DecisionFailureCause(StrEnum):
    NO_MODEL = "no_model"
    MODEL_REJECTED = "model_rejected"
    SERVICE_UNREACHABLE = "service_unreachable"
    TOO_SLOW = "too_slow"
    OFF_CONTRACT = "off_contract"


class DecisionError(Exception):
    """One of the five causes above, carrying a French sentence already fit to
    show a household -- built by `failure_message`, never typed again at the
    call site."""

    def __init__(self, cause: DecisionFailureCause, message: str) -> None:
        super().__init__(message)
        self.cause = cause
        self.message = message


def failure_message(
    cause: DecisionFailureCause, provider: str, detail: str | None = None
) -> str:
    label = PROVIDER_LABELS.get(provider, provider)
    suffix = f" ({detail})" if detail else ""
    if cause is DecisionFailureCause.NO_MODEL:
        return (
            "Aucun modèle de décision n'est configuré : ouvrez Investissement → Modèle de "
            "décision et indiquez-en un. Rien n'est décidé tant qu'il n'y en a pas."
        )
    if cause is DecisionFailureCause.MODEL_REJECTED:
        return (
            f"Le {label} a refusé les identifiants fournis{suffix}. Vérifiez la clé dans "
            "Investissement → Modèle de décision."
        )
    if cause is DecisionFailureCause.SERVICE_UNREACHABLE:
        return (
            f"Le {label} est injoignable{suffix}. Vérifiez qu'il tourne et que son adresse "
            "est joignable depuis cette machine ; aucune décision n'est prise en attendant."
        )
    if cause is DecisionFailureCause.TOO_SLOW:
        return (
            f"Le {label} a répondu hors du délai accordé{suffix}. Une décision qui arrive "
            "trop tard porte sur un marché qui n'existe plus : elle est écartée. Augmentez "
            "le délai dans Investissement → Modèle de décision, ou prenez un modèle plus "
            "rapide."
        )
    return (
        f"Le {label} a répondu hors du contrat attendu{suffix}. Sa réponse est écartée "
        "plutôt que corrigée : un modèle qui invente une option n'en décide aucune."
    )


def decision_error(
    cause: DecisionFailureCause, provider: str, detail: str | None = None
) -> DecisionError:
    return DecisionError(cause, failure_message(cause, provider, detail))


@dataclass(frozen=True)
class ChoiceQuestion:
    """Pick exactly one of `options`.

    `options` is a tuple of exact strings, and the answer is compared against
    them exactly. They are written by a person, in `decision/strategy.py`, and
    they travel with the stored decision so a replay asks the identical
    question.
    """

    key: str  # stable identifier, e.g. "direction"
    prompt: str
    options: tuple[str, ...]
    kind: str = "choice"


@dataclass(frozen=True)
class ScoreQuestion:
    """Rate on an integer scale the caller defines, both ends inclusive."""

    key: str
    prompt: str
    minimum: int
    maximum: int
    kind: str = "score"


@dataclass(frozen=True)
class ProbabilityQuestion:
    """How likely is `statement` to be true? Answered in basis points."""

    key: str
    statement: str
    kind: str = "probability"


Question = ChoiceQuestion | ScoreQuestion | ProbabilityQuestion


@dataclass(frozen=True)
class Decision:
    """One typed answer, and everything needed to judge it later.

    Exactly one of `choice`, `score_value` and `probability_bps` is set, by the
    question's kind. `raw` keeps what actually came back over the wire --
    unparsed, untouched -- because an audit that cannot see the original answer
    is an audit of this module's parser rather than of the model.
    """

    question_key: str
    kind: str
    choice: str | None
    score_value: int | None
    probability_bps: int | None
    latency_ms: int
    provider: str
    model: str
    raw: str
    # How sure the model says it is, 0..10 000, when the provider reports it at
    # all. Jev derives it from the answer's own probability distribution; an
    # OpenAI-compatible endpoint has no comparable figure and leaves it None
    # rather than inventing one from token logprobs, which do not map onto an
    # option cleanly enough to be called a confidence. Calibration is measured
    # from the PROBABILITY question instead (`engines/calibration.py`), which
    # every provider answers and which can be checked against what happened.
    confidence_bps: int | None = None
    # The model's whole distribution, when the provider exposes it: option →
    # bps for a choice, level → bps for a score. Laya returns it; an
    # OpenAI-compatible endpoint does not. Like `confidence_bps` it describes
    # this run's output and stays out of `canonical()`.
    mass_bps: dict[str, int] | None = None
    # Laya's act/escalate head: how sure it is that acting is right at all,
    # in bps. None from every other provider.
    act_bps: int | None = None

    def canonical(self) -> dict[str, Any]:
        """The stable mapping the audit chain hashes and the replay compares.

        `latency_ms` is deliberately ABSENT: it is a fact about one run, not
        about the decision, and including it would make every replay differ
        from the run it replays.
        """
        return {
            "question_key": self.question_key,
            "kind": self.kind,
            "choice": self.choice,
            "score_value": self.score_value,
            "probability_bps": self.probability_bps,
        }


@runtime_checkable
class DecisionProvider(Protocol):
    """What every provider in this package implements, and all `app/trading/`
    knows about. Three implementations ship: `local` (an OpenAI-compatible
    endpoint with constrained decoding -- vLLM, llama.cpp, Ollama), `jev`
    (TypeSafe's hosted model) and `replay` (deterministic, no network)."""

    name: str

    def decide(self, question: Question, context: dict[str, Any]) -> Decision:
        """Answer, or raise `DecisionError`. Never returns a fallback."""
        ...


def json_schema_for(question: Question) -> dict[str, Any]:
    """The JSON Schema a constrained decoder is given so the answer cannot be
    off contract in the first place.

    This is the mechanism that reproduces what makes Jev trustworthy on an open
    model: vLLM (XGrammar), llama.cpp and Ollama all accept a schema and mask
    the sampler to it, so "acheter" is the only token path available where
    `enum` says so. `parse_answer` below still checks -- a schema the server
    ignored must not become a decision -- but with a constrained decoder the
    check passes by construction rather than by luck.
    """
    if isinstance(question, ChoiceQuestion):
        answer: dict[str, Any] = {"type": "string", "enum": list(question.options)}
    elif isinstance(question, ScoreQuestion):
        answer = {
            "type": "integer", "minimum": question.minimum, "maximum": question.maximum,
        }
    else:
        answer = {"type": "integer", "minimum": 0, "maximum": 100}
    return {
        "type": "object",
        "properties": {"answer": answer},
        "required": ["answer"],
        "additionalProperties": False,
    }


def parse_answer(question: Question, raw: str, provider: str) -> dict[str, Any]:
    """`raw` as a typed answer, or `OFF_CONTRACT`.

    Returns the three answer fields, of which exactly one is not None. Strict
    on purpose, in every direction:

    * the payload must be JSON with an `answer` key -- prose around it is not
      unwrapped, because a model that ignored the schema once may have ignored
      it in ways this parser cannot see;
    * a choice must be one of `options`, compared exactly after stripping
      surrounding whitespace -- never case-folded, never nearest-match;
    * a score must be a whole number inside the scale -- a float is refused
      rather than rounded, because a model that answered 7,4 on a 0-10 scale
      did not answer the question that was asked.
    """
    text = raw.strip()
    try:
        payload = json.loads(text)
    except (ValueError, TypeError) as exc:
        raise decision_error(
            DecisionFailureCause.OFF_CONTRACT, provider,
            "réponse illisible, JSON attendu",
        ) from exc
    if not isinstance(payload, dict) or "answer" not in payload:
        raise decision_error(
            DecisionFailureCause.OFF_CONTRACT, provider, "clé « answer » absente"
        )
    answer = payload["answer"]

    if isinstance(question, ChoiceQuestion):
        if not isinstance(answer, str) or answer.strip() not in question.options:
            raise decision_error(
                DecisionFailureCause.OFF_CONTRACT, provider,
                f"« {answer} » n'est pas une des options proposées",
            )
        return {"choice": answer.strip(), "score_value": None, "probability_bps": None}

    if isinstance(question, ScoreQuestion):
        # `bool` is an `int` in Python, and True would sail through as 1.
        if isinstance(answer, bool) or not isinstance(answer, int):
            raise decision_error(
                DecisionFailureCause.OFF_CONTRACT, provider,
                f"« {answer} » n'est pas une note entière",
            )
        if not question.minimum <= answer <= question.maximum:
            raise decision_error(
                DecisionFailureCause.OFF_CONTRACT, provider,
                f"la note {answer} sort de l'échelle {question.minimum}-{question.maximum}",
            )
        return {"choice": None, "score_value": answer, "probability_bps": None}

    if isinstance(answer, bool) or not isinstance(answer, int):
        raise decision_error(
            DecisionFailureCause.OFF_CONTRACT, provider,
            f"« {answer} » n'est pas une probabilité entière en pourcentage",
        )
    if not 0 <= answer <= 100:
        raise decision_error(
            DecisionFailureCause.OFF_CONTRACT, provider,
            f"la probabilité {answer} sort de 0-100",
        )
    return {"choice": None, "score_value": None, "probability_bps": answer * 100}


def question_from_payload(payload: dict[str, Any]) -> Question:
    """Rebuild a question from the JSON stored beside the decision it produced.

    The oversight replay asks the question that WAS asked, not the one the
    catalogue holds today. A threshold moved or an option reworded since would
    otherwise turn every old decision into a false mismatch, and a replay that
    cries drift on every row is a replay nobody reads.
    """
    kind = payload.get("kind")
    key = str(payload.get("key") or "")
    if kind == "choice":
        return ChoiceQuestion(
            key=key, prompt=str(payload.get("prompt") or ""),
            options=tuple(payload.get("options") or ()),
        )
    if kind == "score":
        return ScoreQuestion(
            key=key, prompt=str(payload.get("prompt") or ""),
            minimum=int(payload.get("minimum", 0)), maximum=int(payload.get("maximum", 10)),
        )
    if kind == "probability":
        return ProbabilityQuestion(key=key, statement=str(payload.get("statement") or ""))
    raise ValueError(f"Type de question inconnu : {kind!r}")
