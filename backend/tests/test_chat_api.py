"""POST/GET /api/chat.

A stored chat message holds only the question text -- see `models.ChatMessage`'s
own docstring -- so every read here re-parses and re-executes it against the
CURRENT ledger. `test_a_stored_question_is_re_executed_not_replayed` proves
that with a mutation: the very same stored row must answer differently once
the ledger underneath it changes, which is only possible if nothing was ever
cached.
"""

from datetime import date

from app.models import Account, User


def _register(client, email="chat@example.fr"):
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
    from app.models import Transaction
    row = Transaction(user_id=user_id, account_id=account_id, date=on,
                      amount_cents=amount, label_raw=label, label_clean=label.lower(),
                      category_id=None, category_source="uncategorized",
                      is_transfer=False, dedup_hash=f"{on}{amount}{label}{account_id}",
                      tags=[])
    db.add(row)
    return row


# --------------------------------------------------------------------------
# POST answers immediately, and the answer is never guessed.
# --------------------------------------------------------------------------


def test_asking_a_recognised_question_answers_with_a_real_figure(client):
    headers = _register(client)
    response = client.post("/api/chat", headers=headers,
                           json={"text": "Combien j'ai dépensé en mars 2026 ?"})
    assert response.status_code == 201
    body = response.json()
    assert body["answer"]["recognised"] is True
    assert body["answer"]["amount_cents"] == 0
    assert "mars" in body["answer"]["query_description"].lower()


def test_an_unrecognised_question_is_a_200_naming_what_is_understood(client):
    """Not a 422: refusing to guess is a complete answer, not a bad request."""
    headers = _register(client)
    response = client.post("/api/chat", headers=headers,
                           json={"text": "Quelle est la météo à Lyon ?"})
    assert response.status_code == 201
    answer = response.json()["answer"]
    assert answer["recognised"] is False
    assert answer["is_refusal"] is True
    assert len(answer["supported_formulations"]) >= 5
    assert answer["query_description"] is None


def test_an_unrecognised_question_is_still_stored_in_history(client):
    headers = _register(client)
    client.post("/api/chat", headers=headers, json={"text": "Quelle est la météo à Lyon ?"})
    listed = client.get("/api/chat", headers=headers).json()
    assert len(listed) == 1
    assert listed[0]["text"] == "Quelle est la météo à Lyon ?"


def test_an_engine_refusal_reaches_the_user_verbatim(client):
    """Fewer than three complete months: the feasibility engine refuses in
    its own words, and that sentence must be exactly what `/api/chat` returns
    -- never softened, never rephrased."""
    headers = _register(client)
    response = client.post("/api/chat", headers=headers,
                           json={"text": "Puis-je m'acheter une voiture à 20000 € dans 12 mois ?"})
    assert response.status_code == 201
    answer = response.json()["answer"]
    assert answer["recognised"] is True
    assert answer["is_refusal"] is True
    assert "trois mois complets" in answer["text"]


def test_a_question_that_parses_but_names_an_out_of_range_value_is_a_422(client):
    """700 months exceeds `feasibility.MAX_HORIZON_MONTHS` (600): a genuinely
    bad input, refused by the engine with a `ValueError` -- the router must
    translate that into a 422, the same idiom every other engine-backed
    route in this codebase already uses."""
    headers = _register(client)
    response = client.post("/api/chat", headers=headers, json={
        "text": "Puis-je m'acheter une voiture à 20000 € dans 700 mois ?"
    })
    assert response.status_code == 422
    # And nothing was stored: a rejected question never enters the history.
    assert client.get("/api/chat", headers=headers).json() == []


# --------------------------------------------------------------------------
# Re-execution, not replay.
# --------------------------------------------------------------------------


