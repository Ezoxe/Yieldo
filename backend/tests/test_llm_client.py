"""`app/llm/client.py`, against recorded/stubbed responses only -- never a
real network call. See that module's docstring for the contract this file
exists to pin down: the model never calculates.
"""

import os

import httpx
import pytest

from app.llm.client import (
    LlmError,
    LlmFailureCause,
    LlmSettingsInput,
    build_commentary_prompt,
    failure_message,
    request_commentary,
)
from tests.market_support import failing_transport

SETTINGS = LlmSettingsInput(
    endpoint_url="http://localhost:11434/v1", model_name="llama3", api_key=None
)


def _openai_response(content: str, status: int = 200) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status,
            json={
                "choices": [{"message": {"content": content, "role": "assistant"}}],
            },
        )

    return httpx.MockTransport(handler)


# --------------------------------------------------------------------------
# The prompt: hands the model a figure, never asks it to compute one.
# --------------------------------------------------------------------------


def test_the_prompt_states_the_figure_and_forbids_recalculating_it():
    prompt = build_commentary_prompt("mes dépenses de mars", "Vous avez dépensé 1 234,56 €.",
                                     -123_456)
    assert "1 234,56" in prompt
    assert "mes dépenses de mars" in prompt
    assert "Vous avez dépensé 1 234,56 €." in prompt
    assert "NE RECALCULE RIEN" in prompt


def test_the_prompt_names_the_absence_of_a_figure_rather_than_omit_the_line():
    prompt = build_commentary_prompt("une question sans montant", "Réponse en texte.", None)
    assert "Aucun montant" in prompt


# --------------------------------------------------------------------------
# A successful call.
# --------------------------------------------------------------------------


def test_a_successful_call_returns_the_completion_text_verbatim():
    commentary = request_commentary(
        SETTINGS, "prompt", transport=_openai_response("Ce chiffre est cohérent avec mars.")
    )
    assert commentary == "Ce chiffre est cohérent avec mars."


def test_the_key_is_sent_as_a_bearer_header_only_when_one_is_configured():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    request_commentary(
        LlmSettingsInput(endpoint_url="https://api.openai.com/v1", model_name="gpt-4o-mini",
                         api_key="sk-secret"),
        "prompt", transport=httpx.MockTransport(handler),
    )
    assert seen["auth"] == "Bearer sk-secret"


def test_a_local_endpoint_with_no_key_sends_no_authorization_header():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    request_commentary(SETTINGS, "prompt", transport=httpx.MockTransport(handler))
    assert seen["auth"] is None


def test_the_endpoint_url_is_normalised_with_chat_completions_appended():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    request_commentary(
        LlmSettingsInput(endpoint_url="http://localhost:1234/v1/", model_name="m", api_key=None),
        "prompt", transport=httpx.MockTransport(handler),
    )
    assert seen["url"] == "http://localhost:1234/v1/chat/completions"


# --------------------------------------------------------------------------
# The four causes -- never collapsed into each other.
# --------------------------------------------------------------------------


def test_a_401_is_a_rejected_key():
    with pytest.raises(LlmError) as excinfo:
        request_commentary(SETTINGS, "prompt", transport=_openai_response("", status=401))
    assert excinfo.value.cause is LlmFailureCause.KEY_REJECTED


def test_a_403_is_also_a_rejected_key():
    with pytest.raises(LlmError) as excinfo:
        request_commentary(SETTINGS, "prompt", transport=_openai_response("", status=403))
    assert excinfo.value.cause is LlmFailureCause.KEY_REJECTED


def test_a_500_is_unreachable():
    with pytest.raises(LlmError) as excinfo:
        request_commentary(SETTINGS, "prompt", transport=_openai_response("", status=500))
    assert excinfo.value.cause is LlmFailureCause.UNREACHABLE


