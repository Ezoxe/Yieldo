"""When Yieldo's parser does not recognise a question, the household's own
model may take it — and the answer must never be mistaken for a measurement.

Four things are pinned here, and they are the whole design:

* a household with nothing configured sees exactly the refusal it saw before;
* an answer that came from a model is labelled as such all the way to the wire;
* the model is offered the READ tools and no others, so a question typed into a
  chat box can never leave a proposal behind for somebody to refuse later;
* the run is stored, and re-reading the thread never calls the model again.
"""

import json
from datetime import date

import httpx
import pytest

from app.api import chat as chat_routes
from app.llm.agent import AgentOutcome, run_agent
from app.llm.client import LlmSettingsInput
from app.models import AgentRun, AgentStep, ChatMessage, User

UNPARSEABLE = "Raconte-moi ce que tu penses de mes habitudes, en général."
RECOGNISED = "Combien j'ai dépensé en mars 2026 ?"


def _register(client) -> dict[str, str]:
    client.post("/api/auth/register", json={
        "email": "max@example.com", "password": "motdepasse123", "name": "Max",
    })
    token = client.post("/api/auth/login", json={
        "email": "max@example.com", "password": "motdepasse123",
    }).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _configure_model(client, headers) -> None:
    response = client.put("/api/assistant/llm-settings", headers=headers, json={
        "endpoint_url": "http://localhost:11434/v1", "model_name": "qwen3", "api_key": None,
    })
    assert response.status_code == 200, response.text


def _fake_run(*, answer: str | None, notice: str | None = None, tools: tuple[str, ...] = ()):
    """Stands in for the loop, writing the same rows it would have written.

    The loop itself is covered by `tests/test_agent_api.py`; what is under test
    here is the route around it — when it calls the model, what it stores, and
    what it puts on the wire.
    """
    calls: list[dict] = []

    def stub(db, user, run, settings, **kwargs):
        calls.append(kwargs)
        for position, name in enumerate(tools):
            db.add(AgentStep(
                run_id=run.id, position=position, kind="tool_result", name=name,
                summary=f"résultat de {name}", payload={},
            ))
        if answer is None:
            run.state = "failed"
            run.notice = notice
            return AgentOutcome("failed", None, notice, len(tools))
        run.state = "answered"
        run.answer = answer
        run.notice = notice
        return AgentOutcome("answered", answer, notice, len(tools))

    return stub, calls


# --- nothing configured ----------------------------------------------------


def test_a_household_with_no_model_sees_the_refusal_it_always_saw(client, db):
    headers = _register(client)
    answer = client.post("/api/chat", headers=headers, json={"text": UNPARSEABLE}).json()["answer"]

    assert answer["recognised"] is False
    assert answer["is_refusal"] is True
    assert answer["answered_by"] == "engines"
    assert answer["model_name"] is None
    assert answer["model_notice"] is None
    assert answer["supported_formulations"]
    # And nothing was started on its behalf.
    assert db.query(AgentRun).count() == 0


# --- the model answers -----------------------------------------------------


def test_an_unparsed_question_is_handed_to_the_model(client, db, monkeypatch):
    headers = _register(client)
    _configure_model(client, headers)
    stub, calls = _fake_run(answer="Vos sorties sont surtout des courses.",
                            tools=("resume_periode", "categories"))
    monkeypatch.setattr(chat_routes, "run_agent", stub)

    answer = client.post("/api/chat", headers=headers, json={"text": UNPARSEABLE}).json()["answer"]

    assert answer["answered_by"] == "modele"
    assert answer["text"] == "Vos sorties sont surtout des courses."
    assert answer["model_name"] == "qwen3"
    assert answer["is_refusal"] is False
    # The parser still did not recognise the sentence; the model answering does
    # not change that fact about Yieldo's own engines.
    assert answer["recognised"] is False
    # No figure the model wrote may reach a field a screen renders as money.
    assert answer["amount_cents"] is None
    # A household that got an answer is not told how to rephrase.
    assert answer["supported_formulations"] is None

    tools = [step["tool"] for step in answer["steps"]]
    assert tools == ["engines/intent", "resume_periode", "categories"]

    # The question and the run that answered it are linked.
    message = db.query(ChatMessage).one()
    assert message.agent_run_id is not None
    assert len(calls) == 1


def test_a_question_the_parser_understands_never_reaches_the_model(client, monkeypatch):
    headers = _register(client)
    _configure_model(client, headers)
    stub, calls = _fake_run(answer="jamais appelé")
    monkeypatch.setattr(chat_routes, "run_agent", stub)

    answer = client.post("/api/chat", headers=headers, json={"text": RECOGNISED}).json()["answer"]

    assert answer["recognised"] is True
    assert answer["answered_by"] == "engines"
    assert calls == []


