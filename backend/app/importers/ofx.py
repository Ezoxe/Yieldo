"""OFX statements — the format French banks still export beside the CSV.

Two dialects share the name: OFX 1.x is SGML, where tags open and mostly
never close (`<TRNAMT>-45.90` on its own line), and OFX 2.x is XML, where
they do. Both put one movement per `<STMTTRN>` block with the same tags
inside, so one tolerant reader covers both: find every block, then read the
first value of each tag inside it, closed or not.

Pure. Raises `OfxError` in French: a file with no `<STMTTRN>` at all is not
a statement, and a movement without an amount cannot be one.
"""

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from app.importers.statement import StatementRow


class OfxError(ValueError):
    """The file is not an OFX statement Yieldo can read; the message says why."""


_BLOCK = re.compile(r"<STMTTRN>(.*?)(?:</STMTTRN>|(?=<STMTTRN>)|$)", re.S | re.I)
_TAG = re.compile(r"<(?P<name>[A-Z0-9.]+)>(?P<value>[^<\r\n]*)", re.I)


def _fields(block: str) -> dict[str, str]:
    """Tag -> first value inside one block, whichever OFX flavour wrote it."""
    fields: dict[str, str] = {}
    for match in _TAG.finditer(block):
        name = match.group("name").upper()
        if name not in fields:
            fields[name] = match.group("value").strip()
    return fields


def _parse_date(raw: str, label: str) -> date:
    """`DTPOSTED`: `YYYYMMDD`, optionally followed by a time and a `[tz]`."""
    digits = raw[:8]
    if not re.fullmatch(r"\d{8}", digits):
        raise OfxError(f"Date illisible sur l'opération « {label} » : {raw!r}")
    try:
        return datetime.strptime(digits, "%Y%m%d").date()
    except ValueError as exc:
        raise OfxError(f"Date illisible sur l'opération « {label} » : {raw!r}") from exc


def _parse_amount(raw: str, label: str) -> int:
    """`TRNAMT`: a dot for the decimal by the standard; a comma is tolerated,
    because some exports write the locale's."""
    cleaned = raw.replace(" ", "").replace(",", ".")
    try:
        value = Decimal(cleaned)
    except InvalidOperation as exc:
        raise OfxError(f"Montant illisible sur l'opération « {label} » : {raw!r}") from exc
    return int((value * 100).to_integral_value())


def parse_ofx(text: str) -> list[StatementRow]:
    """Every `<STMTTRN>` of the file, in file order."""
    rows: list[StatementRow] = []
    for match in _BLOCK.finditer(text):
        fields = _fields(match.group(1))
        name = fields.get("NAME", "")
        memo = fields.get("MEMO", "")
        # The memo completes the name unless it repeats it — Netflix's memo is
        # « PRLV NETFLIX » under a name reading the same, and « PRLV NETFLIX
        # PRLV NETFLIX » would split the recurrence detection's label key.
        label = name if not memo or memo == name or memo in name else f"{name} {memo}".strip()
        if not label:
            raise OfxError("Une opération du fichier n'a ni libellé (NAME) ni mémo (MEMO).")
        if "TRNAMT" not in fields:
            raise OfxError(f"L'opération « {label} » n'a pas de montant (TRNAMT).")
        if "DTPOSTED" not in fields:
            raise OfxError(f"L'opération « {label} » n'a pas de date (DTPOSTED).")
        rows.append(StatementRow(
            on=_parse_date(fields["DTPOSTED"], label),
            amount_cents=_parse_amount(fields["TRNAMT"], label),
            label=label,
            reference=fields.get("FITID") or None,
        ))
    if not rows:
        raise OfxError(
            "Ce fichier OFX ne contient aucune opération (aucun bloc STMTTRN) : "
            "vérifiez qu'il s'agit bien d'un relevé de compte."
        )
    return rows