def test_a_stored_question_is_re_executed_not_replayed(client, db):
    headers = _register(client)
    user_id = _user_id(db, "chat@example.fr")
    account = _account(db, user_id)

    client.post("/api/chat", headers=headers,
               json={"text": "Combien j'ai dépensé en mars 2026 ?"})
    before = client.get("/api/chat", headers=headers).json()[0]["answer"]
    assert before["amount_cents"] == 0

    _tx(db, user_id, account.id, date(2026, 3, 10), -5_000, "Loyer")
    db.commit()

    after = client.get("/api/chat", headers=headers).json()[0]["answer"]
    assert after["amount_cents"] == -5_000
    # The whole point: if the answer had been cached at write time, `after`
    # would still read exactly like `before`. It must not.
    assert before["amount_cents"] != after["amount_cents"]
    assert before["text"] != after["text"]


def test_a_refusal_stops_being_one_once_the_ledger_supports_an_answer(client, db):
    """The same staleness proof, on the refusal path: three complete,
    profitable months turn a "could not measure" refusal into a real
    verdict on re-read, exactly like `test_scenarios_api.py`'s own proof for
    saved feasibility scenarios."""
    headers = _register(client)
    user_id = _user_id(db, "chat@example.fr")
    account = _account(db, user_id)

    client.post("/api/chat", headers=headers,
               json={"text": "Puis-je m'acheter un vélo à 500 € dans 3 mois ?"})
    before = client.get("/api/chat", headers=headers).json()[0]["answer"]
    assert before["is_refusal"] is True

    # Five months, not three: `capacity.complete_months` only counts a month
    # whose calendar bounds fall INSIDE the ledger's own span, so the first
    # and last calendar months touched by the ledger are always partial.
    # Padding one extra month on each side, as `test_scenarios_api.py` does
    # for the identical reason, leaves three genuinely complete months
    # (February, March, April) in the middle.
    for month in (1, 2, 3, 4, 5):
        _tx(db, user_id, account.id, date(2026, month, 5), 300_000, f"SALAIRE {month}")
        _tx(db, user_id, account.id, date(2026, month, 20), -50_000, f"DEPENSE {month}")
    db.commit()

    after = client.get("/api/chat", headers=headers).json()[0]["answer"]
    assert after["is_refusal"] is False
    assert "atteignable" in after["text"]


# --------------------------------------------------------------------------
# Isolation.
# --------------------------------------------------------------------------


def test_chat_history_never_crosses_users(client):
    alice = _register(client, "alice-chat@example.fr")
    bob = _register(client, "bob-chat@example.fr")
    client.post("/api/chat", headers=bob, json={"text": "Combien me coûtent mes abonnements ?"})

    # Bob's own read proves the seeding above actually landed, so the
    # assertion below (that Alice sees none of it) cannot pass vacuously.
    bob_history = client.get("/api/chat", headers=bob).json()
    assert len(bob_history) == 1

    alice_history = client.get("/api/chat", headers=alice).json()
    assert alice_history == []


# --------------------------------------------------------------------------
# The chart an answer deserves, on the wire.
# --------------------------------------------------------------------------


def test_a_chart_reaches_the_wire_and_decomposes_the_figure(client, db):
    headers = _register(client, "chart@example.fr")
    user_id = _user_id(db, "chart@example.fr")
    account = _account(db, user_id)
    _tx(db, user_id, account.id, date(2026, 1, 9), -2_000, "Le Bistrot")
    _tx(db, user_id, account.id, date(2026, 2, 9), -6_000, "Le Bistrot")
    _tx(db, user_id, account.id, date(2026, 3, 9), -1_000, "Le Bistrot")
    db.commit()

    body = client.post("/api/chat", headers=headers, json={
        "text": "Combien j'ai dépensé depuis janvier 2026 ?"}).json()
    chart = body["answer"]["chart"]
    assert chart is not None
    assert chart["kind"] == "bars"
    assert [point["label"] for point in chart["points"]] == [
        "janvier 2026", "février 2026", "mars 2026",
    ]
    assert sum(point["amount_cents"] for point in chart["points"]) == \
        body["answer"]["amount_cents"]


def test_an_unrecognised_question_carries_no_chart(client):
    headers = _register(client, "nochart@example.fr")
    body = client.post("/api/chat", headers=headers, json={
        "text": "Quel temps fera-t-il demain ?"}).json()
    assert body["answer"]["recognised"] is False
    assert body["answer"]["chart"] is None
    # The refusal still names what it DOES understand, and it is not empty.
    assert len(body["answer"]["supported_formulations"]) == 10


