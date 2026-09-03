"""The optional language model: an OpenAI-compatible chat-completions call,
and the four French causes an attempt to reach it can fail for. Design
§8.3, phase 4 plan Task 8.

**THE CONTRACT THAT GOVERNS THIS WHOLE MODULE: THE MODEL NEVER CALCULATES.**
`request_commentary` below sends the model a prompt built from a figure an
engine already computed (`build_commentary_prompt`) and returns whatever
prose comes back as an opaque `str` -- full stop. Nothing in this module
ever parses a number OUT of that string: there is no regex, no `Decimal(...)`
call, no field anywhere in this module's return types that could carry a
figure the model wrote. A completion that hallucinates a wrong number only
ever reaches the household as PROSE, sitting beside the correct figure the
calling engine produced -- never as `amount_cents`, never as anything a
screen would render as a measurement. `tests/test_llm_client.py::
test_a_wrong_number_in_the_completion_never_reaches_a_wire_field` pins this
down with a stubbed completion carrying a deliberately WRONG figure and
proves it survives nowhere but the prose.

**The four causes, and why they must never collapse into each other** --
the same discipline `market/client.py` established for its own five:
"aucun modèle n'est configuré" (nothing was ever entered in Réglages),
"le modèle a refusé la clé" (a key was entered but the endpoint rejected
it), "le modèle est injoignable" (a connection failure, a DNS failure, a
non-2xx response -- something other than the key), and "le modèle a répondu
trop tard" (the endpoint was reachable but did not answer inside the
timeout). Each names a different remedy: configure one, fix the key, check
the URL or wait for the service, or pick a faster model. `failure_message`
is the one place all four are built.

**No retry.** `market/client.py` retries a transient `SERVICE_UNREACHABLE`
because a quote is a measurement worth re-attempting once. A model's
commentary is optional decoration on a figure the household can already
see without it: `/api/assistant/llm` degrades to the deterministic answer
alone the moment ANY of the four causes fires, and doubling an already-slow
completion's latency to retry a comment nobody is blocked on on would cost
more than it is worth. One attempt, then degrade, saying so.

Pure enough to unit test without a network: `request_commentary` takes an
optional `httpx.BaseTransport` so `tests/test_llm_client.py` runs against a
recorded `httpx.MockTransport`, exactly like `market/providers/_shared.py`'s
`get_json` does for the five market providers. It is NOT a pure engine in
CLAUDE.md's sense -- it makes a real outbound call by design, like
`market/providers/*.py` -- so it lives outside `app/engines/`.
"""

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum

import httpx

DEFAULT_TIMEOUT_SECONDS = 30.0


class LlmFailureCause(StrEnum):
    NOT_CONFIGURED = "not_configured"
    KEY_REJECTED = "key_rejected"
    UNREACHABLE = "unreachable"
    TIMED_OUT = "timed_out"


class LlmError(Exception):
    """Raised by `request_commentary`, or built directly by the API layer
    for `NOT_CONFIGURED` (there is no endpoint to even attempt a call
    against), carrying one of the four causes above and a French sentence
    already fit to show the user."""

    def __init__(self, cause: LlmFailureCause, message: str) -> None:
        super().__init__(message)
        self.cause = cause
        self.message = message


def failure_message(cause: LlmFailureCause) -> str:
    """The one place all four French sentences are written -- see the
    module docstring for why each names a distinct remedy."""
    if cause is LlmFailureCause.NOT_CONFIGURED:
        return (
            "Aucun modèle n'est configuré : renseignez une URL d'endpoint compatible "
            "OpenAI et un nom de modèle dans Réglages → Connexions pour activer les "
            "commentaires de l'assistant. L'application reste pleinement utilisable "
            "sans cela : les réponses restent celles du moteur déterministe."
        )
    if cause is LlmFailureCause.KEY_REJECTED:
        return (
            "Le modèle a refusé la clé : vérifiez-la dans Réglages → Connexions."
        )
    if cause is LlmFailureCause.UNREACHABLE:
        return (
            "Le modèle est injoignable : vérifiez l'URL de l'endpoint dans "
            "Réglages → Connexions et que le service y répond, puis réessayez."
        )
    if cause is LlmFailureCause.TIMED_OUT:
        return (
            "Le modèle a répondu trop tard : réessayez, ou choisissez un modèle "
            "plus rapide dans Réglages → Connexions."
        )
    raise ValueError(f"Cause d'échec de modèle inconnue : {cause}")  # pragma: no cover


