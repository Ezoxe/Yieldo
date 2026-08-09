from app.importers.mapping import suggest_mapping, validate_mapping


def test_suggests_roles_for_french_bank_headers():
    mapping = suggest_mapping(["dateOp", "dateVal", "label", "category", "amount"])
    assert mapping == {0: "date", 1: "value_date", 2: "label", 3: "category", 4: "amount"}


def test_suggests_debit_and_credit_columns():
    mapping = suggest_mapping(["Date", "Libellé", "Débit euros", "Crédit euros"])
    assert mapping == {0: "date", 1: "label", 2: "debit", 3: "credit"}


def test_suggests_roles_for_english_headers():
    mapping = suggest_mapping(["date", "description", "amount"])
    assert mapping == {0: "date", 1: "label", 2: "amount"}


def test_unknown_headers_default_to_ignore():
    assert suggest_mapping(["date", "colonne mystère"])[1] == "ignore"


def test_booking_date_is_not_confused_with_value_date():
    mapping = suggest_mapping(
        ["Date de comptabilisation", "Date de valeur", "Libellé", "Montant"]
    )
    assert mapping == {0: "date", 1: "value_date", 2: "label", 3: "amount"}


def test_booking_date_is_not_confused_with_value_date_when_order_is_reversed():
    mapping = suggest_mapping(
        ["Date de valeur", "Date de comptabilisation", "Libellé", "Montant"]
    )
    assert mapping == {0: "value_date", 1: "date", 2: "label", 3: "amount"}


def test_validation_accepts_date_label_amount():
    assert validate_mapping({0: "date", 1: "label", 2: "amount"}, 3) == []


def test_validation_accepts_debit_credit_instead_of_amount():
    assert validate_mapping({0: "date", 1: "label", 2: "debit", 3: "credit"}, 4) == []


def test_validation_requires_a_date_column():
    errors = validate_mapping({0: "label", 1: "amount"}, 2)
    assert any("date" in e.lower() for e in errors)


def test_validation_requires_a_label_column():
    errors = validate_mapping({0: "date", 1: "amount"}, 2)
    assert any("libellé" in e.lower() for e in errors)


def test_validation_requires_an_amount_or_a_debit_credit_pair():
    errors = validate_mapping({0: "date", 1: "label"}, 2)
    assert any("montant" in e.lower() for e in errors)


def test_validation_rejects_duplicated_single_use_roles():
    errors = validate_mapping({0: "date", 1: "date", 2: "label", 3: "amount"}, 4)
    assert any("plusieurs fois" in e.lower() for e in errors)


def test_validation_rejects_out_of_range_column_index():
    assert validate_mapping({0: "date", 9: "label"}, 3) != []