def test_rereading_a_thread_does_not_ask_the_model_again(client, monkeypatch):
    headers = _register(client)
    _configure_model(client, headers)
    stub, calls = _fake_run(answer="Une réponse du modèle.", tools=("resume_periode",))
    monkeypatch.setattr(chat_routes, "run_agent", stub)

    client.post("/api/chat", headers=headers, json={"text": UNPARSEABLE})
    listed = client.get("/api/chat", headers=headers).json()

    # One call, made when the question was asked — not one per read.
    assert len(calls) == 1
    assert listed[0]["answer"]["answered_by"] == "modele"
    assert listed[0]["answer"]["text"] == "Une réponse du modèle."
    assert [step["tool"] for step in listed[0]["answer"]["steps"]] == [
        "engines/intent", "resume_periode",
    ]


# --- the model fails -------------------------------------------------------


def test_a_model_that_fails_leaves_the_refusal_standing_and_names_the_cause(
    client, monkeypatch
):
    headers = _register(client)
    _configure_model(client, headers)
    stub, _ = _fake_run(answer=None, notice="Le modèle est injoignable.")
    monkeypatch.setattr(chat_routes, "run_agent", stub)

    answer = client.post("/api/chat", headers=headers, json={"text": UNPARSEABLE}).json()["answer"]

    assert answer["answered_by"] == "engines"
    assert answer["is_refusal"] is True
    # The refusal is the parser's own, and the cause is stated beside it rather
    # than swallowed.
    assert answer["supported_formulations"]
    assert answer["model_notice"] == "Le modèle est injoignable."


# --- the wall --------------------------------------------------------------


def test_the_chat_offers_the_model_no_tool_that_writes(db, client):
    """The read-only catalogue, checked on the wire the model actually reads.

    Not a check on a Python list: what matters is the `tools` array in the
    request body, because that is the only thing the endpoint sees.
    """
    _register(client)
    user = db.query(User).filter(User.email == "max@example.com").one()
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.extend(tool["function"]["name"] for tool in body["tools"])
        return httpx.Response(200, json={
            "choices": [{"message": {"role": "assistant", "content": "Fini."}}]
        })

    run = AgentRun(user_id=user.id, question=UNPARSEABLE, state="running")
    db.add(run)
    db.flush()
    run_agent(
        db, user, run,
        LlmSettingsInput(endpoint_url="http://x/v1", model_name="m", api_key=None),
        today=date(2026, 3, 10), timeout=5.0, read_only=True,
        transport=httpx.MockTransport(handler),
    )

    assert seen, "le modèle n'a reçu aucun outil"
    assert [name for name in seen if name.startswith("proposer_")] == []


def test_a_write_tool_asked_for_anyway_is_refused_rather_than_run(db, client):
    """A model that names a tool it was never offered is answered, not obeyed."""
    _register(client)
    user = db.query(User).filter(User.email == "max@example.com").one()
    turns = [
        {"choices": [{"message": {
            "role": "assistant", "content": None,
            "tool_calls": [{
                "id": "c1", "type": "function",
                "function": {"name": "proposer_budget", "arguments": "{}"},
            }],
        }}]},
        {"choices": [{"message": {"role": "assistant", "content": "Très bien."}}]},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=turns.pop(0))

    run = AgentRun(user_id=user.id, question=UNPARSEABLE, state="running")
    db.add(run)
    db.flush()
    run_agent(
        db, user, run,
        LlmSettingsInput(endpoint_url="http://x/v1", model_name="m", api_key=None),
        today=date(2026, 3, 10), timeout=5.0, read_only=True,
        transport=httpx.MockTransport(handler),
    )
    db.flush()

    results = [
        step.summary
        for step in db.query(AgentStep).filter(AgentStep.run_id == run.id)
        if step.kind == "tool_result"
    ]
    assert any("n'est pas disponible ici" in text for text in results)
    # And nothing was proposed.
    from app.models import AgentProposal

    assert db.query(AgentProposal).count() == 0


@pytest.mark.parametrize("state", ["answered", "failed"])
def test_the_run_is_stored_either_way(client, db, monkeypatch, state):
    """The trace is worth keeping even when it ends without an answer: what the
    model read before giving up is the whole of what a household can judge."""
    headers = _register(client)
    _configure_model(client, headers)
    stub, _ = _fake_run(
        answer="Voilà." if state == "answered" else None,
        notice=None if state == "answered" else "Le modèle a répondu trop tard.",
        tools=("resume_periode",),
    )
    monkeypatch.setattr(chat_routes, "run_agent", stub)

    client.post("/api/chat", headers=headers, json={"text": UNPARSEABLE})

    assert db.query(AgentRun).count() == 1
    assert db.query(ChatMessage).one().agent_run_id is not None
