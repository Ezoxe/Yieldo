"""The Laya server, tested without torch: a fake agent stands in for laya.

Run from this directory: `python -m pytest test_server.py -q`. `fastapi` is
all it needs, and the backend venv has it.
"""

from fastapi.testclient import TestClient

from server import create_app


class FakeAgent:
    """Answers shaped exactly like `laya.Agent.predict` on 2026-09-21
    (`laya 0.3.4`, checkpoint `typed-decisions`)."""

    cfg = {"model_name": "laya-typed-decisions", "max_len": 1024,
           "temperature_by_options": {"choice:3-5": 1.76}}
    device = "cpu"

    def predict(self, state, questions):
        answers = {}
        for key, question in questions.items():
            if question["type"] == "choice":
                options = list(question["criteria"])
                answers[key] = {"type": "choice", "choice": options[-1],
                                "probabilities": {o: 1 / len(options) for o in options},
                                "confidence": 0.0039, "action": {"act_probability": 1.0}}
            elif question["type"] == "score":
                levels = question["criteria"]
                answers[key] = {"type": "score", "score": 4.2882,
                                "legend": {level: level for level in levels},
                                "probabilities": {level: 1 / len(levels) for level in levels},
                                "confidence": 0.04, "action": {"act_probability": 0.9}}
            else:
                answers[key] = {"type": "noul", "noul": 0.289, "confidence": 0.711,
                                "action": {"act_probability": 1.0}}
        return {"model": "laya-rl-agent", "answers": answers,
                "usage": {"input_tokens": 208, "output_tokens": 0}}


DIRECTION = {"type": "choice", "instructions": "Quelle action ?",
             "criteria": {"acheter": "acheter", "vendre": "vendre",
                          "ne rien faire": "ne rien faire"}}


def client(**kwargs) -> TestClient:
    return TestClient(create_app(FakeAgent(), checkpoint="typed-decisions", threads=4, **kwargs))


def test_health_names_the_checkpoint_and_the_machine():
    body = client().get("/health").json()
    assert body["status"] == "ok"
    assert body["checkpoint"] == "laya-typed-decisions"
    assert body["device"] == "cpu"
    assert body["threads"] == 4
    assert body["context_tokens"] == 1024
    assert body["predictions"] == 0
    assert body["latency_p50_ms"] is None
    assert body["temperatures"] == {"choice:3-5": 1.76}


def test_systemone_answers_in_the_jev_dialect_with_the_mass():
    response = client().post(
        "/v1/systemone", json={"state": {"x": 1}, "questions": {"q": DIRECTION}},
    )
    assert response.status_code == 200
    body = response.json()
    answer = body["answers"]["q"]
    assert answer["choice"] == "ne rien faire"
    assert set(answer["probabilities"]) == {"acheter", "vendre", "ne rien faire"}
    assert answer["act_probability"] == 1.0
    assert body["model"] == "laya-typed-decisions"
    assert body["input_tokens"] == 208
    # The raw predict() result travels untouched, so nothing unknown is lost.
    assert body["raw"]["model"] == "laya-rl-agent"
    assert isinstance(body["latency_ms"], int)


def test_a_score_keeps_its_legend_out_and_its_probabilities_in():
    score = {"type": "score", "instructions": "Nette ?", "criteria": [str(i) for i in range(11)]}
    body = client().post("/v1/systemone", json={"state": "s", "questions": {"q": score}}).json()
    answer = body["answers"]["q"]
    assert answer["score"] == 4.2882
    assert len(answer["probabilities"]) == 11
    assert "legend" not in answer


def test_health_counts_predictions_and_reports_percentiles():
    c = client()
    for _ in range(3):
        c.post("/v1/systemone", json={"state": "s", "questions": {"q": DIRECTION}})
    body = c.get("/health").json()
    assert body["predictions"] == 3
    assert isinstance(body["latency_p50_ms"], int)
    assert isinstance(body["latency_p95_ms"], int)


def test_a_key_when_configured_is_required():
    c = client(api_key="secret")
    denied = c.post("/v1/systemone", json={"state": "s", "questions": {"q": DIRECTION}})
    assert denied.status_code == 401
    ok = c.post("/v1/systemone", json={"state": "s", "questions": {"q": DIRECTION}},
                headers={"Authorization": "Bearer secret"})
    assert ok.status_code == 200
    # Health stays open: it says nothing a key should protect.
    assert c.get("/health").status_code == 200


def test_a_malformed_body_is_a_422():
    assert client().post("/v1/systemone", json={"state": "s"}).status_code == 422


def test_a_failing_agent_is_a_500_naming_the_error():
    class Broken(FakeAgent):
        def predict(self, state, questions):
            raise RuntimeError("poids introuvables")

    c = TestClient(create_app(Broken(), checkpoint="x", threads=1))
    response = c.post("/v1/systemone", json={"state": "s", "questions": {"q": DIRECTION}})
    assert response.status_code == 500
    assert "poids introuvables" in response.json()["detail"]
