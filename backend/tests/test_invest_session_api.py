"""The simulated day over HTTP: start it, watch it, stop it, read it back.

Under `TestClient`, FastAPI's `BackgroundTasks` run inside the request, so
a four-step day is finished by the time `POST` answers -- the routes are
tested end to end without a thread.
"""

import pytest

from app.api.invest_session import session_factory
from app.main import app
from tests.test_invest_api import choose_deterministic_model, connect_sandbox, full_policy


@pytest.fixture
def ready(client, db):
    # The background task opens its own database session; under the test
    # client that must be the in-memory one every other route uses.
    app.dependency_overrides[session_factory] = lambda: (lambda: db)
    yield from _ready(client)
    app.dependency_overrides.pop(session_factory, None)


def _ready(client):
    registered = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123",
    }).json()
    headers = {"Authorization": f"Bearer {registered['access_token']}"}
    key = client.get("/api/access-key", headers=headers).json()
    agent = {"Authorization": f"Bearer {key['key']}"}
    connect_sandbox(client, headers)
    choose_deterministic_model(client, headers)
    client.put("/api/invest/policy", headers=headers, json=full_policy())
    yield headers, agent


def test_a_day_starts_with_a_drawn_seed_and_finishes_in_the_background(client, ready):
    headers, _ = ready
    response = client.post("/api/invest/sessions", headers=headers, json={"steps": 4})
    assert response.status_code == 202
    body = response.json()
    assert body["steps"] == 4
    assert isinstance(body["seed"], int)
    assert body["provider"] == "replay"
    assert body["initial_cash_cents"] == 1_000_000

    detail = client.get(f"/api/invest/sessions/{body['id']}", headers=headers).json()
    assert detail["status"] == "finished"
    assert detail["completed_steps"] == 4
    assert len(detail["points"]) == 4
    # The prices are recomputed from the seed, one series per instrument,
    # one close per step, and they line up with the decisions' reference.
    assert set(detail["closes"]) == {"AAPL", "BTC-EUR"}
    assert len(detail["closes"]["AAPL"]) == 4
    assert detail["decisions"][0]["reference_price_cents"] in (
        detail["closes"][detail["decisions"][0]["symbol"]]
    )
    assert detail["report"]["decisions"] == 8
    assert "return_bps" in detail["report"]
    assert detail["report"]["max_drawdown_bps"] >= 0


def test_a_chosen_seed_replays_the_same_day(client, ready):
    headers, _ = ready
    first = client.post("/api/invest/sessions", headers=headers,
                        json={"steps": 4, "seed": 527}).json()
    second = client.post("/api/invest/sessions", headers=headers,
                         json={"steps": 4, "seed": 527}).json()
    a = client.get(f"/api/invest/sessions/{first['id']}", headers=headers).json()
    b = client.get(f"/api/invest/sessions/{second['id']}", headers=headers).json()
    assert a["closes"] == b["closes"]
    assert a["points"] == b["points"]


def test_the_list_shows_the_most_recent_first(client, ready):
    headers, _ = ready
    for steps in (4, 5):
        client.post("/api/invest/sessions", headers=headers, json={"steps": steps})
    rows = client.get("/api/invest/sessions", headers=headers).json()
    assert [row["steps"] for row in rows] == [5, 4]
    assert "closes" not in rows[0]


def test_a_day_needs_a_model_a_broker_and_a_running_pipeline(client, ready):
    headers, _ = ready
    client.delete("/api/invest/model", headers=headers)
    refused = client.post("/api/invest/sessions", headers=headers, json={"steps": 4})
    assert refused.status_code == 409
    assert "Modèle de décision" in refused.json()["detail"]