def llm_error(cause: LlmFailureCause) -> LlmError:
    """Build the ready-to-raise error in one call -- the idiom
    `market.client.market_error` already established."""
    return LlmError(cause=cause, message=failure_message(cause))


@dataclass(frozen=True)
class LlmSettingsInput:
    """What `request_commentary` needs to reach the model -- already
    decrypted by the caller. This module never touches the database or
    `app.security.crypto` itself: the API layer reads `models.LlmSettings`,
    decrypts `api_key_encrypted` in-process, and hands the plaintext key
    here for the ONE outbound call it authorises. `api_key` is `None` for a
    local endpoint (Ollama, LM Studio, llama.cpp, vLLM) that needs none.
    """

    endpoint_url: str
    model_name: str
    api_key: str | None


def _fmt_eur_for_prompt(cents: int) -> str:
    """A euro figure, formatted for a PROMPT string only -- never for a
    screen. `Decimal`, never a float, on the way there: this text is read by
    a language model, not multiplied against anything, but the project's
    "never a float on a monetary value, at any layer" rule draws no
    exception for formatting either."""
    sign = "-" if cents < 0 else ""
    value = Decimal(abs(cents)) / 100
    body = f"{value:,.2f}".replace(",", " ").replace(".", ",")
    return f"{sign}{body} €"


def build_commentary_prompt(
    query_description: str, answer_text: str, amount_cents: int | None
) -> str:
    """The prompt that hands the model the figure and asks it to comment --
    never to compute one. Pure: no session, no network, no clock.

    Every line the model receives states a fact `engines/answer.py` already
    produced; the instruction is explicit that anything numeric the model
    writes back is decorative prose, never a new measurement -- reinforcing
    at the prompt level the guarantee `request_commentary` enforces
    architecturally by never parsing a number back out of the reply.
    """
    amount_line = (
        "Aucun montant n'accompagne cette réponse."
        if amount_cents is None
        else f"Montant déjà calculé par Yieldo : {_fmt_eur_for_prompt(amount_cents)}."
    )
    return (
        "Tu es un commentateur financier intégré à l'application Yieldo. Un moteur "
        "déterministe a déjà calculé la réponse ci-dessous à partir des données "
        "réelles du foyer ; ton unique rôle est de la commenter et de la mettre en "
        "perspective, en français, en quelques phrases. NE RECALCULE RIEN et "
        "N'INVENTE AUCUN CHIFFRE NOUVEAU : Yieldo n'affichera jamais un nombre que "
        "tu écris, seul ton commentaire en texte libre apparaît, à côté du chiffre "
        "que Yieldo a calculé.\n\n"
        f"Question posée : {query_description}\n"
        f"Réponse de Yieldo : {answer_text}\n"
        f"{amount_line}\n\n"
        "Ton commentaire :"
    )


def _endpoint_url(base: str) -> str:
    return f"{base.rstrip('/')}/chat/completions"


def request_commentary(
    settings: LlmSettingsInput,
    prompt: str,
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    transport: httpx.BaseTransport | None = None,
) -> str:
    """One OpenAI-compatible chat-completions call, returning the model's
    reply as a bare, opaque string -- see the module docstring for why
    nothing here ever looks inside that string for a number.

    `transport` is `None` for a real call, and a recorded
    `httpx.MockTransport` in every test -- the same injection point
    `market/providers/_shared.py.get_json` uses.
    """
    headers = {"Content-Type": "application/json"}
    if settings.api_key:
        headers["Authorization"] = f"Bearer {settings.api_key}"

    client = httpx.Client(transport=transport, timeout=timeout)
    try:
        response = client.post(
            _endpoint_url(settings.endpoint_url),
            headers=headers,
            json={
                "model": settings.model_name,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
    except httpx.TimeoutException as exc:
        raise llm_error(LlmFailureCause.TIMED_OUT) from exc
    except httpx.HTTPError as exc:
        raise llm_error(LlmFailureCause.UNREACHABLE) from exc
    finally:
        client.close()

    if response.status_code in (401, 403):
        raise llm_error(LlmFailureCause.KEY_REJECTED)
    if response.status_code != 200:
        raise llm_error(LlmFailureCause.UNREACHABLE)

    try:
        body = response.json()
        content = body["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        # The endpoint answered 200 with something that is not a usable
        # OpenAI-compatible completion -- as unusable to this application as
        # a connection failure, and named the same way: `UNREACHABLE` is
        # "this module could not get a comment out of what is configured",
        # not only "the socket refused".
        raise llm_error(LlmFailureCause.UNREACHABLE) from exc

    if not isinstance(content, str):
        raise llm_error(LlmFailureCause.UNREACHABLE)
    return content
