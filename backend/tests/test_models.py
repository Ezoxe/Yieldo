from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Account, Category, Debt, Goal, Scenario, Transaction, User


def test_user_email_is_unique_case_insensitively(db):
    db.add(User(email="max@example.com", name="Max", password_hash="x"))
    db.commit()
    db.add(User(email="MAX@EXAMPLE.COM", name="Autre", password_hash="y"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_user_defaults_to_non_admin_active(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()
    assert user.role == "user"
    assert user.is_active is True
    assert user.created_at is not None


def test_account_belongs_to_user_and_defaults_to_euro(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()
    account = Account(user_id=user.id, name="Compte courant", kind="checking")
    db.add(account)
    db.commit()
    assert account.currency == "EUR"
    assert account.opening_balance_cents == 0
    assert account.include_in_net_worth is True


def test_category_supports_two_level_hierarchy(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()
    parent = Category(user_id=user.id, name="Logement", slug="logement", kind="expense")
    db.add(parent)
    db.commit()
    child = Category(user_id=user.id, parent_id=parent.id, name="Loyer",
                     slug="logement-loyer", kind="expense")
    db.add(child)
    db.commit()
    db.refresh(parent)
    assert [c.name for c in parent.children] == ["Loyer"]
    assert child.parent.name == "Logement"


def test_category_slug_is_unique_per_user_not_globally(db):
    first = User(email="a@b.c", name="A", password_hash="x")
    second = User(email="d@e.f", name="B", password_hash="y")
    db.add_all([first, second])
    db.commit()
    db.add(Category(user_id=first.id, name="Loyer", slug="loyer", kind="expense"))
    db.add(Category(user_id=second.id, name="Loyer", slug="loyer", kind="expense"))
    db.commit()  # must not raise — slugs are scoped to a user


def test_account_transactions_relationship_is_bidirectional(db):
    """Guards against a regression of the Account.transactions relationship.

    Task 4 originally omitted this relationship because Transaction did not exist
    yet — a string-based relationship to an undefined class breaks configure_mappers()
    for every test. Task 6 restored it; this test ensures it cannot silently disappear
    again.
    """
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()
    account = Account(user_id=user.id, name="Courant", kind="checking")
    db.add(account)
    db.commit()
    transaction = Transaction(user_id=user.id, account_id=account.id, date=date(2025, 1, 1),
                              amount_cents=-100, label_raw="X", label_clean="x",
                              dedup_hash="abc")
    db.add(transaction)
    db.commit()
    db.refresh(account)
    assert account.transactions == [transaction]
    assert transaction.account is account


def _user(db) -> User:
    user = User(email="dettes@example.com", name="Max", password_hash="x")
    db.add(user)
    db.commit()
    return user


def test_a_debt_stores_its_outstanding_capital_as_a_positive_magnitude(db):
    """The one deliberate exception to the negative-outflow convention in this
    codebase. A debt's `principal_cents` is "capital restant dû" (design §4.1):
    an amount owed, quoted positive, the way a bank statement quotes it. The
    payoff engine's arithmetic depends on it and says so."""
    user = _user(db)
    debt = Debt(user_id=user.id, name="Crédit auto", kind="auto",
                principal_cents=850_000, annual_rate_bps=490,
                minimum_payment_cents=21_500, term_months=48)
    db.add(debt)
    db.commit()
    assert debt.id is not None
    assert debt.principal_cents > 0
    assert debt.archived is False


def test_a_goal_defaults_to_nothing_saved_and_the_lowest_urgency(db):
    user = _user(db)
    goal = Goal(user_id=user.id, name="Fonds d'urgence", target_cents=600_000)
    db.add(goal)
    db.commit()
    assert goal.saved_cents == 0
    assert goal.priority == 100
    assert goal.due_on is None
    assert goal.archived is False


def test_a_scenario_stores_its_inputs_as_json_and_is_timestamped(db):
    """The request, never the computed figures -- see the model's docstring."""
    user = _user(db)
    scenario = Scenario(user_id=user.id, name="Voiture 2027", kind="feasibility",
                        payload='{"target_cents": 4000000, "horizon_months": 12}')
    db.add(scenario)
    db.commit()
    assert scenario.created_at is not None
    assert '"target_cents": 4000000' in scenario.payload


def test_deleting_a_user_takes_their_debts_goals_and_scenarios_with_them(db):
    user = _user(db)
    db.add_all([
        Debt(user_id=user.id, name="A", kind="consumer", principal_cents=1,
             annual_rate_bps=0, minimum_payment_cents=1),
        Goal(user_id=user.id, name="B", target_cents=1),
        Scenario(user_id=user.id, name="C", kind="feasibility", payload="{}"),
    ])
    db.commit()
    db.delete(user)
    db.commit()
    assert db.query(Debt).count() == 0
    assert db.query(Goal).count() == 0
    assert db.query(Scenario).count() == 0


def test_a_goal_due_date_is_a_real_date_not_a_string(db):
    user = _user(db)
    goal = Goal(user_id=user.id, name="Voyage", target_cents=300_000,
                due_on=date(2027, 6, 30), priority=1)
    db.add(goal)
    db.commit()
    db.refresh(goal)
    assert goal.due_on == date(2027, 6, 30)
