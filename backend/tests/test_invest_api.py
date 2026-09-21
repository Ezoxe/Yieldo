"""The investment API: the credential wall, the arming, and the cord.

The security boundary is what this file is mostly about. Three different
authorities meet on `/api/invest/*` and every one of them is pinned here,
because a boundary that drifts is a boundary nobody notices has moved.
"""

import re

import pytest

from app.api.invest_policy import ARM_PHRASE


@pytest.fixture
def session(client):
    """A registered household, with a browser session and an agent access key."""
    registered = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123",
    }).json()
    headers = {"Authorization": f"Bearer {registered['access_token']}"}
    key = client.get("/api/access-key", headers=headers).json()
    agent = {"Authorization": f"Bearer {key['key']}"}
    return headers, agent


def full_policy(**overrides) -> dict:
    base = {
        "max_position_cents": 200_000, "max_exposure_cents": 1_000_000,
        "max_order_notional_cents": 200_000, "max_daily_loss_cents": 50_000,
        "min_cash_buffer_cents": 0, "min_order_notional_cents": 1_000,
        "max_drawdown_bps": 2_000, "max_orders_per_day": 20,
        "allowed_symbols": ["AAPL", "BTC-EUR"], "allow_short": False,
        "allow_leverage": False, "allow_limit_orders": True,
        "minimum_conviction": 0, "minimum_probability_bps": 0,
        "max_volatility_bps": 10_000, "full_conviction_share_bps": 10_000,
        "autonomy": "paper",
    }
    return {**base, **overrides}


def connect_sandbox(client, headers) -> dict:
    return client.post("/api/invest/venues", headers=headers, json={
        "venue": "internal", "mode": "paper", "label": "Bac à sable",
        "slippage_bps": 10, "price_source": "synthetic",
    }).json()


def choose_deterministic_model(client, headers) -> dict:
    return client.put("/api/invest/model", headers=headers, json={
        "provider": "replay",
    }).json()


# --------------------------------------------------------------------------
# A mandate authorises nothing until it is written
# --------------------------------------------------------------------------

def test_a_fresh_mandate_authorises_no_instrument_and_observes_only(client, session):
    headers, _ = session
    policy = client.get("/api/invest/policy", headers=headers).json()
    assert policy["allowed_symbols"] == []
    assert policy["autonomy"] == "observer"
    assert policy["max_position_cents"] == 0
    assert policy["armed"] is False


def test_the_mandate_publishes_the_rules_the_model_is_bound_by(client, session):
    headers, _ = session
    policy = client.get("/api/invest/policy", headers=headers).json()
    assert any("taille de position" in rule for rule in policy["declared_rules"])


def test_symbols_are_stored_upper_cased_and_deduplicated(client, session):
    headers, _ = session
    written = client.put("/api/invest/policy", headers=headers,
                         json=full_policy(allowed_symbols=["aapl", "AAPL", " btc-eur "])).json()
    assert written["allowed_symbols"] == ["AAPL", "BTC-EUR"]


# --------------------------------------------------------------------------
# The credential wall: an agent access key is not a session
# --------------------------------------------------------------------------

def test_an_agent_key_cannot_read_the_broker_list(client, session):
    _, agent = session
    assert client.get("/api/invest/venues", headers=agent).status_code == 401


def test_an_agent_key_cannot_connect_a_broker(client, session):
    _, agent = session
    response = client.post("/api/invest/venues", headers=agent, json={
        "venue": "internal", "mode": "paper", "label": "x",
    })
    assert response.status_code == 401


def test_an_agent_key_cannot_widen_the_mandate(client, session):
    _, agent = session
    assert client.put("/api/invest/policy", headers=agent,
                      json=full_policy()).status_code == 401


def test_an_agent_key_cannot_arm_real_execution(client, session):
    headers, agent = session
    client.put("/api/invest/policy", headers=headers, json=full_policy(autonomy="live"))
    response = client.post("/api/invest/policy/arm", headers=agent,
                           json={"confirmation": ARM_PHRASE, "minutes": 30})
    assert response.status_code == 401


def test_an_agent_key_cannot_change_the_decision_model(client, session):
    _, agent = session
    assert client.put("/api/invest/model", headers=agent,
                      json={"provider": "replay"}).status_code == 401


def test_an_agent_key_cannot_reset_the_sandbox(client, session):
    _, agent = session
    assert client.post("/api/invest/sandbox/reset", headers=agent).status_code == 401


def test_an_agent_key_cannot_resume_after_a_halt(client, session):
    headers, agent = session
    client.post("/api/invest/oversight/halt", headers=agent, json={"reason": "test"})
    assert client.post("/api/invest/policy/resume", headers=agent).status_code == 401
    assert client.post("/api/invest/policy/resume", headers=headers).status_code == 200


