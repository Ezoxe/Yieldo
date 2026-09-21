"""The Laya provider: the System One dialect over a local server, plus what
Laya adds -- the mass per option or level and the act probability.

`httpx.post` and `httpx.get` are replaced by stubs answering the shape
`tools/laya-server/` returns (measured on the operator's LXC, 2026-09-21).
No network, no torch.
"""

import json

import httpx
import pytest

from app.decision.contract import DecisionError, DecisionFailureCause
from app.decision.laya import LayaProvider
from app.decision.registry import build_provider
from app.decision.strategy import CONTINUATION, CONVICTION, DIRECTION
from app.models import DecisionSettings

ENDPOINT = "http://192.168.1.172:8100"

CHOICE_BODY = {
    "model": "laya-typed-decisions", "latency_ms": 245, "input_tokens": 42,
    "answers": {"q": {
        "type": "choice", "choice": "vendre", "confidence": 0.0087,
        "probabilities": {"acheter": 0.3358, "vendre": 0.3881, "ne rien faire": 0.276},
        "act_probability": 1.0,
    }},
    "raw": {"model": "laya-rl-agent"},
}

SCORE_BODY = {
    "model": "laya-typed-decisions", "latency_ms": 300, "input_tokens": 60,
    "answers": {"q": {
        "type": "score", "score": 4.2882, "confidence": 0.0402,
        "probabilities": {str(i): p for i, p in enumerate(
            [0.051, 0.1729, 0.1513, 0.1187, 0.0561, 0.1017, 0.07, 0.1066, 0.0564, 0.0461, 0.0691]
        )},
        "act_probability": 0.9,
    }},
}

NOUL_BODY = {
    "model": "laya-typed-decisions", "latency_ms": 200, "input_tokens": 50,
    "answers": {"q": {"type": "noul", "noul": 0.289, "confidence": 0.711,
                      "act_probability": 1.0}},
}

HEALTH = {
    "status": "ok", "checkpoint": "laya-typed-decisions", "device": "cpu", "threads": 10,
    "context_tokens": 1024, "warmup_ms": 129, "predictions": 3,
    "latency_p50_ms": 245, "latency_p95_ms": 310,
}


def _response(status: int, body: dict) -> httpx.Response:
    return httpx.Response(status, text=json.dumps(body), request=httpx.Request("POST", ENDPOINT))


@pytest.fixture
def wire(monkeypatch):
    """Records what was posted and answers with the body set on it."""
    calls: list[dict] = []
    state = {"status": 200, "body": CHOICE_BODY, "raise": None}

    def post(url, *, json=None, headers=None, timeout=None):
        calls.append({"url": url, "json": json, "headers": headers, "timeout": timeout})
        if state["raise"] is not None:
            raise state["raise"]
        return _response(state["status"], state["body"])

    def get(url, *, headers=None, timeout=None):
        calls.append({"url": url, "headers": headers, "timeout": timeout})
        if state["raise"] is not None:
            raise state["raise"]
        return _response(state["status"], state["body"])

    monkeypatch.setattr(httpx, "post", post)
    monkeypatch.setattr(httpx, "get", get)
    state["calls"] = calls
    return state


def provider(**kwargs) -> LayaProvider:
    defaults = {"endpoint_url": ENDPOINT, "model_name": None, "api_key": None, "timeout_ms": 2_000}
    defaults.update(kwargs)
    return LayaProvider(**defaults)


def test_a_choice_carries_the_mass_in_basis_points_and_the_act_probability(wire):
    decision = provider().decide(DIRECTION, {"instrument": "BTC-EUR"})
    assert decision.choice == "vendre"
    assert decision.provider == "laya"
    assert decision.model == "laya-typed-decisions"
    assert decision.confidence_bps == 87
    assert decision.mass_bps == {"acheter": 3_358, "vendre": 3_881, "ne rien faire": 2_760}
    assert decision.act_bps == 10_000
    assert "mass_bps" not in decision.canonical()


