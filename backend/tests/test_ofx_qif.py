"""`importers/ofx.py` and `importers/qif.py`: two more statement formats,
parsed pure and turned into the one table the CSV pipeline already reads.

Neither parser touches a session or a clock. Both produce `StatementRow`s;
`importers/statement.to_csv` writes them as a CSV in a FIXED dialect
(`;`, `.` decimals, ISO dates) with a FIXED mapping, so preview, dedup and
commit run unchanged — and the « Colonnes » step of the wizard has nothing
to ask.
"""

from datetime import date
from pathlib import Path

import pytest

from app.importers.dialect import read_rows
from app.importers.ofx import OfxError, parse_ofx
from app.importers.parser import parse_rows
from app.importers.qif import QifError, parse_qif
from app.importers.statement import FIXED_DIALECT, FIXED_MAPPING, StatementRow, to_csv

FIXTURES = Path(__file__).parent / "fixtures"


def test_ofx_sgml_rows_carry_date_amount_label_and_reference():
    rows = parse_ofx((FIXTURES / "releve.ofx").read_text(encoding="cp1252"))
    assert [row.on for row in rows] == [date(2026, 8, 3), date(2026, 8, 5), date(2026, 8, 10)]
    assert [row.amount_cents for row in rows] == [-4_590, 298_000, -154_950]
    assert rows[0].label == "CB CARREFOUR MARKET CARTE 03/08"
    # A memo that repeats the name is not appended twice.
    assert rows[2].label == "PRLV NETFLIX"
    assert rows[1].reference == "2026080500002"


def test_ofx_xml_is_read_the_same_way():
    text = (
        '<?xml version="1.0"?><?OFX OFXHEADER="200" VERSION="220"?>'
        "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>"
        "<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260812</DTPOSTED>"
        "<TRNAMT>-12.30</TRNAMT><FITID>a1</FITID><NAME>CB BOULANGERIE</NAME></STMTTRN>"
        "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"
    )
    rows = parse_ofx(text)
    assert rows == [StatementRow(on=date(2026, 8, 12), amount_cents=-1_230,
                                 label="CB BOULANGERIE", reference="a1")]


def test_ofx_without_a_single_transaction_is_refused_in_french():
    with pytest.raises(OfxError, match="aucune opération"):
        parse_ofx("<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>")


def test_ofx_amount_is_read_as_exact_cents():
    text = "<OFX><STMTTRN><DTPOSTED>20260101<TRNAMT>-0.1<NAME>X</STMTTRN></OFX>"
    assert parse_ofx(text)[0].amount_cents == -10


def test_ofx_missing_amount_names_the_transaction():
    text = "<OFX><STMTTRN><DTPOSTED>20260101<NAME>SANS MONTANT</STMTTRN></OFX>"
    with pytest.raises(OfxError, match="SANS MONTANT"):
        parse_ofx(text)


def test_qif_reads_french_dates_and_both_decimal_conventions():
    rows = parse_qif((FIXTURES / "releve.qif").read_text(encoding="utf-8"))
    assert [row.on for row in rows] == [date(2026, 8, 3), date(2026, 8, 5), date(2026, 8, 10)]
    assert [row.amount_cents for row in rows] == [-4_590, 298_000, -154_950]
    assert rows[0].label == "CB CARREFOUR MARKET CARTE 03/08"
    assert rows[2].reference == "2026081000003"


def test_qif_tells_day_first_from_month_first_by_the_whole_file():
    # 12/25 can only be month-first; the file decides the convention once.
    text = "!Type:Bank\nD12/25/2025\nT-1.00\nPA\n^\nD01/05/2026\nT-2.00\nPB\n^\n"
    rows = parse_qif(text)
    assert [row.on for row in rows] == [date(2025, 12, 25), date(2026, 1, 5)]


def test_qif_without_a_record_is_refused_in_french():
    with pytest.raises(QifError, match="aucune opération"):
        parse_qif("!Type:Bank\n")


def test_qif_record_without_a_date_names_its_payee():
    with pytest.raises(QifError, match="SANS DATE"):
        parse_qif("!Type:Bank\nT-1.00\nPSANS DATE\n^\n")


def test_the_fixed_table_goes_through_the_csv_pipeline_unchanged():
    rows = parse_ofx((FIXTURES / "releve.ofx").read_text(encoding="cp1252"))
    raw = to_csv(rows)
    headers, cells = read_rows(raw, FIXED_DIALECT)
    assert headers == ["date", "libelle", "montant", "reference"]
    candidates = parse_rows(cells, FIXED_MAPPING, FIXED_DIALECT)
    assert all(c.error is None for c in candidates)
    assert [c.amount_cents for c in candidates] == [-4_590, 298_000, -154_950]
    assert candidates[0].date == date(2026, 8, 3)
    assert candidates[0].label_raw == "CB CARREFOUR MARKET CARTE 03/08"
    assert candidates[1].reference == "2026080500002"
