"""/api/connector -- tools, describe and call, as EZLink's Yieldo agent uses them."""

from app.models import ConnectorAction, Transaction


def connector(client, headers) -> dict[str, str]:
    token = client.post("/api/connector-key", headers=headers).json()["key"]
    return {"Authorization": f"Bearer {token}"}


def register(client, email):
    response = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def call(client, key, tool, args=None, approval_id=None):
    payload = {"tool": tool, "args": args or {}}
    if approval_id is not None:
        payload["approval_id"] = approval_id
    return client.post("/api/connector/call", headers=key, json=payload)


def a_transaction(db) -> Transaction:
    return db.query(Transaction).order_by(Transaction.id).first()


def test_a_session_and_an_agent_key_are_turned_away(client, imported):
    headers, _ = imported
    agent_key = client.get("/api/access-key", headers=headers).json()["key"]
    agent = {"Authorization": f"Bearer {agent_key}"}

    assert client.get("/api/connector/tools", headers=headers).status_code == 401
    assert client.get("/api/connector/tools", headers=agent).status_code == 401
    assert "ycn_" in client.get("/api/connector/tools", headers=agent).json()["detail"]


def test_the_catalogue_is_published_with_its_fingerprint(client, imported):
    headers, _ = imported
    body = client.get("/api/connector/tools", headers=connector(client, headers)).json()

    names = {tool["name"] for tool in body["tools"]}
    assert {"yieldo_lire_avenir", "yieldo_corriger_transaction",
            "yieldo_supprimer_transaction"} <= names
    assert len(body["fingerprint"]) == 64


def test_a_read_answers_exactly_what_the_route_answers(client, imported):
    headers, _ = imported
    key = connector(client, headers)

    response = call(client, key, "yieldo_lire_comptes")

    assert response.status_code == 200
    assert response.json()["body"] == client.get("/api/accounts", headers=headers).json()
    assert response.json()["fingerprint"] == client.get(
        "/api/connector/tools", headers=key).json()["fingerprint"]


def test_query_arguments_reach_the_route(client, imported):
    headers, _ = imported
    key = connector(client, headers)

    body = call(client, key, "yieldo_lire_transactions", {"limit": 2}).json()["body"]

    assert len(body["items"] if isinstance(body, dict) else body) == 2


def test_a_direct_write_is_made_and_recorded(client, imported, db):
    headers, _ = imported
    key = connector(client, headers)
    transaction = a_transaction(db)
    category_id = client.post("/api/categories", headers=headers,
                              json={"name": "Essai", "kind": "expense"}).json()["id"]

    response = call(client, key, "yieldo_corriger_transaction",
                    {"transaction_id": transaction.id, "category_id": category_id})

    assert response.status_code == 200
    db.refresh(transaction)
    assert transaction.category_id == category_id
    action = db.query(ConnectorAction).one()
    assert action.tool == "yieldo_corriger_transaction"
    assert action.status_code == 200
    assert action.approval_id is None


def test_a_read_is_not_recorded(client, imported, db):
    headers, _ = imported
    call(client, connector(client, headers), "yieldo_lire_comptes")
    assert db.query(ConnectorAction).count() == 0


def test_an_approval_tool_without_its_approval_writes_nothing(client, imported, db):
    headers, _ = imported
    transaction = a_transaction(db)

    response = call(client, connector(client, headers), "yieldo_supprimer_transaction",
                    {"transaction_id": transaction.id})

    assert response.status_code == 403
    assert "Discord" in response.json()["detail"]
    assert db.get(Transaction, transaction.id) is not None


def test_an_approved_call_runs_and_keeps_its_approval(client, imported, db):
    headers, _ = imported
    transaction_id = a_transaction(db).id

    response = call(client, connector(client, headers), "yieldo_supprimer_transaction",
                    {"transaction_id": transaction_id}, approval_id="apv_123")

    assert response.status_code == 204 or response.json()["status"] == 204
    assert db.get(Transaction, transaction_id) is None
    assert db.query(ConnectorAction).one().approval_id == "apv_123"


