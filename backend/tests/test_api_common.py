from datetime import date

from app.api.common import (
    LIQUID_ACCOUNT_KINDS,
    anomaly_points,
    liquid_balance_cents,
    period_range,
    recurrence_points,
    tx_points,
)
from app.models import Account, Category, Transaction, User
from app.security.passwords import hash_password


def _user(db, email: str) -> User:
    user = User(email=email, name="T", password_hash=hash_password("motdepasse123"),
                role="user", is_active=True)
    db.add(user)
    db.flush()
    return user


def _account(db, user: User, kind: str = "checking", opening: int = 0) -> Account:
    account = Account(user_id=user.id, name=kind, kind=kind, currency="EUR",
                      opening_balance_cents=opening, include_in_net_worth=True,
                      archived=False)
    db.add(account)
    db.flush()
    return account


def _tx(db, user, account, on, amount, label="CARTE X1234 CARREFOUR 12/03",
        is_transfer=False, category_id=None):
    row = Transaction(user_id=user.id, account_id=account.id, date=on,
                      amount_cents=amount, label_raw=label, label_clean=label.lower(),
                      category_id=category_id, category_source="uncategorized",
                      is_transfer=is_transfer, dedup_hash=f"{on}{amount}{label}",
                      tags=[])
    db.add(row)
    db.flush()
    return row


def test_recurrence_points_recompute_the_label_key_from_the_raw_label(db):
    """label_clean is whatever was stored -- the verification fixture writes a
    bare lowercase, the importer writes a normalised form. The grouping key is
    recomputed so two rows differing only by an embedded date group together."""
    user = _user(db, "a@example.com")
    account = _account(db, user)
    _tx(db, user, account, date(2025, 1, 10), -1549, "PRELEVEMENT SEPA NETFLIX 10/01")
    _tx(db, user, account, date(2025, 2, 10), -1549, "PRELEVEMENT SEPA NETFLIX 10/02")
    db.commit()

    points = recurrence_points(db, user.id)
    assert len({point.label_key for point in points}) == 1


def test_recurrence_points_exclude_internal_transfers(db):
    user = _user(db, "b@example.com")
    account = _account(db, user)
    _tx(db, user, account, date(2025, 1, 10), -1549, "NETFLIX")
    _tx(db, user, account, date(2025, 1, 11), -50000, "VIREMENT LIVRET", is_transfer=True)
    db.commit()

    assert len(recurrence_points(db, user.id)) == 1


def test_recurrence_points_never_cross_users(db):
    mine = _user(db, "mine@example.com")
    theirs = _user(db, "theirs@example.com")
    _tx(db, mine, _account(db, mine), date(2025, 1, 10), -1549, "NETFLIX")
    _tx(db, theirs, _account(db, theirs), date(2025, 1, 10), -9999, "AUTRE")
    db.commit()

    points = recurrence_points(db, mine.id)
    assert [point.amount_cents for point in points] == [-1549]


def test_anomaly_points_carry_the_transaction_id_and_label(db):
    user = _user(db, "c@example.com")
    account = _account(db, user)
    category = Category(user_id=user.id, name="Courses", slug="courses", kind="expense")
    db.add(category)
    db.flush()
    row = _tx(db, user, account, date(2025, 1, 10), -4200, "LECLERC",
              category_id=category.id)
    db.commit()

    points = anomaly_points(db, user.id)
    assert points[0].id == row.id
    assert points[0].label == "LECLERC"
    assert points[0].category_id == category.id


def test_anomaly_points_never_cross_users(db):
    mine = _user(db, "mine-anomaly@example.com")
    theirs = _user(db, "theirs-anomaly@example.com")
    _tx(db, mine, _account(db, mine), date(2025, 1, 10), -1549, "NETFLIX")
    _tx(db, theirs, _account(db, theirs), date(2025, 1, 10), -9999, "AUTRE")
    db.commit()

    points = anomaly_points(db, mine.id)
    assert [point.amount_cents for point in points] == [-1549]


def test_liquid_balance_sums_opening_balances_and_every_movement(db):
    user = _user(db, "d@example.com")
    account = _account(db, user, "checking", opening=100_000)
    _tx(db, user, account, date(2025, 1, 10), -4200, "LECLERC")
    _tx(db, user, account, date(2025, 1, 20), 250_000, "SALAIRE")
    db.commit()

    assert liquid_balance_cents(db, user.id) == 100_000 - 4_200 + 250_000


def test_liquid_balance_ignores_illiquid_and_archived_accounts(db):
    user = _user(db, "e@example.com")
    _account(db, user, "checking", opening=100_000)
    pea = _account(db, user, "pea", opening=900_000)
    assert pea.kind not in LIQUID_ACCOUNT_KINDS
    archived = _account(db, user, "savings", opening=700_000)
    archived.archived = True
    db.commit()

    assert liquid_balance_cents(db, user.id) == 100_000


def test_liquid_balance_never_crosses_users(db):
    mine = _user(db, "mine-liquid@example.com")
    theirs = _user(db, "theirs-liquid@example.com")
    _account(db, mine, "checking", opening=100_000)
    _account(db, theirs, "checking", opening=900_000)
    db.commit()

    assert liquid_balance_cents(db, mine.id) == 100_000


def test_liquid_balance_is_zero_for_a_user_with_no_liquid_accounts_at_all(db):
    user = _user(db, "no-accounts@example.com")
    db.commit()

    assert liquid_balance_cents(db, user.id) == 0


def test_period_range_still_answers_an_absent_bound_with_the_whole_history(db):
    user = _user(db, "f@example.com")
    account = _account(db, user)
    _tx(db, user, account, date(2025, 1, 24), -1000, "A")
    _tx(db, user, account, date(2026, 1, 9), -1000, "B")
    db.commit()

    start, end, history = period_range(db, user.id, None, None)
    assert (start, end) == (date(2025, 1, 24), date(2026, 1, 9))
    assert history is not None and history.transaction_count == 2


def test_period_range_never_widens_with_another_users_older_history(db):
    """An absent bound resolves to this user's own history -- another user's
    older transaction must not push the default start further back."""
    mine = _user(db, "mine-period@example.com")
    theirs = _user(db, "theirs-period@example.com")
    _tx(db, mine, _account(db, mine), date(2025, 6, 1), -1000, "A")
    _tx(db, theirs, _account(db, theirs), date(2020, 1, 1), -1000, "OLDER")
    db.commit()

    start, end, history = period_range(db, mine.id, None, None)
    assert (start, end) == (date(2025, 6, 1), date(2025, 6, 1))
    assert history is not None and history.transaction_count == 1


def test_tx_points_are_the_engine_shape_not_orm_rows(db):
    user = _user(db, "g@example.com")
    account = _account(db, user)
    _tx(db, user, account, date(2025, 1, 24), -1000, "A")
    db.commit()

    points = tx_points(db, user.id, date(2025, 1, 1), date(2025, 12, 31))
    assert [type(point).__name__ for point in points] == ["TxPoint"]


def test_tx_points_never_cross_users(db):
    mine = _user(db, "mine-tx@example.com")
    theirs = _user(db, "theirs-tx@example.com")
    _tx(db, mine, _account(db, mine), date(2025, 1, 10), -1549, "NETFLIX")
    _tx(db, theirs, _account(db, theirs), date(2025, 1, 10), -9999, "AUTRE")
    db.commit()

    points = tx_points(db, mine.id, None, None)
    assert [point.amount_cents for point in points] == [-1549]