def test_a_day_picks_the_synthetic_book_even_behind_a_recorded_one(client, ready):
    """A household whose first paper venue reads Yieldo's recorded prices
    (not replayable) still gets its day, on the synthetic book connected
    beside it -- the first day ever asked for was refused for this."""
    headers, _ = ready
    # The synthetic book from `ready` is deleted; a recorded one takes the
    # first id, then a synthetic one is connected after it.
    venues = client.get("/api/invest/venues", headers=headers).json()
    client.delete(f"/api/invest/venues/{venues[0]['id']}", headers=headers)
    client.post("/api/invest/venues", headers=headers, json={
        "venue": "internal", "mode": "paper", "label": "TEST",
        "slippage_bps": 10, "price_source": "recorded",
    })
    refused = client.post("/api/invest/sessions", headers=headers, json={"steps": 4})
    assert refused.status_code == 409
    assert "Marché synthétique" in refused.json()["detail"]
    assert "supprimez" in refused.json()["detail"]

    # One internal book per mode: the recorded one goes before the synthetic
    # one can be connected, which is what the refusal tells the household.
    recorded = client.get("/api/invest/venues", headers=headers).json()[0]
    client.delete(f"/api/invest/venues/{recorded['id']}", headers=headers)
    client.post("/api/invest/venues", headers=headers, json={
        "venue": "internal", "mode": "paper", "label": "Synthétique",
        "slippage_bps": 10, "price_source": "synthetic",
    })
    started = client.post("/api/invest/sessions", headers=headers, json={"steps": 4})
    assert started.status_code == 202
    detail = client.get(f"/api/invest/sessions/{started.json()['id']}", headers=headers).json()
    assert detail["status"] == "finished"
    assert len(detail["closes"]["AAPL"]) == 4


def test_steps_are_bounded(client, ready):
    headers, _ = ready
    assert client.post("/api/invest/sessions", headers=headers,
                       json={"steps": 2}).status_code == 422
    assert client.post("/api/invest/sessions", headers=headers,
                       json={"steps": 1_000}).status_code == 422


def test_an_agent_key_can_read_a_day_but_neither_start_nor_stop_one(client, ready):
    headers, agent = ready
    day = client.post("/api/invest/sessions", headers=headers, json={"steps": 4}).json()
    assert client.get(f"/api/invest/sessions/{day['id']}", headers=agent).status_code == 200
    assert client.post("/api/invest/sessions", headers=agent,
                       json={"steps": 4}).status_code == 401
    assert client.post(f"/api/invest/sessions/{day['id']}/stop",
                       headers=agent).status_code == 401


def test_stopping_a_finished_day_says_so(client, ready):
    headers, _ = ready
    day = client.post("/api/invest/sessions", headers=headers, json={"steps": 4}).json()
    response = client.post(f"/api/invest/sessions/{day['id']}/stop", headers=headers)
    assert response.status_code == 409
    assert "terminée" in response.json()["detail"]


def test_one_households_days_are_invisible_to_another(client, ready):
    headers, _ = ready
    day = client.post("/api/invest/sessions", headers=headers, json={"steps": 4}).json()
    other = client.post("/api/auth/register", json={
        "name": "Autre", "email": "autre@example.com", "password": "motdepasse123",
    }).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.get("/api/invest/sessions", headers=other_headers).json() == []
    assert client.get(f"/api/invest/sessions/{day['id']}",
                      headers=other_headers).status_code == 404


def test_a_tour_by_hand_is_refused_while_a_day_runs(client, ready, db):
    headers, _ = ready
    # A day left `running` in the table, as it is between two steps.
    from datetime import UTC, datetime

    from app.models import TradingSession, User
    user = db.query(User).filter_by(email="max@example.com").one()
    db.add(TradingSession(
        user_id=user.id, mode="paper", seed=1, steps=10, interval_minutes=5,
        completed_steps=2, status="running", stop_requested=False, provider="replay",
        model="", initial_cash_cents=1_000_000, points=[], started_at=datetime.now(UTC),
    ))
    db.commit()
    refused = client.post("/api/invest/run", headers=headers)
    assert refused.status_code == 409
    assert "journée" in refused.json()["detail"].lower()
    again = client.post("/api/invest/sessions", headers=headers, json={"steps": 4})
    assert again.status_code == 409