def test_describing_a_deletion_names_the_row_and_writes_nothing(client, imported, db):
    headers, _ = imported
    transaction = a_transaction(db)

    response = client.post("/api/connector/describe", headers=connector(client, headers),
                           json={"tool": "yieldo_supprimer_transaction",
                                 "args": {"transaction_id": transaction.id}})

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary.startswith("Supprimer la transaction du ")
    assert transaction.label_raw in summary
    assert "€" in summary
    assert response.json()["tier"] == "approve"
    assert db.get(Transaction, transaction.id) is not None
    assert db.query(ConnectorAction).count() == 0


def test_describing_another_households_row_is_not_found(client, imported, db):
    _, _ = imported
    transaction = a_transaction(db)
    stranger = connector(client, register(client, "autre@example.com"))

    response = client.post("/api/connector/describe", headers=stranger,
                           json={"tool": "yieldo_supprimer_transaction",
                                 "args": {"transaction_id": transaction.id}})

    assert response.status_code == 404


def test_a_call_never_reaches_another_households_row(client, imported, db):
    _, _ = imported
    transaction = a_transaction(db)
    stranger = connector(client, register(client, "autre@example.com"))

    response = call(client, stranger, "yieldo_supprimer_transaction",
                    {"transaction_id": transaction.id}, approval_id="apv_1")

    assert response.status_code == 404
    assert db.get(Transaction, transaction.id) is not None


def test_an_unknown_argument_and_a_missing_one_are_refused_before_anything_runs(client, imported):
    headers, _ = imported
    key = connector(client, headers)

    unknown = call(client, key, "yieldo_lire_comptes", {"surprise": 1})
    missing = client.post("/api/connector/describe", headers=key,
                          json={"tool": "yieldo_supprimer_transaction", "args": {}})

    assert unknown.status_code == 422
    assert "surprise" in unknown.json()["detail"]
    assert missing.status_code == 422
    assert "transaction_id" in missing.json()["detail"]


def test_an_unknown_tool_says_where_the_list_is(client, imported):
    headers, _ = imported
    response = call(client, connector(client, headers), "yieldo_tout_effacer")
    assert response.status_code == 404
    assert "/api/connector/tools" in response.json()["detail"]


def test_a_route_refusal_comes_back_in_french_with_its_status(client, imported):
    headers, _ = imported

    response = call(client, connector(client, headers), "yieldo_corriger_transaction",
                    {"transaction_id": 999_999, "category_id": 1})

    assert response.status_code == 404
    assert response.json()["detail"]
    assert response.json()["status"] == 404


def test_every_read_without_required_arguments_answers_without_crashing(client, imported):
    from app.connector.catalog import CATALOG, input_schema

    headers, _ = imported
    key = connector(client, headers)
    crashed = []
    for tool in CATALOG.values():
        if tool.tier != "read" or input_schema(tool).get("required"):
            continue
        response = call(client, key, tool.name)
        if response.status_code >= 500:
            crashed.append((tool.name, response.status_code))
    assert crashed == []


def test_every_approval_sentence_refuses_a_row_that_does_not_exist(client, imported):
    from app.connector.catalog import CATALOG, input_schema

    headers, _ = imported
    key = connector(client, headers)
    crashed = []
    for tool in CATALOG.values():
        if tool.tier != "approve":
            continue
        schema = input_schema(tool)
        args = {name: (999_999 if schema["properties"][name].get("type") == "integer"
                       else "2026-01-01")
                for name in schema.get("required", [])}
        response = client.post("/api/connector/describe", headers=key,
                               json={"tool": tool.name, "args": args})
        if response.status_code >= 500 or (
            response.status_code == 200 and not response.json()["summary"].strip()
        ):
            crashed.append((tool.name, response.status_code))
    assert crashed == []


def test_the_household_sees_what_the_connector_did(client, imported, db):
    headers, _ = imported
    key = connector(client, headers)
    call(client, key, "yieldo_supprimer_transaction",
         {"transaction_id": a_transaction(db).id}, approval_id="apv_9")

    actions = client.get("/api/connector-key/actions", headers=headers).json()

    assert actions[0]["tool"] == "yieldo_supprimer_transaction"
    assert actions[0]["title"] == "Supprimer une transaction."
    assert actions[0]["tier"] == "approve"
    assert actions[0]["approval_id"] == "apv_9"
    assert client.get("/api/connector-key/actions", headers=key).status_code == 401
