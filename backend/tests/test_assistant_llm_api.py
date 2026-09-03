"""`/api/assistant/llm-settings` and `POST /api/assistant/llm`.

The isolation test below asserts the OTHER user's own read first -- see
`test_export_api.py`'s own module docstring for why: a fixture that
silently wrote nothing would make "the first user sees none of it" pass for
the wrong reason.
"""

from datetime import date

import httpx

from app.models import Account, Transaction, User

ENDPOINT_URL = "http://localhost:11434/v1"
MODEL_NAME = "llama3"


def _register(client, email="assistant-llm@example.fr"):
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _user_id(db, email: str) -> int:
    return db.query(User).filter(User.email == email).one().id


def _account(db, user_id: int) -> Account:
    account = Account(user_id=user_id, name="Courant", kind="checking", currency="EUR",
                      opening_balance_cents=0, include_in_net_worth=True, archived=False)
    db.add(account)
    db.flush()
    return account


def _tx(db, user_id, account_id, on, amount, label):
    row = Transaction(user_id=user_id, account_id=account_id, date=on,
                      amount_cents=amount, label_raw=label, label_clean=label.lower(),
                      category_id=None, category_source="uncategorized",
                      is_transfer=False, dedup_hash=f"{on}{amount}{label}{account_id}",
                      tags=[])
    db.add(row)
    return row


def _seed_march_spend(db, user_id: int, cents: int = -12_000) -> None:
    account = _account(db, user_id)
    _tx(db, user_id, account.id, date(2026, 3, 4), cents, "CARTE CARREFOUR")
    db.commit()


def _stub_llm(monkeypatch, content: str | None = None, *, status: int = 200,
              raise_exc: Exception | None = None):
    """Patches the `httpx.Client` `app.llm.client.request_commentary` builds
    so the REAL client code runs end to end -- prompt built, request sent,
    response parsed -- against a stubbed transport rather than a bypassed
    function. `httpx.Client(transport=..., timeout=...)`'s own `transport`
    argument is ignored in favour of the stub; nothing else about the call
    changes."""
    def handler(request: httpx.Request) -> httpx.Response:
        if raise_exc is not None:
            raise raise_exc
        return httpx.Response(status, json={"choices": [{"message": {"content": content}}]})

    # `app.llm.client` imports the `httpx` MODULE, not the `Client` name, so
    # patching `app.llm.client.httpx.Client` patches the SAME class object
    # this test file's own `httpx.Client` name resolves to -- capture the
    # real one first, or `fake_client` would recurse into itself.
    real_client_cls = httpx.Client

    def fake_client(*, transport=None, timeout=None):
        return real_client_cls(transport=httpx.MockTransport(handler), timeout=timeout)

    monkeypatch.setattr("app.llm.client.httpx.Client", fake_client)


def _configure(client, headers, *, api_key: str | None = None):
    return client.put("/api/assistant/llm-settings", headers=headers, json={
        "endpoint_url": ENDPOINT_URL, "model_name": MODEL_NAME, "api_key": api_key,
    })


# --------------------------------------------------------------------------
# Settings: never echoes the key back.
# --------------------------------------------------------------------------


def test_reading_settings_with_nothing_configured_says_so(client):
    headers = _register(client, "none-llm@example.fr")
    body = client.get("/api/assistant/llm-settings", headers=headers).json()
    assert body == {
        "configured": False, "endpoint_url": None, "model_name": None, "has_key": False,
    }


def test_storing_settings_never_returns_the_key(client):
    headers = _register(client, "store-llm@example.fr")
    body = _configure(client, headers, api_key="sk-super-secret").json()
    assert body["configured"] is True
    assert body["endpoint_url"] == ENDPOINT_URL
    assert body["model_name"] == MODEL_NAME
    assert body["has_key"] is True
    assert "sk-super-secret" not in str(body)


def test_the_stored_key_is_encrypted_at_rest(client, db):
    headers = _register(client, "encrypt-llm@example.fr")
    _configure(client, headers, api_key="sk-super-secret")
    from app.models import LlmSettings
    row = db.query(LlmSettings).filter(
        LlmSettings.user_id == _user_id(db, "encrypt-llm@example.fr")
    ).one()
    assert row.api_key_encrypted is not None
    assert row.api_key_encrypted != "sk-super-secret"
    assert "sk-super-secret" not in row.api_key_encrypted