# --------------------------------------------------------------------------
# ...but it CAN watch, and it CAN stop
# --------------------------------------------------------------------------

def test_an_agent_key_can_read_the_whole_state(client, session):
    headers, agent = session
    connect_sandbox(client, headers)
    choose_deterministic_model(client, headers)
    client.put("/api/invest/policy", headers=headers, json=full_policy())
    client.post("/api/invest/run", headers=headers)

    state = client.get("/api/invest/oversight/etat", headers=agent)
    assert state.status_code == 200
    body = state.json()
    assert body["mandat"]["instruments_autorises"] == ["AAPL", "BTC-EUR"]
    assert body["journal"]["intact"] is True
    assert len(body["decisions"]) == 2


def test_an_agent_key_can_read_the_contract_it_is_supervising(client, session):
    _, agent = session
    contract = client.get("/api/invest/oversight/contrat", headers=agent).json()
    assert "arrêter le pilotage" in contract["ce_qu_une_cle_d_acces_peut_faire"]
    assert "armer l'exécution réelle" in contract["ce_qu_une_cle_d_acces_ne_peut_pas_faire"]
    assert "halted" in contract["regles_de_risque"]


def test_an_agent_key_can_pull_the_cord(client, session):
    headers, agent = session
    response = client.post("/api/invest/oversight/halt", headers=agent,
                           json={"reason": "écart de calibration anormal"})
    assert response.status_code == 200
    assert response.json()["arrete_par"] == "supervision"
    policy = client.get("/api/invest/policy", headers=headers).json()
    assert policy["halted"] is True
    assert policy["halted_reason"] == "écart de calibration anormal"


def test_a_halt_keeps_the_first_reason_rather_than_the_last(client, session):
    _, agent = session
    client.post("/api/invest/oversight/halt", headers=agent, json={"reason": "première"})
    second = client.post("/api/invest/oversight/halt", headers=agent,
                         json={"reason": "seconde"}).json()
    assert second["raison"] == "première"


def test_a_halt_disarms_real_execution(client, session):
    headers, agent = session
    connect_sandbox(client, headers)
    client.put("/api/invest/policy", headers=headers, json=full_policy(autonomy="live"))
    client.post("/api/invest/policy/arm", headers=headers,
                json={"confirmation": ARM_PHRASE, "minutes": 60})
    assert client.get("/api/invest/policy", headers=headers).json()["armed"] is True

    client.post("/api/invest/oversight/halt", headers=agent, json={"reason": "stop"})
    policy = client.get("/api/invest/policy", headers=headers).json()
    assert policy["armed"] is False
    assert policy["armed_until"] is None


def test_a_halted_pipeline_refuses_to_run(client, session):
    headers, agent = session
    connect_sandbox(client, headers)
    choose_deterministic_model(client, headers)
    client.put("/api/invest/policy", headers=headers, json=full_policy())
    client.post("/api/invest/oversight/halt", headers=agent, json={"reason": "stop"})
    response = client.post("/api/invest/run", headers=headers)
    assert response.status_code == 409
    assert "à l'arrêt" in response.json()["detail"]


# --------------------------------------------------------------------------
# The arming
# --------------------------------------------------------------------------

def test_arming_refuses_a_wrong_phrase_and_says_the_right_one(client, session):
    headers, _ = session
    connect_sandbox(client, headers)
    client.put("/api/invest/policy", headers=headers, json=full_policy(autonomy="live"))
    response = client.post("/api/invest/policy/arm", headers=headers,
                           json={"confirmation": "oui", "minutes": 30})
    assert response.status_code == 422
    assert ARM_PHRASE in response.json()["detail"]


def test_arming_refuses_when_the_mandate_authorises_no_instrument(client, session):
    headers, _ = session
    client.put("/api/invest/policy", headers=headers,
               json=full_policy(autonomy="live", allowed_symbols=[]))
    response = client.post("/api/invest/policy/arm", headers=headers,
                           json={"confirmation": ARM_PHRASE, "minutes": 30})
    assert response.status_code == 422


def test_arming_refuses_while_the_pipeline_is_in_observation_mode(client, session):
    headers, _ = session
    client.put("/api/invest/policy", headers=headers, json=full_policy(autonomy="observer"))
    response = client.post("/api/invest/policy/arm", headers=headers,
                           json={"confirmation": ARM_PHRASE, "minutes": 30})
    assert response.status_code == 422