def test_the_question_travels_in_the_system_one_dialect_to_the_server(wire):
    provider().decide(DIRECTION, {"instrument": "BTC-EUR"})
    call = wire["calls"][0]
    assert call["url"] == f"{ENDPOINT}/v1/systemone"
    assert call["json"]["state"] == {"instrument": "BTC-EUR"}
    assert call["json"]["questions"]["q"]["type"] == "choice"
    assert set(call["json"]["questions"]["q"]["criteria"]) == set(DIRECTION.options)
    # No key configured: no Authorization header, not an empty one.
    assert "Authorization" not in call["headers"]
    assert call["timeout"] == 2.0


def test_a_key_when_configured_is_sent_as_a_bearer(wire):
    provider(api_key="secret").decide(DIRECTION, {})
    assert wire["calls"][0]["headers"]["Authorization"] == "Bearer secret"


def test_a_score_is_rounded_to_its_level_with_eleven_masses(wire):
    wire["body"] = SCORE_BODY
    decision = provider().decide(CONVICTION, {})
    assert decision.score_value == 4
    assert decision.mass_bps is not None
    assert len(decision.mass_bps) == 11
    assert decision.mass_bps["1"] == 1_729
    assert decision.act_bps == 9_000


def test_a_probability_is_carried_in_basis_points(wire):
    wire["body"] = NOUL_BODY
    decision = provider().decide(CONTINUATION, {})
    assert decision.probability_bps == 2_890
    assert decision.mass_bps is None
    assert decision.confidence_bps == 7_110


def test_a_choice_outside_the_options_is_off_contract(wire):
    wire["body"] = {**CHOICE_BODY, "answers": {"q": {"type": "choice", "choice": "attendre"}}}
    with pytest.raises(DecisionError) as info:
        provider().decide(DIRECTION, {})
    assert info.value.cause is DecisionFailureCause.OFF_CONTRACT
    assert "attendre" in info.value.message


def test_a_mass_that_is_not_a_map_of_numbers_is_dropped_not_half_parsed(wire):
    wire["body"] = {**CHOICE_BODY, "answers": {"q": {
        "type": "choice", "choice": "vendre", "probabilities": {"vendre": "beaucoup"},
    }}}
    decision = provider().decide(DIRECTION, {})
    assert decision.choice == "vendre"
    assert decision.mass_bps is None


def test_a_401_is_the_model_rejecting_the_key(wire):
    wire["status"] = 401
    wire["body"] = {"detail": "Clé absente ou incorrecte."}
    with pytest.raises(DecisionError) as info:
        provider().decide(DIRECTION, {})
    assert info.value.cause is DecisionFailureCause.MODEL_REJECTED


def test_a_timeout_is_too_slow(wire):
    wire["raise"] = httpx.ReadTimeout("slow", request=httpx.Request("POST", ENDPOINT))
    with pytest.raises(DecisionError) as info:
        provider().decide(DIRECTION, {})
    assert info.value.cause is DecisionFailureCause.TOO_SLOW
    assert "2000 ms" in info.value.message


def test_an_unreachable_server_names_the_cause(wire):
    wire["raise"] = httpx.ConnectError("refused", request=httpx.Request("POST", ENDPOINT))
    with pytest.raises(DecisionError) as info:
        provider().decide(DIRECTION, {})
    assert info.value.cause is DecisionFailureCause.SERVICE_UNREACHABLE


def test_probe_returns_the_health_card(wire):
    wire["body"] = HEALTH
    health = provider().probe()
    assert health["checkpoint"] == "laya-typed-decisions"
    assert health["latency_p50_ms"] == 245
    assert wire["calls"][0]["url"] == f"{ENDPOINT}/health"


def test_probe_on_an_unreachable_server_is_the_same_failure_as_a_decision(wire):
    wire["raise"] = httpx.ConnectError("refused", request=httpx.Request("GET", ENDPOINT))
    with pytest.raises(DecisionError) as info:
        provider().probe()
    assert info.value.cause is DecisionFailureCause.SERVICE_UNREACHABLE


def test_the_registry_builds_laya_and_refuses_it_without_an_address():
    with pytest.raises(DecisionError) as info:
        build_provider(DecisionSettings(user_id=1, provider="laya", endpoint_url=None))
    assert info.value.cause is DecisionFailureCause.NO_MODEL

    built = build_provider(
        DecisionSettings(user_id=1, provider="laya", endpoint_url=ENDPOINT, timeout_ms=1_500)
    )
    assert isinstance(built, LayaProvider)
    assert built.timeout_ms == 1_500
