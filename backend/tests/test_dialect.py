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
    headers, rows = read_rows(raw, dialect)
    assert "Libellé" in headers
    assert rows[0][1] == "PÉAGE VINCI AUTOROUTES"


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
