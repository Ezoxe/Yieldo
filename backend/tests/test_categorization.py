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


def test_a_bakery_is_not_booked_as_the_boulanger_electronics_chain(db, user_with_categories):
    # "boulanger" is the electronics retailer, and also the first nine letters of
    # "boulangerie": matched as a fragment, every loaf of bread was booked as
    # « Équipement et high-tech ». The retailer is a whole word; a bakery is food.
    user, categories = user_with_categories
    seed_rules(db, user.id, categories)
    compiled = compile_rules(db.query(CategoryRule).filter(
        CategoryRule.user_id == user.id).all())

    bakeries = ("cb boulangerie paul", "boulangerie patisserie du marche", "cb patisserie dupont")
    for label in bakeries:
        bakery = classify(label, -480, compiled)
        assert bakery is not None, label
        assert bakery.category_id == categories["alimentation-courses"].id, label

    for label in ("cb boulanger lille", "boulanger"):
        retailer = classify(label, -54900, compiled)
        assert retailer is not None, label
        assert retailer.category_id == categories["achats-equipement"].id, label


LIBRARY_CASES: list[tuple[str, int, str | None]] = [
    # A brand that is also the start or the middle of a common word is read as
    # a whole word: the word no longer files the line, the brand still does.
    ("cb decoration shop", -2500, None),
    ("cb cora mondeville", -4500, "alimentation-courses"),
    ("pressing nettoyage", -1800, None),
    ("cb netto", -2300, "alimentation-courses"),
    ("cb spartoo", -6000, None),
    ("cb spar", -1200, "alimentation-courses"),
    ("cb matcha bar", -650, None),
    ("supermarche match", -3100, "alimentation-courses"),
    ("cb espresso bar", -420, None),
    ("esso express", -6000, "transport-carburant"),
    ("cb aviation club", -3800, None),
    ("station avia", -5500, "transport-carburant"),
    ("cb shellfish bar", -2900, None),
    ("shell autoroute", -7000, "transport-carburant"),
    ("cotisation syndicat cfdt", -1500, None),
    ("foncia syndic", -31000, "logement-charges"),
    ("cb orangerie cafe", -1200, None),
    ("prlv orange sa", -3999, "logement-internet"),
    ("travaux canalisation", -24000, None),
    ("canal plus", -2499, "abonnements-streaming"),
    ("cb smith market", -1500, None),
    ("cb h m paris", -3500, "achats-vetements"),
    ("cb salon air", -900, None),
    ("on air fitness", -2990, "abonnements-salle"),
    ("vir paiement lydia", 2500, None),
    ("vir paie octobre", 245000, "revenus-salaire"),
    ("vir amelie dupont", 5000, None),
    ("vir ameli remboursement", 2380, "revenus-remboursements"),
    ("vir securitas", 180000, None),
    ("vir secu sociale", 1500, "revenus-remboursements"),
    ("vir caf apl", 21000, "revenus-allocations"),
    # Water is the house's charges, not its energy.
    ("prlv veolia eau", -9500, "logement-charges"),
    ("prlv suez eau france", -8200, "logement-charges"),
    ("prlv saur", -7600, "logement-charges"),
    ("prlv eau de paris", -6100, "logement-charges"),
    # The Freebox's own label.
    ("prlv sepa free telecom", -2999, "logement-internet"),
    # A marketplace sells everything: Achats, never a guessed Cadeaux.
    ("cb amazon eu", -3000, "achats"),
    ("cb aliexpress", -1500, "achats"),
    ("cb temu", -900, "achats"),
    ("cb etsy", -2500, "achats-cadeaux"),
    # A mutual insurer's car policy is the car's, its home policy the house's.
    ("prlv macif auto", -5200, "transport-assurance"),
    ("prlv maif auto", -4800, "transport-assurance"),
    ("prlv macif habitation", -2800, "logement-assurance"),
]


def test_the_builtin_library_reads_brands_as_words_and_files_them_where_they_belong(
    db, user_with_categories,
):
    user, categories = user_with_categories
    seed_rules(db, user.id, categories)
    compiled = compile_rules(db.query(CategoryRule).filter(
        CategoryRule.user_id == user.id).all())

    for label, amount_cents, expected in LIBRARY_CASES:
        match = classify(label, amount_cents, compiled)
        if expected is None:
            assert match is None, f"{label!r} should be left unfiled"
        else:
            assert match is not None, f"no rule for {label!r}"
            assert match.category_id == categories[expected].id, label


def test_totalenergies_gas_bill_is_not_booked_as_fuel(db, user_with_categories):
    # normalize_label never inserts separators, so the brand always arrives as the
    # single token "totalenergies" -- a pattern written "total energies gaz" can
    # never match, and a home gas bill falls through to the fuel rule instead.
    user, categories = user_with_categories
    seed_rules(db, user.id, categories)
    compiled = compile_rules(db.query(CategoryRule).filter(
        CategoryRule.user_id == user.id).all())

    gas_match = classify("totalenergies gaz prlv", -8500, compiled)
    assert gas_match is not None
    assert gas_match.category_id == categories["logement-energie"].id

    fuel_match = classify("totalenergies access", -6810, compiled)
    assert fuel_match is not None
    assert fuel_match.category_id == categories["transport-carburant"].id
