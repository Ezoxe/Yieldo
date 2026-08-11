from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.importers.dedup import normalize_label
from app.importers.dialect import CsvDialect, parse_amount, parse_date


@dataclass
class CandidateRow:
    """One CSV line turned into a would-be transaction. `error` set means it is rejected."""

    row_number: int
    date: date | None = None
    value_date: date | None = None
    amount_cents: int | None = None
    label_raw: str = ""
    label_clean: str = ""
    category_hint: str | None = None
    notes: str | None = None
    reference: str | None = None
    error: str | None = None


def _cell(row: list[str], mapping: dict[int, str], role: str) -> str | None:
    for index, mapped_role in mapping.items():
        if mapped_role == role:
            if index >= len(row):
                return None
            return row[index].strip()
    return None


def _resolve_amount(row: list[str], mapping: dict[int, str], dialect: CsvDialect) -> int:
    """Single signed column, or a debit/credit pair. Debits are always stored negative.

    A column only counts as "populated" once it parses to a non-zero amount: a "0,00"
    left in the unused column by the bank's export format is a placeholder, not a real
    value, and must not trigger the ambiguity check below. When both columns carry a
    genuine non-zero amount -- which happens on real refund/reversal rows -- there is
    no safe way to guess which one was meant, so the row is rejected with an error
    instead of silently keeping one value and dropping the other.
    """
    single = _cell(row, mapping, "amount")
    if single is not None and single != "":
        return parse_amount(single, dialect.decimal_separator)

    debit = _cell(row, mapping, "debit")
    credit = _cell(row, mapping, "credit")
    debit_cents = parse_amount(debit, dialect.decimal_separator) if debit else 0
    credit_cents = parse_amount(credit, dialect.decimal_separator) if credit else 0

    if debit_cents != 0 and credit_cents != 0:
        raise ValueError(
            "Montant ambigu : débit et crédit sont tous deux renseignés pour cette "
            "ligne, impossible de déterminer le montant à importer"
        )
    if debit_cents != 0:
        return -abs(debit_cents)
    if credit_cents != 0:
        return abs(credit_cents)
    raise ValueError("Montant absent : ni montant, ni débit, ni crédit renseigné")


def parse_rows(
    rows: list[list[str]], mapping: dict[int, str], dialect: CsvDialect
) -> list[CandidateRow]:
    """Turn raw cells into candidates. Never raises: a bad line carries its own error."""
    candidates: list[CandidateRow] = []
    for offset, row in enumerate(rows, start=1):
        candidate = CandidateRow(row_number=offset)
        try:
            raw_date = _cell(row, mapping, "date")
            if raw_date is None or raw_date == "":
                raise ValueError("Date absente")
            candidate.date = parse_date(raw_date, dialect.date_format)

            raw_value_date = _cell(row, mapping, "value_date")
            if raw_value_date:
                try:
                    candidate.value_date = parse_date(raw_value_date, dialect.date_format)
                except ValueError:
                    candidate.value_date = None

            label = _cell(row, mapping, "label")
            if label is None or label == "":
                raise ValueError("Libellé absent")
            candidate.label_raw = label
            candidate.label_clean = normalize_label(label)

            candidate.amount_cents = _resolve_amount(row, mapping, dialect)

            candidate.category_hint = _cell(row, mapping, "category") or None
            candidate.notes = _cell(row, mapping, "notes") or None
            candidate.reference = _cell(row, mapping, "reference") or None
        except ValueError as exc:
            candidate.error = str(exc)
        candidates.append(candidate)
    return candidates