# --------------------------------------------------------------------------
# Clearing the conversation.
# --------------------------------------------------------------------------


def test_clearing_the_conversation_removes_this_users_history_only(client):
    mine = _register(client, "mine@example.fr")
    theirs = _register(client, "theirs@example.fr")
    client.post("/api/chat", headers=mine, json={"text": "Combien j'ai dépensé en mars ?"})
    client.post("/api/chat", headers=theirs, json={"text": "Combien j'ai dépensé en avril ?"})

    # The other user's own read shows what was seeded, BEFORE anything asserts
    # the first sees none of it -- a fixture that silently wrote nothing would
    # otherwise make the isolation assertion below pass for the wrong reason.
    assert len(client.get("/api/chat", headers=theirs).json()) == 1
    assert len(client.get("/api/chat", headers=mine).json()) == 1

    assert client.delete("/api/chat", headers=mine).status_code == 204
    assert client.get("/api/chat", headers=mine).json() == []
    assert len(client.get("/api/chat", headers=theirs).json()) == 1


# --------------------------------------------------------------------------
# The trace travels with the answer.
# --------------------------------------------------------------------------


def test_an_answer_carries_the_steps_that_produced_it(client):
    """"Les outils qu'il utilise, les pages et données qu'il interroge" is a
    payload, not a front-end animation: the drawer may stagger the reveal,
    but it never invents a line."""
    headers = _register(client)
    answer = client.post("/api/chat", headers=headers,
                         json={"text": "Combien j'ai dépensé en mars 2026 ?"}).json()["answer"]
    steps = answer["steps"]
    assert [step["tool"] for step in steps][0] == "engines/intent"
    assert any(step["tool"] == "relevé" for step in steps)
    assert all(step["label"] and step["source"] for step in steps)


def test_an_unrecognised_question_reports_the_one_step_that_did_run(client):
    """A refusal is not a blank trace: the sentence WAS read, and saying so is
    what distinguishes "je n'ai pas compris" from "rien ne s'est passé"."""
    headers = _register(client)
    answer = client.post("/api/chat", headers=headers,
                         json={"text": "Quelle est la météo à Lyon ?"}).json()["answer"]
    assert [step["tool"] for step in answer["steps"]] == ["engines/intent"]
    assert answer["steps"][0]["screen"] is None


def test_the_trace_is_recomputed_on_every_read_like_the_answer(client, db):
    """The trace counts the ledger, so a stored question re-read after an
    import must report the bigger ledger -- same staleness contract as the
    figure it stands beside."""
    headers = _register(client)
    client.post("/api/chat", headers=headers, json={"text": "Combien j'ai dépensé en mars 2026 ?"})
    before = client.get("/api/chat", headers=headers).json()[0]["answer"]["steps"]

    user_id = _user_id(db, "chat@example.fr")
    account = _account(db, user_id)
    _tx(db, user_id, account.id, date(2026, 3, 4), -2_500, "Le Bistrot")
    db.commit()

    after = client.get("/api/chat", headers=headers).json()[0]["answer"]["steps"]
    ledger_before = next(s for s in before if s["tool"] == "relevé")["source"]
    ledger_after = next(s for s in after if s["tool"] == "relevé")["source"]
    assert "0 opérations" in ledger_before
    assert "1 opérations" in ledger_after


# --------------------------------------------------------------------------
# Conversations: starting a new one, and finding the old ones again.
# --------------------------------------------------------------------------


def test_a_first_question_opens_a_conversation(client):
    headers = _register(client)
    body = client.post("/api/chat", headers=headers,
                       json={"text": "Combien j'ai dépensé en mars 2026 ?"}).json()
    assert body["conversation_id"] >= 1


def test_questions_without_a_stated_conversation_start_new_ones(client):
    """Omitting the id means "start fresh", never "guess which thread this
    belongs to". A client that lost track must not silently append to a
    conversation the reader thought was closed."""
    headers = _register(client)
    first = client.post("/api/chat", headers=headers, json={"text": "Quel est mon solde net ?"}).json()
    second = client.post("/api/chat", headers=headers, json={"text": "Et mes budgets ?"}).json()
    assert first["conversation_id"] != second["conversation_id"]


