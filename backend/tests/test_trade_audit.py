"""The append-only journal, and what the hash chain actually proves."""

from app.models import TradeAuditEvent, User
from app.security.passwords import hash_password
from app.trading import audit


def make_user(db) -> User:
    user = User(email="max@example.com", name="Max", password_hash=hash_password("motdepasse123"))
    db.add(user)
    db.commit()
    return user


def test_an_empty_chain_says_so_rather_than_claiming_to_be_intact_silently(db):
    user = make_user(db)
    report = audit.verify_chain(db, user)
    assert report.intact is True
    assert report.events == 0
    assert "vide" in report.message


def test_appending_chains_each_entry_onto_the_last(db):
    user = make_user(db)
    first = audit.append(db, user, kind="armed", payload={"minutes": 30}, actor="session")
    second = audit.append(db, user, kind="halted", payload={"why": "test"}, actor="agent")
    db.commit()
    assert first.sequence == 1
    assert first.previous_hash == audit.GENESIS
    assert second.sequence == 2
    assert second.previous_hash == first.entry_hash
    assert audit.verify_chain(db, user).intact is True


def test_editing_a_payload_after_the_fact_is_visible(db):
    user = make_user(db)
    audit.append(db, user, kind="armed", payload={"minutes": 30}, actor="session")
    audit.append(db, user, kind="order_sent", payload={"symbol": "AAPL"}, actor="system")
    audit.append(db, user, kind="order_filled", payload={"symbol": "AAPL"}, actor="system")
    db.commit()

    tampered = db.query(TradeAuditEvent).filter(TradeAuditEvent.sequence == 2).one()
    tampered.payload = {"symbol": "TSLA"}
    db.commit()

    report = audit.verify_chain(db, user)
    assert report.intact is False
    assert report.broken_at == 2
    assert "modifié" in report.message


def test_deleting_an_entry_is_visible_as_a_gap(db):
    user = make_user(db)
    for index in range(3):
        audit.append(db, user, kind="decision", payload={"n": index}, actor="system")
    db.commit()
    db.query(TradeAuditEvent).filter(TradeAuditEvent.sequence == 2).delete()
    db.commit()

    report = audit.verify_chain(db, user)
    assert report.intact is False
    assert report.broken_at == 3


def test_one_users_chain_is_independent_of_anothers(db):
    first = make_user(db)
    second = User(email="autre@example.com", name="Autre",
                  password_hash=hash_password("motdepasse123"))
    db.add(second)
    db.commit()

    audit.append(db, first, kind="armed", payload={}, actor="session")
    event = audit.append(db, second, kind="armed", payload={}, actor="session")
    db.commit()
    assert event.sequence == 1
    assert event.previous_hash == audit.GENESIS


def test_canonical_json_is_stable_across_key_order():
    assert audit.canonical_json({"b": 1, "a": 2}) == audit.canonical_json({"a": 2, "b": 1})


def test_canonical_json_keeps_french_readable_rather_than_escaping_it():
    assert "écart" in audit.canonical_json({"raison": "un écart"})


def test_the_inputs_digest_changes_when_a_stored_indicator_changes():
    questions = [{"key": "direction", "options": ["acheter"]}]
    first = audit.inputs_digest({"rsi_bps": 5_000}, questions)
    second = audit.inputs_digest({"rsi_bps": 5_001}, questions)
    assert first != second


def test_the_inputs_digest_changes_when_the_question_changes():
    features = {"rsi_bps": 5_000}
    first = audit.inputs_digest(features, [{"key": "direction", "options": ["acheter"]}])
    second = audit.inputs_digest(features, [{"key": "direction", "options": ["vendre"]}])
    assert first != second
