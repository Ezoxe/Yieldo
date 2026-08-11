from datetime import date

from app.importers.dialect import CsvDialect
from app.importers.parser import parse_rows


def _dialect(**overrides) -> CsvDialect:
    return CsvDialect(delimiter=";", decimal_separator=",",
                      date_format="%d/%m/%Y", **overrides)


def test_parses_single_signed_amount_column():
    rows = [["01/03/2025", "CARREFOUR MARKET", "-47,32"]]
    mapping = {0: "date", 1: "label", 2: "amount"}
    candidates = parse_rows(rows, mapping, _dialect())
    assert candidates[0].date == date(2025, 3, 1)
    assert candidates[0].amount_cents == -4732
    assert candidates[0].label_raw == "CARREFOUR MARKET"
    assert candidates[0].label_clean == "carrefour market"
    assert candidates[0].error is None


def test_debit_column_yields_a_negative_amount():
    rows = [["01/03/2025", "PEAGE VINCI", "12,40", ""]]
    mapping = {0: "date", 1: "label", 2: "debit", 3: "credit"}
    assert parse_rows(rows, mapping, _dialect())[0].amount_cents == -1240


def test_credit_column_yields_a_positive_amount():
    rows = [["03/03/2025", "VIREMENT SALAIRE", "", "2450,00"]]
    mapping = {0: "date", 1: "label", 2: "debit", 3: "credit"}
    assert parse_rows(rows, mapping, _dialect())[0].amount_cents == 245000


def test_debit_already_signed_is_not_double_negated():
    rows = [["01/03/2025", "ACHAT", "-12,40", ""]]
    mapping = {0: "date", 1: "label", 2: "debit", 3: "credit"}
    assert parse_rows(rows, mapping, _dialect())[0].amount_cents == -1240


def test_row_with_both_debit_and_credit_empty_is_flagged():
    rows = [["01/03/2025", "LIGNE VIDE", "", ""]]
    mapping = {0: "date", 1: "label", 2: "debit", 3: "credit"}
    candidate = parse_rows(rows, mapping, _dialect())[0]
    assert candidate.error is not None
    assert "montant" in candidate.error.lower()


def test_row_with_both_debit_and_credit_populated_is_flagged_as_ambiguous():
    # Real French bank exports sometimes carry both on refund/reversal rows. Rather
    # than guess which column was meant (the old behaviour silently kept the debit
    # and dropped the credit), this is treated as an unreadable row so the user sees
    # it in the preview's failed list and can fix their column mapping.
    rows = [
        ["01/03/2025", "REMBOURSEMENT", "12,40", "45,00"],
        ["02/03/2025", "VIREMENT", "", "20,00"],
    ]
    mapping = {0: "date", 1: "label", 2: "debit", 3: "credit"}
    candidates = parse_rows(rows, mapping, _dialect())
    assert candidates[0].error is not None
    assert "débit" in candidates[0].error.lower()
    assert "crédit" in candidates[0].error.lower()
    # The batch continues past the ambiguous row instead of aborting.
    assert candidates[1].error is None
    assert candidates[1].amount_cents == 2000


def test_zero_in_one_column_does_not_count_as_populated():
    # "0,00" in the unused column is a formatting placeholder, not a real value: it
    # should not trigger the both-populated ambiguity error above.
    rows = [["01/03/2025", "REMBOURSEMENT", "0,00", "45,00"]]
    mapping = {0: "date", 1: "label", 2: "debit", 3: "credit"}
    candidate = parse_rows(rows, mapping, _dialect())[0]
    assert candidate.error is None
    assert candidate.amount_cents == 4500


def test_unparseable_date_is_reported_without_stopping_the_batch():
    rows = [["pas une date", "X", "-10,00"], ["02/03/2025", "Y", "-20,00"]]
    mapping = {0: "date", 1: "label", 2: "amount"}
    candidates = parse_rows(rows, mapping, _dialect())
    assert candidates[0].error is not None and "date" in candidates[0].error.lower()
    assert candidates[1].error is None
    assert candidates[1].amount_cents == -2000


def test_row_numbers_are_one_based_and_stable():
    rows = [["01/03/2025", "A", "-1,00"], ["02/03/2025", "B", "-2,00"]]
    mapping = {0: "date", 1: "label", 2: "amount"}
    candidates = parse_rows(rows, mapping, _dialect())
    assert [c.row_number for c in candidates] == [1, 2]


def test_optional_columns_are_captured():
    rows = [["01/03/2025", "05/03/2025", "ACHAT", "Alimentation", "note", "REF9", "-10,00"]]
    mapping = {0: "date", 1: "value_date", 2: "label", 3: "category",
               4: "notes", 5: "reference", 6: "amount"}
    candidate = parse_rows(rows, mapping, _dialect())[0]
    assert candidate.value_date == date(2025, 3, 5)
    assert candidate.category_hint == "Alimentation"
    assert candidate.notes == "note"
    assert candidate.reference == "REF9"


def test_short_row_is_flagged_rather_than_crashing():
    rows = [["01/03/2025"]]
    mapping = {0: "date", 1: "label", 2: "amount"}
    assert parse_rows(rows, mapping, _dialect())[0].error is not None