def test_a_connection_failure_is_unreachable():
    transport = failing_transport(
        lambda request: httpx.ConnectError("connection refused", request=request)
    )
    with pytest.raises(LlmError) as excinfo:
        request_commentary(SETTINGS, "prompt", transport=transport)
    assert excinfo.value.cause is LlmFailureCause.UNREACHABLE


def test_a_timeout_is_its_own_cause_not_folded_into_unreachable():
    transport = failing_transport(
        lambda request: httpx.ReadTimeout("timed out", request=request)
    )
    with pytest.raises(LlmError) as excinfo:
        request_commentary(SETTINGS, "prompt", transport=transport)
    assert excinfo.value.cause is LlmFailureCause.TIMED_OUT


def test_a_200_with_no_usable_choices_is_unreachable_not_a_crash():
    """The endpoint answered, but not with anything shaped like an OpenAI
    completion -- as unusable as a connection failure, not a bug in this
    client."""
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"unexpected": "shape"})

    with pytest.raises(LlmError) as excinfo:
        request_commentary(SETTINGS, "prompt", transport=httpx.MockTransport(handler))
    assert excinfo.value.cause is LlmFailureCause.UNREACHABLE


def test_every_cause_has_its_own_french_sentence_naming_a_distinct_remedy():
    sentences = {cause: failure_message(cause) for cause in LlmFailureCause}
    assert len(set(sentences.values())) == len(sentences)
    assert "Réglages" in sentences[LlmFailureCause.NOT_CONFIGURED]
    assert "clé" in sentences[LlmFailureCause.KEY_REJECTED]
    assert "injoignable" in sentences[LlmFailureCause.UNREACHABLE]
    assert "trop tard" in sentences[LlmFailureCause.TIMED_OUT]


# --------------------------------------------------------------------------
# The contract: the model never calculates.
# --------------------------------------------------------------------------


def test_a_wrong_number_in_the_completion_never_reaches_a_wire_field():
    """The whole point of `request_commentary`'s return type: a bare `str`,
    nothing else. A completion that hallucinates a figure -- 999 999,99 EUR,
    nowhere close to the real -12,34 EUR the caller handed it -- comes back
    exactly as prose, and this module has no code path that could turn it
    into anything else: there is no field on this function's return value
    other than the string itself for a number to hide in."""
    wrong_number = "999 999,99 €"
    commentary = request_commentary(
        SETTINGS, "prompt",
        transport=_openai_response(
            f"Attention, votre solde est en réalité de {wrong_number} !"
        ),
    )
    assert commentary == f"Attention, votre solde est en réalité de {wrong_number} !"
    # The return type itself: a plain string, never a dataclass with a
    # numeric field the caller might mistake for a measurement.
    assert isinstance(commentary, str)


# --------------------------------------------------------------------------
# Live, opt-in only -- skipped whenever an endpoint is not configured for it.
# --------------------------------------------------------------------------


@pytest.mark.skipif(
    not os.environ.get("YIELDO_LIVE_LLM_ENDPOINT_URL")
    or not os.environ.get("YIELDO_LIVE_LLM_MODEL"),
    reason=(
        "Set YIELDO_LIVE_LLM_ENDPOINT_URL and YIELDO_LIVE_LLM_MODEL (and, if the "
        "endpoint needs one, YIELDO_LIVE_LLM_API_KEY) to opt into one real call "
        "against a live OpenAI-compatible endpoint."
    ),
)
def test_live_llm_commentary():
    settings = LlmSettingsInput(
        endpoint_url=os.environ["YIELDO_LIVE_LLM_ENDPOINT_URL"],
        model_name=os.environ["YIELDO_LIVE_LLM_MODEL"],
        api_key=os.environ.get("YIELDO_LIVE_LLM_API_KEY") or None,
    )
    prompt = build_commentary_prompt(
        "mes dépenses de mars", "Vous avez dépensé 120,00 €.", -12_000
    )
    commentary = request_commentary(settings, prompt)
    assert commentary.strip()
