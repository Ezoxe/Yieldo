"""What the agent can now read, and what it can now propose.

The household kept handing its ledger to an outside model because Yieldo's own
agent could not reach the questions being asked of it: where a solde comes from,
whether the two legs of an internal transfer are both flagged, what an
assurance-vie holds, what a month really costs. Four reads and four proposals
close that gap.

**The wall does not move.** Every new write tool appends to `agent_proposals`
and returns "proposé"; the appliers here run only from
`POST /agent/proposals/{id}/apply`, which a human clicks. A model fully taken in
by a merchant label that says "corrige tous mes soldes" can still only produce a
row somebody reads first.
"""

from datetime import date

from app.llm.tools import BY_NAME, TOOLS, ToolContext
from app.models import Account, AgentProposal, InvestmentAccount, Transaction


def _register(client, email: str = "max@example.com") -> dict[str, str]:
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _user(db):
    from app.models import User

    return db.query(User).first()


def _context(db, today: str = "2026-09-06") -> ToolContext:
    return ToolContext(db=db, user=_user(db), today=date.fromisoformat(today), run_id=None)


def _row(db, user_id, account_id, amount, *, on="2026-08-10", transfer=False, label="OP"):
    row = Transaction(
        user_id=user_id, account_id=account_id, date=date.fromisoformat(on),
        amount_cents=amount, label_raw=label, label_clean=label.lower(),
        category_source="uncategorized", is_transfer=transfer,
        dedup_hash=f"{account_id}-{amount}-{on}-{label}-{transfer}",
    )
    db.add(row)
    db.commit()
    return row


def test_every_read_tool_runs_on_an_empty_household(client, db):
    """A tool that raises on a household with no data is a tool the model cannot
    use on its first question."""
    _register(client)
    context = _context(db)
    for tool in TOOLS:
        if tool.writes_proposal:
            continue
        assert isinstance(tool.run(context, {}), str)


def test_reading_the_balances_names_each_account_and_its_two_halves(client, db):
    headers = _register(client)
    account = client.post("/api/accounts", headers=headers, json={
        "name": "Courant", "kind": "checking", "opening_balance_cents": 100_000}).json()
    user = _user(db)
    _row(db, user.id, account["id"], -25_000)

    answer = BY_NAME["lire_soldes"].run(_context(db), {})

    assert "Courant" in answer
    # `euros` formats without a thousands separator, so the two halves and their
    # sum read literally.
    assert "1000,00" in answer
    assert "-250,00" in answer
    assert "750,00" in answer


def test_reading_the_balances_reports_a_transfer_flagged_on_one_side_only(client, db):
    """The defect that made the household's income look larger than it was."""
    headers = _register(client)
    account = client.post("/api/accounts", headers=headers, json={
        "name": "Courant", "kind": "checking"}).json()
    user = _user(db)
    _row(db, user.id, account["id"], 40_000, transfer=True, label="VIR RECU DE MOI")
    _row(db, user.id, account["id"], -40_000, transfer=False, label="VIR EMIS POUR MOI")

    answer = BY_NAME["lire_soldes"].run(_context(db), {})

    assert "écart" in answer
    assert "faussés" in answer


def test_reading_the_balances_says_nothing_alarming_when_the_legs_cancel(client, db):
    headers = _register(client)
    account = client.post("/api/accounts", headers=headers, json={
        "name": "Courant", "kind": "checking"}).json()
    user = _user(db)
    _row(db, user.id, account["id"], 40_000, transfer=True, label="RECU")
    _row(db, user.id, account["id"], -40_000, transfer=True, label="EMIS")

    assert "faussés" not in BY_NAME["lire_soldes"].run(_context(db), {})


def test_reading_the_capacity_refuses_rather_than_estimating(client, db):
    _register(client)
    answer = BY_NAME["lire_capacite"].run(_context(db), {})
    assert "rien n'est mesurable" in answer.lower()


def test_reading_the_portfolio_reports_a_declared_amount_and_its_date(client, db):
    headers = _register(client)
    client.post("/api/portfolio/accounts", headers=headers, json={
        "name": "MACIF", "kind": "assurance_vie", "opened_on": "2001-08-30",
        "declared_value_cents": 1_450_000, "declared_value_on": "2026-08-31"})

    answer = BY_NAME["lire_patrimoine"].run(_context(db), {})

    assert "MACIF" in answer
    assert "2026-08-31" in answer


def test_reading_the_portfolio_says_when_an_envelope_declares_nothing(client, db):
    headers = _register(client)
    client.post("/api/portfolio/accounts", headers=headers,
                json={"name": "PEA", "kind": "pea"})

    assert "aucun montant déclaré" in BY_NAME["lire_patrimoine"].run(_context(db), {})


def test_a_write_tool_writes_nothing_but_a_proposal(client, db):
    """The wall, stated as a test: the row the tool touches is unchanged and a
    pending proposal exists in its place."""
    headers = _register(client)
    account = client.post("/api/accounts", headers=headers, json={
        "name": "Courant", "kind": "checking"}).json()
    user = _user(db)
    row = _row(db, user.id, account["id"], -1_250, on="2026-08-10")

    answer = BY_NAME["proposer_correction_operation"].run(
        _context(db), {"transaction_id": row.id, "date": "2026-12-08"})
    db.commit()

    assert "n'est PAS appliquée" in answer
    db.refresh(row)
    assert row.date == date(2026, 8, 10)
    assert db.query(AgentProposal).count() == 1


