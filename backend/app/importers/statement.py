"""The one table every non-CSV statement format is turned into.

OFX and QIF carry their column roles in the format: a `<TRNAMT>` is an
amount and nothing else, a `D` line is a date. There is nothing for the
household to confirm on the « Colonnes » step, and no dialect to detect.
Rather than teach the preview, the dedup and the commit a second input
shape, each parser produces `StatementRow`s and `to_csv` writes them as a
CSV in a FIXED dialect with a FIXED mapping — so everything downstream of
the upload runs exactly as it does for a CSV, byte for byte, and the wizard
only skips the step it has no question for.

Pure: no session, no clock, no file system.
"""

import csv
import io
from dataclasses import dataclass
from datetime import date

from app.importers.dialect import CsvDialect


@dataclass(frozen=True)
class StatementRow:
    """One movement, as a statement format states it."""

    on: date
    amount_cents: int
    label: str
    reference: str | None = None


# ISO dates, a dot for the decimal, a semicolon between cells, UTF-8: the
# dialect the converted table is written in and read back with. Never
# detected, never overridden.
FIXED_DIALECT = CsvDialect(
    encoding="utf-8",
    delimiter=";",
    decimal_separator=".",
    date_format="%Y-%m-%d",
    header_row=0,
    preamble_rows=0,
)

FIXED_HEADERS = ["date", "libelle", "montant", "reference"]

# Column index -> role, the shape `parser.parse_rows` reads.
FIXED_MAPPING: dict[int, str] = {0: "date", 1: "label", 2: "amount", 3: "reference"}


def to_csv(rows: list[StatementRow]) -> bytes:
    """The rows as the fixed-dialect CSV, ready for `build_preview`."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=FIXED_DIALECT.delimiter, lineterminator="\n")
    writer.writerow(FIXED_HEADERS)
    for row in rows:
        sign = "-" if row.amount_cents < 0 else ""
        cents = abs(row.amount_cents)
        writer.writerow([
            row.on.isoformat(),
            row.label,
            f"{sign}{cents // 100}.{cents % 100:02d}",
            row.reference or "",
        ])
    return buffer.getvalue().encode("utf-8")