def test_moving_the_mandate_to_live_never_arms_it_by_itself(client, session):
    headers, _ = session
    client.put("/api/invest/policy", headers=headers, json=full_policy(autonomy="live"))
    client.post("/api/invest/policy/arm", headers=headers,
                json={"confirmation": ARM_PHRASE, "minutes": 30})
    # Back to paper and up to live again: the earlier arming must not survive.
    client.put("/api/invest/policy", headers=headers, json=full_policy(autonomy="paper"))
    policy = client.put("/api/invest/policy", headers=headers,
                        json=full_policy(autonomy="live")).json()
    assert policy["armed"] is False


def test_disarming_takes_effect_immediately(client, session):
    headers, _ = session
    connect_sandbox(client, headers)
    client.put("/api/invest/policy", headers=headers, json=full_policy(autonomy="live"))
    client.post("/api/invest/policy/arm", headers=headers,
                json={"confirmation": ARM_PHRASE, "minutes": 30})
    policy = client.post("/api/invest/policy/disarm", headers=headers).json()
    assert policy["armed"] is False


# --------------------------------------------------------------------------
# Brokers
# --------------------------------------------------------------------------

def test_connecting_the_sandbox_needs_no_credentials(client, session):
    headers, _ = session
    body = connect_sandbox(client, headers)
    assert body["valid"] is True
    venues = client.get("/api/invest/venues", headers=headers).json()
    assert venues[0]["venue"] == "internal"
    assert venues[0]["requires_credentials"] is False


def test_the_simulated_book_cannot_be_connected_in_live_mode(client, session):
    headers, _ = session
    response = client.post("/api/invest/venues", headers=headers, json={
        "venue": "internal", "mode": "live", "label": "x",
    })
    assert response.status_code == 422
    assert "mode papier" in response.json()["detail"]


def test_a_real_broker_without_credentials_is_refused(client, session):
    headers, _ = session
    response = client.post("/api/invest/venues", headers=headers, json={
        "venue": "alpaca", "mode": "paper", "label": "Alpaca",
    })
    assert response.status_code == 422


def test_reading_a_broker_never_returns_its_credentials(client, session):
    headers, _ = session
    connect_sandbox(client, headers)
    body = client.get("/api/invest/venues", headers=headers).json()[0]
    assert "api_key" not in body
    assert "api_secret" not in body
    assert "api_key_encrypted" not in body


def test_the_same_broker_cannot_be_connected_twice_in_one_mode(client, session):
    headers, _ = session
    connect_sandbox(client, headers)
    response = client.post("/api/invest/venues", headers=headers, json={
        "venue": "internal", "mode": "paper", "label": "encore",
    })
    assert response.status_code == 409


# --------------------------------------------------------------------------
# Running, and what a run leaves behind
# --------------------------------------------------------------------------

def test_a_run_without_a_model_refuses_and_names_the_screen(client, session):
    headers, _ = session
    connect_sandbox(client, headers)
    client.put("/api/invest/policy", headers=headers, json=full_policy())
    response = client.post("/api/invest/run", headers=headers)
    assert response.status_code == 409
    assert "Modèle de décision" in response.json()["detail"]


def test_a_run_without_a_broker_refuses_and_names_the_screen(client, session):
    headers, _ = session
    choose_deterministic_model(client, headers)
    client.put("/api/invest/policy", headers=headers, json=full_policy())
    response = client.post("/api/invest/run", headers=headers)
    assert response.status_code == 409
    assert "Courtiers" in response.json()["detail"]


def test_a_run_returns_one_decision_per_whitelisted_instrument(client, session):
    headers, _ = session
    connect_sandbox(client, headers)
    choose_deterministic_model(client, headers)
    client.put("/api/invest/policy", headers=headers, json=full_policy())
    body = client.post("/api/invest/run", headers=headers).json()
    assert body["examined"] == 2
    assert len(body["decisions"]) == 2
    # The sentence agrees: no « instrument(s) », the count decides the form.
    assert body["summary"].startswith("2 instruments examinés : ")
    assert "(s)" not in body["summary"]


def test_a_decision_detail_shows_exactly_what_the_model_was_given(client, session):
    headers, _ = session
    connect_sandbox(client, headers)
    choose_deterministic_model(client, headers)
    client.put("/api/invest/policy", headers=headers, json=full_policy())
    run = client.post("/api/invest/run", headers=headers).json()
    decision_id = run["decisions"][0]["id"]

    detail = client.get(f"/api/invest/decisions/{decision_id}", headers=headers).json()
    assert detail["context"]["instrument"] == detail["symbol"]
    assert [q["key"] for q in detail["questions"]] == [
        "direction", "conviction", "continuation"
    ]
    assert detail["windows"]["rsi"] > 0


