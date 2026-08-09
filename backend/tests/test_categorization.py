import pytest

from app.categorization.engine import classify, compile_rules
from app.categorization.seed import seed_categories, seed_rules
from app.models import CategoryRule, User


@pytest.fixture
def user_with_categories(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()
    categories = seed_categories(db, user.id)
    return user, categories


def test_seed_rules_are_idempotent(db, user_with_categories):
    user, categories = user_with_categories
    first = seed_rules(db, user.id, categories)
    assert first > 0
    assert seed_rules(db, user.id, categories) == 0


def test_builtin_rules_classify_common_french_merchants(db, user_with_categories):
    user, categories = user_with_categories
    seed_rules(db, user.id, categories)
    compiled = compile_rules(db.query(CategoryRule).filter(
        CategoryRule.user_id == user.id).all())

    cases = {
        "carrefour market": "alimentation-courses",
        "leclerc drive": "alimentation-courses",
        "netflix com": "abonnements-streaming",
        "totalenergies access": "transport-carburant",
        "sncf connect": "transport-voyage",
        "pharmacie du centre": "sante-pharmacie",
        "edf clients": "logement-energie",
        "free mobile": "logement-internet",
        "vir salaire acme sas": "revenus-salaire",
    }
    for label, expected_slug in cases.items():
        # Income rules only match a credit (see test_income_rules_only_match_positive_amounts):
        # "vir salaire acme sas" needs a positive amount to hit its "credit"-direction rule.
        amount_cents = 1000 if expected_slug.startswith("revenus") else -1000
        match = classify(label, amount_cents, compiled)
        assert match is not None, f"aucune règle pour {label!r}"
        assert match.category_id == categories[expected_slug].id, label


def test_unknown_label_returns_no_match(db, user_with_categories):
    user, categories = user_with_categories
    seed_rules(db, user.id, categories)
    compiled = compile_rules(db.query(CategoryRule).filter(
        CategoryRule.user_id == user.id).all())
    assert classify("zzz commerce inconnu 4711", -500, compiled) is None


def test_longer_pattern_wins_at_equal_priority(db, user_with_categories):
    user, categories = user_with_categories
    db.add_all([
        CategoryRule(user_id=user.id, pattern="carrefour",
                     category_id=categories["alimentation-courses"].id,
                     priority=100, origin="builtin"),
        CategoryRule(user_id=user.id, pattern="carrefour station",
                     category_id=categories["transport-carburant"].id,
                     priority=100, origin="builtin"),
    ])
    db.commit()
    compiled = compile_rules(db.query(CategoryRule).filter(
        CategoryRule.user_id == user.id).all())
    match = classify("carrefour station service", -6000, compiled)
    assert match.category_id == categories["transport-carburant"].id


def test_manual_rule_beats_builtin_rule(db, user_with_categories):
    user, categories = user_with_categories
    seed_rules(db, user.id, categories)
    db.add(CategoryRule(user_id=user.id, pattern="carrefour",
                        category_id=categories["achats-maison"].id,
                        priority=300, origin="manual"))
    db.commit()
    compiled = compile_rules(db.query(CategoryRule).filter(
        CategoryRule.user_id == user.id).all())
    match = classify("carrefour market", -4732, compiled)
    assert match.category_id == categories["achats-maison"].id
    assert match.source == "manual"


def test_regex_rule_is_supported(db, user_with_categories):
    user, categories = user_with_categories
    db.add(CategoryRule(user_id=user.id, pattern=r"^vir\s+.*salaire",
                        is_regex=True,
                        category_id=categories["revenus-salaire"].id,
                        priority=200, origin="learned"))
    db.commit()
    compiled = compile_rules(db.query(CategoryRule).filter(
        CategoryRule.user_id == user.id).all())
    assert classify("vir de acme salaire mars", 245000, compiled) is not None
    assert classify("prelevement salaire urssaf", -1000, compiled) is None


def test_invalid_regex_is_skipped_not_fatal(db, user_with_categories):
    user, categories = user_with_categories
    db.add(CategoryRule(user_id=user.id, pattern="[unclosed", is_regex=True,
                        category_id=categories["divers"].id,
                        priority=200, origin="learned"))
    db.commit()
    compiled = compile_rules(db.query(CategoryRule).filter(
        CategoryRule.user_id == user.id).all())
    assert compiled == []


def test_income_rules_only_match_positive_amounts(db, user_with_categories):
    user, categories = user_with_categories
    seed_rules(db, user.id, categories)
    compiled = compile_rules(db.query(CategoryRule).filter(
        CategoryRule.user_id == user.id).all())
    assert classify("vir salaire acme sas", 245000, compiled) is not None
    # A debit that happens to contain "salaire" must not be booked as income.
    assert classify("vir salaire acme sas", -245000, compiled) is None
