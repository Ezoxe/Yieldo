from datetime import date

import pytest

from app.categorization.engine import classify, compile_rules
from app.categorization.learning import apply_learned_rule, extract_pattern, learn_from_correction
from app.categorization.seed import seed_categories
from app.models import Account, CategoryRule, Transaction, User


@pytest.fixture
def fixture_user(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()
    categories = seed_categories(db, user.id)
    account = Account(user_id=user.id, name="Courant", kind="checking")
    db.add(account)
    db.commit()
    return user, account, categories


def _transaction(db, user, account, label_clean: str, cents: int = -1000) -> Transaction:
    transaction = Transaction(
        user_id=user.id, account_id=account.id, date=date(2025, 3, 1),
        amount_cents=cents, label_raw=label_clean.upper(), label_clean=label_clean,
        dedup_hash=f"h-{label_clean}-{cents}",
    )
    db.add(transaction)
    db.commit()
    return transaction


def test_extract_pattern_keeps_the_merchant_core():
    assert extract_pattern("boulangerie du coin") == "boulangerie du coin"
    assert extract_pattern("cb boulangerie marie") == "boulangerie marie"


def test_extract_pattern_drops_generic_payment_words():
    assert extract_pattern("paiement cb prelevement") is None
    assert extract_pattern("vir") is None


def test_extract_pattern_rejects_too_short_a_core():
    assert extract_pattern("ab") is None


def test_extract_pattern_caps_length_to_stay_specific_but_reusable():
    pattern = extract_pattern("cb societe generale de distribution alimentaire du nord est")
    assert pattern is not None
    assert len(pattern.split()) <= 4


def test_learning_creates_a_rule_with_learned_priority(db, fixture_user):
    user, account, categories = fixture_user
    transaction = _transaction(db, user, account, "boulangerie du coin")
    rule = learn_from_correction(db, user.id, transaction,
                                 categories["alimentation-courses"].id)
    assert rule is not None
    assert rule.origin == "learned"
    assert rule.priority == 200
    assert rule.direction == "debit"


def test_learning_twice_reinforces_instead_of_duplicating(db, fixture_user):
    user, account, categories = fixture_user
    first = _transaction(db, user, account, "boulangerie du coin")
    second = _transaction(db, user, account, "boulangerie du coin", cents=-1200)
    learn_from_correction(db, user.id, first, categories["alimentation-courses"].id)
    learn_from_correction(db, user.id, second, categories["alimentation-courses"].id)
    rules = db.query(CategoryRule).filter(CategoryRule.origin == "learned").all()
    assert len(rules) == 1
    assert rules[0].hit_count == 2


def test_correcting_to_a_different_category_repoints_the_rule(db, fixture_user):
    user, account, categories = fixture_user
    transaction = _transaction(db, user, account, "boulangerie du coin")
    learn_from_correction(db, user.id, transaction, categories["alimentation-courses"].id)
    learn_from_correction(db, user.id, transaction, categories["alimentation-restaurant"].id)
    rules = db.query(CategoryRule).filter(CategoryRule.origin == "learned").all()
    assert len(rules) == 1
    assert rules[0].category_id == categories["alimentation-restaurant"].id


def test_learning_returns_none_when_no_usable_pattern(db, fixture_user):
    user, account, categories = fixture_user
    transaction = _transaction(db, user, account, "cb")
    assert learn_from_correction(db, user.id, transaction, categories["divers"].id) is None


def test_apply_learned_rule_updates_only_uncategorized_by_default(db, fixture_user):
    user, account, categories = fixture_user
    untouched = _transaction(db, user, account, "boulangerie du coin", cents=-500)
    untouched.category_id = categories["divers"].id
    untouched.category_source = "manual"
    pending = _transaction(db, user, account, "boulangerie du coin", cents=-900)
    db.commit()

    source = _transaction(db, user, account, "boulangerie du coin", cents=-1000)
    rule = learn_from_correction(db, user.id, source, categories["alimentation-courses"].id)
    updated = apply_learned_rule(db, user.id, rule, only_uncategorized=True)

    db.refresh(untouched)
    db.refresh(pending)
    assert updated >= 1
    assert untouched.category_id == categories["divers"].id
    assert pending.category_id == categories["alimentation-courses"].id
    assert pending.category_source == "learned"


@pytest.mark.parametrize("label", [
    "restaurant de la gare",
    "boucherie des halles",
    "cafe le select",
    "pizzeria chez mario",
])
def test_extract_pattern_never_drops_an_interior_word(label):
    # compile_rules matches a literal pattern with re.escape + search: a contiguous
    # substring match. Each of these labels has a stopword sandwiched between two
    # merchant words ("de", "des", "le", "chez"). If extract_pattern ever stripped
    # an interior word instead of only trimming the edges, the resulting pattern
    # would be a subsequence, not a substring, of the label -- and could never match
    # it again, not even the transaction it was learned from.
    pattern = extract_pattern(label)
    assert pattern is not None
    assert pattern in label


def test_learned_rule_can_reidentify_its_own_source_transaction(db, fixture_user):
    user, account, categories = fixture_user
    label = "restaurant de la gare"
    transaction = _transaction(db, user, account, label, cents=-2500)

    rule = learn_from_correction(db, user.id, transaction,
                                 categories["alimentation-restaurant"].id)
    assert rule is not None

    compiled = compile_rules([rule])
    match = classify(label, transaction.amount_cents, compiled)
    assert match is not None
    assert match.category_id == categories["alimentation-restaurant"].id