def _proposal(db, user_id, kind, payload) -> int:
    proposal = AgentProposal(
        user_id=user_id, run_id=None, kind=kind, summary="s", evidence="e", payload=payload)
    db.add(proposal)
    db.commit()
    return proposal.id


def test_approving_a_correction_moves_the_date_and_refingerprints_the_row(client, db):
    headers = _register(client)
    account = client.post("/api/accounts", headers=headers, json={
        "name": "Courant", "kind": "checking"}).json()
    user = _user(db)
    row = _row(db, user.id, account["id"], -1_250)
    before = row.dedup_hash
    proposal_id = _proposal(db, user.id, "correct_transaction",
                            {"transaction_id": row.id, "date": "2026-12-08"})

    response = client.post(f"/api/agent/proposals/{proposal_id}/apply", headers=headers)

    assert response.status_code == 200
    db.expire_all()
    row = db.get(Transaction, row.id)
    assert row.date == date(2026, 12, 8)
    assert row.dedup_hash != before


def test_approving_a_correction_refuses_an_amount_of_zero(client, db):
    headers = _register(client)
    account = client.post("/api/accounts", headers=headers, json={
        "name": "Courant", "kind": "checking"}).json()
    user = _user(db)
    row = _row(db, user.id, account["id"], -1_250)
    proposal_id = _proposal(db, user.id, "correct_transaction",
                            {"transaction_id": row.id, "amount_cents": 0})

    response = client.post(f"/api/agent/proposals/{proposal_id}/apply", headers=headers)

    assert response.status_code == 422


def test_approving_a_transfer_marking_flags_both_legs(client, db):
    headers = _register(client)
    account = client.post("/api/accounts", headers=headers, json={
        "name": "Courant", "kind": "checking"}).json()
    user = _user(db)
    received = _row(db, user.id, account["id"], 40_000, label="RECU")
    sent = _row(db, user.id, account["id"], -40_000, label="EMIS")
    proposal_id = _proposal(db, user.id, "mark_transfer",
                            {"transaction_ids": [received.id, sent.id]})

    body = client.post(f"/api/agent/proposals/{proposal_id}/apply", headers=headers).json()

    assert body["affected"] == 2
    db.expire_all()
    assert db.get(Transaction, received.id).is_transfer is True
    assert db.get(Transaction, sent.id).is_transfer is True


def test_a_transfer_marking_cannot_reach_another_household(client, db):
    headers = _register(client)
    account = client.post("/api/accounts", headers=headers, json={
        "name": "Courant", "kind": "checking"}).json()
    user = _user(db)
    row = _row(db, user.id, account["id"], 40_000)
    other = _register(client, "lea@example.com")
    from app.models import User

    lea = db.query(User).filter(User.email == "lea@example.com").first()
    proposal_id = _proposal(db, lea.id, "mark_transfer", {"transaction_ids": [row.id]})

    response = client.post(f"/api/agent/proposals/{proposal_id}/apply", headers=other)

    assert response.status_code == 404
    db.expire_all()
    assert db.get(Transaction, row.id).is_transfer is False


def test_approving_a_declared_value_sets_it_on_the_envelope(client, db):
    headers = _register(client)
    envelope = client.post("/api/portfolio/accounts", headers=headers,
                           json={"name": "MACIF", "kind": "assurance_vie"}).json()
    user = _user(db)
    proposal_id = _proposal(db, user.id, "declared_value", {
        "investment_account_id": envelope["id"],
        "declared_value_cents": 1_450_000, "declared_value_on": "2026-08-31"})

    response = client.post(f"/api/agent/proposals/{proposal_id}/apply", headers=headers)

    assert response.status_code == 200
    db.expire_all()
    row = db.get(InvestmentAccount, envelope["id"])
    assert row.declared_value_cents == 1_450_000
    assert row.declared_value_on == date(2026, 8, 31)


def test_a_declared_value_in_the_future_is_refused_at_approval(client, db):
    headers = _register(client)
    envelope = client.post("/api/portfolio/accounts", headers=headers,
                           json={"name": "MACIF", "kind": "assurance_vie"}).json()
    user = _user(db)
    proposal_id = _proposal(db, user.id, "declared_value", {
        "investment_account_id": envelope["id"],
        "declared_value_cents": 1_450_000, "declared_value_on": "2999-01-01"})

    response = client.post(f"/api/agent/proposals/{proposal_id}/apply", headers=headers)

    assert response.status_code == 422


def test_approving_an_opening_balance_corrects_the_figure_under_every_solde(client, db):
    headers = _register(client)
    account = client.post("/api/accounts", headers=headers, json={
        "name": "Courant", "kind": "checking", "opening_balance_cents": 5_000_000}).json()
    user = _user(db)
    proposal_id = _proposal(db, user.id, "opening_balance",
                            {"account_id": account["id"], "opening_balance_cents": 0})

    response = client.post(f"/api/agent/proposals/{proposal_id}/apply", headers=headers)

    assert response.status_code == 200
    db.expire_all()
    assert db.get(Account, account["id"]).opening_balance_cents == 0
