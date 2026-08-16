from app.importers.dialect import CsvDialect
from app.importers.mapping import suggest_mapping, validate_mapping
from app.importers.parser import parse_rows


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


# A header alone cannot tell a two-column débit/crédit export from a single
# column of signed amounts -- both are commonly headed "Débit". Only the values
# can, so `suggest_mapping` is given the sample rows the parser already read.


def test_single_signed_column_is_proposed_as_amount_not_debit():
    mapping = suggest_mapping(
        ["Date", "Libellé", "Débit/Crédit"],
        rows=[
            ["01/03/2025", "CARREFOUR MARKET", "-47,32"],
            ["03/03/2025", "VIR SALAIRE ACME SAS", "2450,00"],
        ],
    )
    assert mapping == {0: "date", 1: "label", 2: "amount"}


def test_a_signed_column_headed_debit_is_proposed_as_amount():
    mapping = suggest_mapping(
        ["Date", "Libellé", "Débit"],
        rows=[
            ["01/03/2025", "CARREFOUR MARKET", "-47,32"],
            ["03/03/2025", "VIR SALAIRE ACME SAS", "2450,00"],
        ],
    )
    assert mapping == {0: "date", 1: "label", 2: "amount"}


def test_two_column_debit_credit_export_still_proposes_both():
    mapping = suggest_mapping(
        ["Date", "Libellé", "Débit euros", "Crédit euros"],
        rows=[
            ["01/03/2025", "CARREFOUR MARKET", "47,32", ""],
            ["03/03/2025", "VIR SALAIRE ACME SAS", "", "2450,00"],
        ],
    )
    assert mapping == {0: "date", 1: "label", 2: "debit", 3: "credit"}


def test_a_column_of_only_negative_values_stays_debit():
    """Only-negative is ambiguous: plenty of banks sign their débit column and
    still ship a separate crédit one. Never guessed into a signed amount."""
    mapping = suggest_mapping(
        ["Date", "Libellé", "Débit", "Crédit"],
        rows=[
            ["01/03/2025", "CARREFOUR MARKET", "-47,32", ""],
            ["02/03/2025", "PRLV NETFLIX.COM", "-13,49", ""],
        ],
    )
    assert mapping == {0: "date", 1: "label", 2: "debit", 3: "credit"}


def test_a_debit_column_holding_one_reversal_stays_debit_and_keeps_its_rows_negative():
    """One negative row does not turn a two-column export into a signed one.

    A reversal (an *extourne*, a corrected fee) is a normal line on a real
    statement, and it makes the Débit column carry both signs while the Crédit
    column beside it is still the other half of the same ledger. Promoting the
    Débit column to `amount` there flips every expense in the file into income,
    and the resulting mapping passes validation, so the wizard renders a clean,
    committable preview of exactly the wrong thing.

    Asserted on the resolved cents, not just on the proposed role: the role is
    the cause, the cents are the damage.
    """
    headers = ["Date", "Libellé", "Débit", "Crédit"]
    rows = [
        ["01/03/2025", "CARREFOUR MARKET", "47,32", ""],
        ["02/03/2025", "PRLV NETFLIX", "13,49", ""],
        ["04/03/2025", "EXTOURNE FRAIS", "-4,90", ""],
        ["05/03/2025", "VIR SALAIRE", "", "2450,00"],
    ]

    mapping = suggest_mapping(headers, rows=rows)

    parsed = parse_rows(rows, mapping, CsvDialect())
    assert [(row.label_raw, row.amount_cents) for row in parsed] == [
        ("CARREFOUR MARKET", -4732),
        ("PRLV NETFLIX", -1349),
        ("EXTOURNE FRAIS", -490),
        ("VIR SALAIRE", 245000),
    ]
    assert mapping == {0: "date", 1: "label", 2: "debit", 3: "credit"}


def test_a_credit_column_holding_one_reversal_stays_credit():
    """The mirror case: the sign mix lands in the Crédit column instead."""
    mapping = suggest_mapping(
        ["Date", "Libellé", "Débit", "Crédit"],
        rows=[
            ["01/03/2025", "CARREFOUR MARKET", "47,32", ""],
            ["05/03/2025", "VIR SALAIRE", "", "2450,00"],
            ["06/03/2025", "ANNULATION VIREMENT", "", "-120,00"],
        ],
    )
    assert mapping == {0: "date", 1: "label", 2: "debit", 3: "credit"}


def test_a_dot_decimal_signed_column_is_read_with_the_dialect_separator():
    mapping = suggest_mapping(
        ["Date", "Label", "Debit"],
        rows=[["2025-03-01", "TESCO", "-47.32"], ["2025-03-02", "PAYROLL", "2450.00"]],
        decimal_separator=".",
    )
    assert mapping[2] == "amount"


def test_a_non_numeric_column_headed_debit_is_never_reinterpreted():
    mapping = suggest_mapping(
        ["Date", "Libellé", "Débit"],
        rows=[["01/03/2025", "A", "oui"], ["02/03/2025", "B", "non"]],
    )
    assert mapping[2] == "debit"


def test_a_row_shorter_than_the_header_never_stops_the_scan():
    """Ragged exports exist; a truncated line is skipped, not treated as evidence."""
    mapping = suggest_mapping(
        ["Date", "Libellé", "Débit"],
        rows=[
            ["01/03/2025", "CARREFOUR MARKET", "-47,32"],
            ["02/03/2025"],
            ["03/03/2025", "VIR SALAIRE ACME SAS", "2450,00"],
        ],
    )
    assert mapping[2] == "amount"


def test_without_rows_the_header_proposal_is_unchanged():
    assert suggest_mapping(["Date", "Libellé", "Débit", "Crédit"]) == {
        0: "date", 1: "label", 2: "debit", 3: "credit",
    }


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