def test_a_local_endpoint_can_be_configured_with_no_key_at_all(client):
    headers = _register(client, "nokey-llm@example.fr")
    body = _configure(client, headers).json()
    assert body["configured"] is True
    assert body["has_key"] is False


def test_editing_the_url_without_touching_the_key_field_keeps_the_key(client, db):
    headers = _register(client, "keep-llm@example.fr")
    _configure(client, headers, api_key="sk-super-secret")
    from app.models import LlmSettings
    original = db.query(LlmSettings).filter(
        LlmSettings.user_id == _user_id(db, "keep-llm@example.fr")
    ).one().api_key_encrypted

    client.put("/api/assistant/llm-settings", headers=headers, json={
        "endpoint_url": "http://localhost:1234/v1", "model_name": "other-model",
    })
    row = db.query(LlmSettings).filter(
        LlmSettings.user_id == _user_id(db, "keep-llm@example.fr")
    ).one()
    assert row.api_key_encrypted == original
    assert row.endpoint_url == "http://localhost:1234/v1"


def test_deleting_settings_degrades_the_configuration_to_absent(client):
    headers = _register(client, "delete-llm@example.fr")
    _configure(client, headers, api_key="sk-super-secret")
    body = client.delete("/api/assistant/llm-settings", headers=headers).json()
    assert body["configured"] is False
    body = client.get("/api/assistant/llm-settings", headers=headers).json()
    assert body["configured"] is False


# --------------------------------------------------------------------------
# The four degradation causes, on POST /api/assistant/llm.
# --------------------------------------------------------------------------


def test_an_unconfigured_model_degrades_to_the_deterministic_answer_alone(client, db):
    headers = _register(client, "unconf-llm@example.fr")
    _seed_march_spend(db, _user_id(db, "unconf-llm@example.fr"))
    body = client.post("/api/assistant/llm", headers=headers,
                       json={"text": "Combien j'ai dépensé en mars 2026 ?"}).json()
    assert body["engine_answer"]["recognised"] is True
    assert body["engine_answer"]["amount_cents"] == -12_000
    assert body["commentary"] is None
    assert "Aucun modèle n'est configuré" in body["degraded_reason"]


def test_an_unrecognised_question_is_never_sent_to_the_model(client, monkeypatch):
    """No engine figure exists to hand the model -- see the router's own
    docstring. A transport that raises on any call proves the model was
    never even asked."""
    headers = _register(client, "unrec-llm@example.fr")
    _configure(client, headers)

    def _unreachable(_request):
        raise AssertionError("must not call the model on an unrecognised question")

    real_client_cls = httpx.Client
    monkeypatch.setattr(
        "app.llm.client.httpx.Client",
        lambda *, transport=None, timeout=None: real_client_cls(
            transport=httpx.MockTransport(_unreachable), timeout=timeout
        ),
    )
    body = client.post("/api/assistant/llm", headers=headers,
                       json={"text": "Quelle est la météo à Lyon ?"}).json()
    assert body["engine_answer"]["recognised"] is False
    assert body["commentary"] is None
    assert body["degraded_reason"] is None


def test_a_rejected_key_names_its_own_cause(client, monkeypatch, db):
    headers = _register(client, "reject-llm@example.fr")
    _seed_march_spend(db, _user_id(db, "reject-llm@example.fr"))
    _configure(client, headers, api_key="sk-bad")
    _stub_llm(monkeypatch, status=401)

    body = client.post("/api/assistant/llm", headers=headers,
                       json={"text": "Combien j'ai dépensé en mars 2026 ?"}).json()
    assert body["commentary"] is None
    assert "clé" in body["degraded_reason"]
    assert body["engine_answer"]["amount_cents"] == -12_000


def test_an_unreachable_endpoint_names_its_own_cause(client, monkeypatch, db):
    headers = _register(client, "unreach-llm@example.fr")
    _seed_march_spend(db, _user_id(db, "unreach-llm@example.fr"))
    _configure(client, headers)
    _stub_llm(monkeypatch, raise_exc=httpx.ConnectError("refused"))

    body = client.post("/api/assistant/llm", headers=headers,
                       json={"text": "Combien j'ai dépensé en mars 2026 ?"}).json()
    assert body["commentary"] is None
    assert "injoignable" in body["degraded_reason"]


