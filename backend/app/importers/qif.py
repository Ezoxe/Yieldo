"""QIF statements — Quicken's text format, one field per line.

A record is a run of lines each starting with a one-letter code, closed by
a line holding `^`: `D` date, `T` amount, `P` payee, `M` memo, `N` number.
The format carries no date convention, and `03/08/2026` is the 3rd of
August to a French bank and the 8th of March to an American one. The file
decides once: if any date can only be day-first it is day-first, if any
can only be month-first it is month-first, and a file that never says is
read day-first, which is what a French export is. Never row by row — a
convention that changed between two records would swap days and months
silently, which is the one failure `dialect.parse_date` was written to
refuse.

Pure. Raises `QifError` in French.
"""

import re
from datetime import date
from decimal import Decimal, InvalidOperation

from app.importers.statement import StatementRow


class QifError(ValueError):
    """The file is not a QIF statement Yieldo can read; the message says why."""


_DATE = re.compile(r"^\s*(\d{1,2})[/.\-](\d{1,2})[/.'\-](\d{2,4})\s*$")


def _split_records(text: str) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    current: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.rstrip("\r")
        if not line.strip():
            continue
        if line.startswith("!"):
            continue
        if line.strip() == "^":
            if current:
                records.append(current)
            current = {}
            continue
        code, value = line[0].upper(), line[1:].strip()
        if code not in current:
            current[code] = value
    if current:
        records.append(current)
    return records


def _date_parts(raw: str, label: str) -> tuple[int, int, int]:
    match = _DATE.match(raw)
    if match is None:
        raise QifError(f"Date illisible sur l'opération « {label} » : {raw!r}")
    first, second, year = (int(part) for part in match.groups())
    if year < 100:
        year += 2000
    return first, second, year


def _day_first(records: list[dict[str, str]]) -> bool:
    """One convention for the whole file — see the module docstring."""
    for record in records:
        if "D" not in record:
            continue
        first, second, _ = _date_parts(record["D"], record.get("P", ""))
        if first > 12:
            return True
        if second > 12:
            return False
    return True


def _parse_amount(raw: str, label: str) -> int:
    """`T`: either `1 234,56` or `1,234.56`; the last separator is the decimal."""
    cleaned = raw.replace(" ", "").replace(" ", "")
    if "," in cleaned and "." in cleaned:
        decimal_sep = "," if cleaned.rfind(",") > cleaned.rfind(".") else "."
        cleaned = cleaned.replace("." if decimal_sep == "," else ",", "")
        cleaned = cleaned.replace(decimal_sep, ".")
    else:
        cleaned = cleaned.replace(",", ".")
    try:
        value = Decimal(cleaned)
    except InvalidOperation as exc:
        raise QifError(f"Montant illisible sur l'opération « {label} » : {raw!r}") from exc
    return int((value * 100).to_integral_value())


def parse_qif(text: str) -> list[StatementRow]:
    """Every record of the file, in file order."""
    records = _split_records(text)
    if not records:
        raise QifError(
            "Ce fichier QIF ne contient aucune opération : vérifiez qu'il s'agit bien "
            "d'un relevé de compte."
        )
    day_first = _day_first(records)
    rows: list[StatementRow] = []
    for record in records:
        payee = record.get("P", "")
        memo = record.get("M", "")
        label = payee if not memo or memo == payee or memo in payee else f"{payee} {memo}".strip()
        if not label:
            raise QifError("Une opération du fichier n'a ni bénéficiaire (P) ni mémo (M).")
        if "D" not in record:
            raise QifError(f"L'opération « {label} » n'a pas de date (D).")
        if "T" not in record:
            raise QifError(f"L'opération « {label} » n'a pas de montant (T).")
        first, second, year = _date_parts(record["D"], label)
        day, month = (first, second) if day_first else (second, first)
        try:
            on = date(year, month, day)
        except ValueError as exc:
            raise QifError(
                f"Date illisible sur l'opération « {label} » : {record['D']!r}"
            ) from exc
        rows.append(StatementRow(
            on=on,
            amount_cents=_parse_amount(record["T"], label),
            label=label,
            reference=record.get("N") or None,
        ))
    return rows