def test_a_stated_conversation_is_continued(client):
    headers = _register(client)
    first = client.post("/api/chat", headers=headers, json={"text": "Quel est mon solde net ?"}).json()
    second = client.post("/api/chat", headers=headers, json={
        "text": "Et mes budgets ?", "conversation_id": first["conversation_id"]}).json()
    assert second["conversation_id"] == first["conversation_id"]


def test_the_conversation_list_is_newest_first_and_titled_by_its_first_question(client):
    """The title is DERIVED from the first question, never stored: a stored
    title is a second copy of the same fact, free to drift from it."""
    headers = _register(client)
    client.post("/api/chat", headers=headers, json={"text": "Quel est mon solde net ce mois-ci ?"})
    client.post("/api/chat", headers=headers, json={"text": "Où en sont mes budgets ?"})

    rows = client.get("/api/chat/conversations", headers=headers).json()
    assert [row["title"] for row in rows] == [
        "Où en sont mes budgets ?", "Quel est mon solde net ce mois-ci ?"]
    assert rows[0]["message_count"] == 1


def test_a_conversation_can_be_read_on_its_own(client):
    headers = _register(client)
    first = client.post("/api/chat", headers=headers, json={"text": "Quel est mon solde net ?"}).json()
    client.post("/api/chat", headers=headers, json={"text": "Où en sont mes budgets ?"})

    only = client.get(f"/api/chat?conversation_id={first['conversation_id']}", headers=headers).json()
    assert [row["text"] for row in only] == ["Quel est mon solde net ?"]


def test_one_conversation_can_be_deleted_without_touching_the_others(client):
    headers = _register(client)
    first = client.post("/api/chat", headers=headers, json={"text": "Quel est mon solde net ?"}).json()
    client.post("/api/chat", headers=headers, json={"text": "Où en sont mes budgets ?"})

    assert client.delete(
        f"/api/chat?conversation_id={first['conversation_id']}", headers=headers
    ).status_code == 204
    remaining = client.get("/api/chat/conversations", headers=headers).json()
    assert [row["title"] for row in remaining] == ["Où en sont mes budgets ?"]


def test_deleting_without_naming_a_conversation_still_clears_everything(client):
    """The existing contract, unchanged: "Effacer la conversation" on the full
    screen wiped the lot, and a household that presses it expects the lot."""
    headers = _register(client)
    client.post("/api/chat", headers=headers, json={"text": "Quel est mon solde net ?"})
    client.post("/api/chat", headers=headers, json={"text": "Où en sont mes budgets ?"})
    assert client.delete("/api/chat", headers=headers).status_code == 204
    assert client.get("/api/chat/conversations", headers=headers).json() == []


def test_another_household_s_conversation_cannot_be_written_into(client):
    """CLAUDE.md's isolation rule, at the one place this feature could break
    it: `conversation_id` arrives from the client and is the only field on
    this API that names someone else's row."""
    mine = _register(client, "mine@example.fr")
    theirs = _register(client, "theirs@example.fr")
    opened = client.post("/api/chat", headers=theirs, json={"text": "Quel est mon solde net ?"}).json()

    refused = client.post("/api/chat", headers=mine, json={
        "text": "Où en sont mes budgets ?", "conversation_id": opened["conversation_id"]})
    assert refused.status_code == 404
    assert client.get("/api/chat/conversations", headers=mine).json() == []


def test_another_household_s_conversation_cannot_be_read_or_deleted(client):
    mine = _register(client, "mine2@example.fr")
    theirs = _register(client, "theirs2@example.fr")
    opened = client.post("/api/chat", headers=theirs, json={"text": "Quel est mon solde net ?"}).json()
    cid = opened["conversation_id"]

    assert client.get(f"/api/chat?conversation_id={cid}", headers=mine).json() == []
    assert client.delete(f"/api/chat?conversation_id={cid}", headers=mine).status_code == 204
    assert len(client.get("/api/chat/conversations", headers=theirs).json()) == 1