def test_a_slow_endpoint_names_a_timeout_never_the_unreachable_cause(client, monkeypatch, db):
    headers = _register(client, "slow-llm@example.fr")
    _seed_march_spend(db, _user_id(db, "slow-llm@example.fr"))
    _configure(client, headers)
    _stub_llm(monkeypatch, raise_exc=httpx.ReadTimeout("timed out"))

    body = client.post("/api/assistant/llm", headers=headers,
                       json={"text": "Combien j'ai dépensé en mars 2026 ?"}).json()
    assert body["commentary"] is None
    assert "trop tard" in body["degraded_reason"]
    assert "injoignable" not in body["degraded_reason"]


def test_a_working_model_comments_beside_the_engine_figure(client, monkeypatch, db):
    headers = _register(client, "ok-llm@example.fr")
    _seed_march_spend(db, _user_id(db, "ok-llm@example.fr"))
    _configure(client, headers)
    _stub_llm(monkeypatch, content="Cette dépense est dans la moyenne du mois.")

    body = client.post("/api/assistant/llm", headers=headers,
                       json={"text": "Combien j'ai dépensé en mars 2026 ?"}).json()
    assert body["commentary"] == "Cette dépense est dans la moyenne du mois."
    assert body["degraded_reason"] is None
    assert body["engine_answer"]["amount_cents"] == -12_000


# --------------------------------------------------------------------------
# The contract: the model never calculates, proved on the wire.
# --------------------------------------------------------------------------


def test_a_hallucinated_number_survives_only_as_prose_never_as_a_wire_figure(
    client, monkeypatch, db
):
    """The completion states a WRONG figure -- 999 999,99 EUR, nowhere near
    the real -120,00 EUR the engine computed. `engine_answer.amount_cents`
    must still be the real figure, and the wrong one must appear NOWHERE
    else on the wire: if this client ever started parsing a number back out
    of the model's prose into some other field, this is where it would
    show up."""
    import json as _json

    headers = _register(client, "hallucinate-llm@example.fr")
    _seed_march_spend(db, _user_id(db, "hallucinate-llm@example.fr"))
    _configure(client, headers)
    wrong_text = "En réalité vous avez dépensé 999 999,99 € en mars, pas ce que Yieldo affiche."
    _stub_llm(monkeypatch, content=wrong_text)

    body = client.post("/api/assistant/llm", headers=headers,
                       json={"text": "Combien j'ai dépensé en mars 2026 ?"}).json()

    # The real, engine-computed figure -- untouched by the model's own text.
    assert body["engine_answer"]["amount_cents"] == -12_000
    # The hallucinated figure survives, but ONLY inside the free-text
    # commentary -- exactly where a model's prose belongs.
    assert body["commentary"] == wrong_text
    assert "999 999,99" in body["commentary"]
    # And nowhere else: strip the commentary out and prove the wrong figure
    # is not hiding in some OTHER field of the same response.
    rest_of_wire = {key: value for key, value in body.items() if key != "commentary"}
    assert "999 999,99" not in _json.dumps(rest_of_wire)
    assert "999999" not in _json.dumps(rest_of_wire)


# --------------------------------------------------------------------------
# Isolation. The OTHER user's own read is asserted FIRST.
# --------------------------------------------------------------------------


def test_llm_settings_never_cross_users(client, monkeypatch, db):
    theirs = _register(client, "theirs-llm@example.fr")
    mine = _register(client, "mine-llm@example.fr")
    _seed_march_spend(db, _user_id(db, "theirs-llm@example.fr"))
    _seed_march_spend(db, _user_id(db, "mine-llm@example.fr"))
    _configure(client, theirs, api_key="sk-theirs")
    _stub_llm(monkeypatch, content="Commentaire du modèle de l'autre foyer.")

    # Their own read FIRST: if the fixture silently wrote nothing, this
    # fails here rather than making the isolation assertion below pass for
    # free.
    theirs_body = client.post("/api/assistant/llm", headers=theirs,
                              json={"text": "Combien j'ai dépensé en mars 2026 ?"}).json()
    assert theirs_body["commentary"] == "Commentaire du modèle de l'autre foyer."
    assert theirs_body["degraded_reason"] is None

    mine_settings = client.get("/api/assistant/llm-settings", headers=mine).json()
    assert mine_settings["configured"] is False

    mine_body = client.post("/api/assistant/llm", headers=mine,
                            json={"text": "Combien j'ai dépensé en mars 2026 ?"}).json()
    assert mine_body["commentary"] is None
    assert "Aucun modèle n'est configuré" in mine_body["degraded_reason"]
    assert mine_body["engine_answer"]["amount_cents"] == -12_000
