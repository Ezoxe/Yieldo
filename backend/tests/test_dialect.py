from datetime import date
from pathlib import Path

import pytest

from app.importers.dialect import detect_dialect, parse_amount, parse_date, read_rows

FIXTURES = Path(__file__).parent / "fixtures"


def test_detects_boursorama_semicolon_comma_decimal_french_dates():
    dialect = detect_dialect((FIXTURES / "boursorama.csv").read_bytes())
    assert dialect.delimiter == ";"
    assert dialect.decimal_separator == ","
    assert dialect.date_format == "%d/%m/%Y"
    assert dialect.preamble_rows == 3
    assert dialect.encoding.lower().startswith("utf")


def test_detects_latin1_encoding_without_mojibake():
    raw = (FIXTURES / "credit_agricole_latin1.csv").read_bytes()
    dialect = detect_dialect(raw)
    assert dialect.encoding == "cp1252"
    headers, rows = read_rows(raw, dialect)
    assert "Libellé" in headers
    assert rows[0][1] == "PÉAGE VINCI AUTOROUTES"


def test_read_rows_decodes_accented_letters_a_statistical_guess_would_corrupt():
    # cp1250 (what the old statistical detector picked for this file) agrees with
    # cp1252/Latin-1 on e-acute, so a fixture with only "PÉAGE" would not catch a
    # regression to cp1250 — it silently turns à, è, ê, ù, û (and their uppercase
    # forms) into unrelated Central European letters instead of raising. These two
    # labels exercise exactly those bytes.
    raw = (FIXTURES / "credit_agricole_latin1.csv").read_bytes()
    dialect = detect_dialect(raw)
    _, rows = read_rows(raw, dialect)
    assert len(rows) == 5
    assert rows[3][1] == "PRÉLÈVEMENT MUTUELLE"
    assert rows[4][1] == "GOÛTER À LA FERME"


def test_detects_comma_delimiter_and_iso_dates():
    dialect = detect_dialect((FIXTURES / "generic_iso.csv").read_bytes())
    assert dialect.delimiter == ","
    assert dialect.decimal_separator == "."
    assert dialect.date_format == "%Y-%m-%d"
    assert dialect.preamble_rows == 0


def test_read_rows_skips_preamble_and_returns_headers():
    raw = (FIXTURES / "boursorama.csv").read_bytes()
    headers, rows = read_rows(raw, detect_dialect(raw))
    assert headers == ["dateOp", "dateVal", "label", "category", "amount"]
    assert len(rows) == 4
    assert rows[0][2] == "CARREFOUR MARKET CB 01/03"


@pytest.mark.parametrize(("text", "fmt", "expected"), [
    ("01/03/2025", "%d/%m/%Y", date(2025, 3, 1)),
    ("2025-03-01", "%Y-%m-%d", date(2025, 3, 1)),
    ("01/03/25", "%d/%m/%y", date(2025, 3, 1)),
    (" 01/03/2025 ", "%d/%m/%Y", date(2025, 3, 1)),
])
def test_parse_date_accepts_supported_formats(text, fmt, expected):
    assert parse_date(text, fmt) == expected


def test_parse_date_rejects_unparseable_text():
    with pytest.raises(ValueError, match="Date illisible"):
        parse_date("pas une date", "%d/%m/%Y")


def test_parse_date_does_not_fall_back_to_a_different_format():
    # 25/03/2025 is invalid as %m/%d/%Y (there is no 25th month): if parse_date
    # silently fell back to trying %d/%m/%Y (or any other DATE_FORMATS entry) it
    # would return a date instead of raising. It must raise, because a wrong
    # detected format should surface as a reviewable import error, not silently
    # reinterpret the date (e.g. 01/03/2025 read as US would become 3 January
    # instead of 1 March, with nothing to signal the swap).
    with pytest.raises(ValueError, match="Date illisible"):
        parse_date("25/03/2025", "%m/%d/%Y")


@pytest.mark.parametrize(("text", "sep", "expected"), [
    ("-47,32", ",", -4732),
    ("2450,00", ",", 245000),
    ("-89.90", ".", -8990),
    ("1 234,56", ",", 123456),
    ("1 234,56", ",", 123456),
    ("1.234,56", ",", 123456),
    ("1,234.56", ".", 123456),
    ("(47,32)", ",", -4732),
    ("47,32 €", ",", 4732),
    ("+120,00", ",", 12000),
    ("0", ",", 0),
])
def test_parse_amount_returns_cents(text, sep, expected):
    assert parse_amount(text, sep) == expected


def test_parse_amount_rejects_empty_and_garbage():
    with pytest.raises(ValueError, match="Montant illisible"):
        parse_amount("", ",")
    with pytest.raises(ValueError, match="Montant illisible"):
        parse_amount("abc", ",")


def test_parse_amount_rounds_half_up_on_extra_decimals():
    assert parse_amount("1,005", ",") == 101
    assert parse_amount("1,004", ",") == 100