def test_the_overview_reports_the_funnel_and_the_calibration(client, session):
    headers, _ = session
    connect_sandbox(client, headers)
    choose_deterministic_model(client, headers)
    client.put("/api/invest/policy", headers=headers, json=full_policy())
    for _ in range(3):
        client.post("/api/invest/run", headers=headers)

    overview = client.get("/api/invest/overview", headers=headers).json()
    assert overview["examined"] == 6
    assert overview["mode"] == "paper"
    assert "calibration" in overview
    assert overview["calibration"]["coin_flip_brier_bps"] == 2_500


def test_one_households_decisions_are_invisible_to_another(client, session):
    headers, _ = session
    connect_sandbox(client, headers)
    choose_deterministic_model(client, headers)
    client.put("/api/invest/policy", headers=headers, json=full_policy())
    client.post("/api/invest/run", headers=headers)

    other = client.post("/api/auth/register", json={
        "name": "Autre", "email": "autre@example.com", "password": "motdepasse123",
    }).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.get("/api/invest/decisions", headers=other_headers).json() == []
    assert client.get("/api/invest/orders", headers=other_headers).json() == []


# --------------------------------------------------------------------------
# Supervision: the replay and the journal
# --------------------------------------------------------------------------

def test_replaying_a_decision_reports_that_it_is_reproducible(client, session):
    headers, agent = session
    connect_sandbox(client, headers)
    choose_deterministic_model(client, headers)
    client.put("/api/invest/policy", headers=headers, json=full_policy())
    run = client.post("/api/invest/run", headers=headers).json()
    decision_id = run["decisions"][0]["id"]

    replay = client.post(f"/api/invest/oversight/replay/{decision_id}", headers=agent).json()
    assert replay["inputs_intact"] is True
    assert replay["matches"] is True
    assert "reproductible" in replay["verdict"]
    # The date is written the French way in a French sentence, never ISO.
    assert re.search(r"du \d{2}/\d{2}/\d{4} est reproductible", replay["verdict"])
    assert not re.search(r"\d{4}-\d{2}-\d{2}", replay["verdict"])


def test_replaying_reports_an_edited_row_rather_than_a_clean_replay(client, session, db):
    from app.models import TradeDecision

    headers, agent = session
    connect_sandbox(client, headers)
    choose_deterministic_model(client, headers)
    client.put("/api/invest/policy", headers=headers, json=full_policy())
    run = client.post("/api/invest/run", headers=headers).json()
    decision_id = run["decisions"][0]["id"]

    row = db.query(TradeDecision).filter(TradeDecision.id == decision_id).one()
    edited = dict(row.features)
    edited["rsi_bps"] = 9_999
    row.features = edited
    db.commit()

    replay = client.post(f"/api/invest/oversight/replay/{decision_id}", headers=agent).json()
    assert replay["inputs_intact"] is False
    assert replay["matches"] is False
    assert "modifiée après son enregistrement" in replay["verdict"]


def test_the_journal_records_every_consequential_action(client, session):
    headers, agent = session
    connect_sandbox(client, headers)
    choose_deterministic_model(client, headers)
    client.put("/api/invest/policy", headers=headers, json=full_policy())
    client.post("/api/invest/run", headers=headers)
    client.post("/api/invest/oversight/halt", headers=agent, json={"reason": "fin du test"})

    journal = client.get("/api/invest/oversight/journal", headers=agent).json()
    kinds = [entry["kind"] for entry in journal["entries"]]
    assert "venue_added" in kinds
    assert "model_changed" in kinds
    assert "policy_changed" in kinds
    assert "decision" in kinds
    assert "halted" in kinds
    assert journal["intact"] is True


def test_the_journal_records_whether_a_session_or_an_agent_acted(client, session):
    headers, agent = session
    connect_sandbox(client, headers)
    client.post("/api/invest/oversight/halt", headers=agent, json={"reason": "par l'agent"})
    journal = client.get("/api/invest/oversight/journal", headers=headers).json()
    by_kind = {entry["kind"]: entry["actor"] for entry in journal["entries"]}
    assert by_kind["venue_added"] == "session"
    assert by_kind["halted"] == "agent"


def test_the_journal_can_be_read_incrementally(client, session):
    headers, agent = session
    connect_sandbox(client, headers)
    first = client.get("/api/invest/oversight/journal", headers=agent).json()
    cursor = first["next_sequence"] - 1
    choose_deterministic_model(client, headers)
    later = client.get(f"/api/invest/oversight/journal?since={cursor}", headers=agent).json()
    assert all(entry["sequence"] > cursor for entry in later["entries"])
    assert later["entries"]
