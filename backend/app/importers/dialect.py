import csv
import io
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from charset_normalizer import from_bytes

DATE_FORMATS = ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d", "%m/%d/%Y", "%d-%m-%Y", "%d.%m.%Y")
_CANDIDATE_DELIMITERS = (";", ",", "\t", "|")
# Anything that isn't a digit, a separator, a sign or a parenthesis is noise
# (currency symbols, spaces, narrow no-break spaces used for thousands, ...).
_AMOUNT_CLEANUP = re.compile(r"[^\d,.\-+()]")


@dataclass
class CsvDialect:
    """Everything needed to turn a byte blob into a table of strings.

    Every field is a plain JSON-compatible type: this dataclass is meant to be
    serialized to JSON (user review/override step) and read back unchanged.
    """

    encoding: str = "utf-8"
    delimiter: str = ";"
    decimal_separator: str = ","
    date_format: str = "%d/%m/%Y"
    header_row: int = 0
    preamble_rows: int = 0
    quotechar: str = '"'
    sample_headers: list[str] = field(default_factory=list)


def _decode(raw: bytes) -> tuple[str, str]:
    """Guess the text encoding of a byte blob and decode it."""
    best = from_bytes(raw).best()
    if best is None:
        return raw.decode("utf-8", errors="replace"), "utf-8"
    return str(best), best.encoding


def _pick_delimiter(lines: list[str]) -> str:
    """The delimiter is the candidate producing the most consistent column count."""
    best_delimiter, best_score = ";", -1.0
    for candidate in _CANDIDATE_DELIMITERS:
        counts = [line.count(candidate) for line in lines if line.strip()]
        if not counts or max(counts) == 0:
            continue
        most_common, occurrences = Counter(counts).most_common(1)[0]
        if most_common == 0:
            continue
        score = occurrences * most_common
        if score > best_score:
            best_delimiter, best_score = candidate, score
    return best_delimiter


def _find_header_row(rows: list[list[str]], delimiter: str) -> int:
    """The header is the first row whose column count matches the table's dominant width."""
    widths = Counter(len(row) for row in rows if any(cell.strip() for cell in row))
    if not widths:
        return 0
    dominant, _ = widths.most_common(1)[0]
    for index, row in enumerate(rows):
        if len(row) == dominant and any(cell.strip() for cell in row):
            return index
    return 0


def _detect_date_format(samples: list[str]) -> str:
    """Return the first known format that parses at least half of the samples."""
    for fmt in DATE_FORMATS:
        matched = sum(1 for sample in samples if _matches_date_format(sample, fmt))
        if samples and matched >= max(1, len(samples) // 2):
            return fmt
    return "%d/%m/%Y"


def _matches_date_format(sample: str, fmt: str) -> bool:
    try:
        datetime.strptime(sample.strip(), fmt)
        return True
    except ValueError:
        return False


def _detect_decimal_separator(samples: list[str]) -> str:
    """A trailing comma-then-1-or-2-digits (or dot equivalent) marks the decimal mark."""
    comma_decimal = sum(1 for s in samples if re.search(r",\d{1,2}\b", s))
    dot_decimal = sum(1 for s in samples if re.search(r"\.\d{1,2}\b", s))
    return "," if comma_decimal >= dot_decimal else "."


def detect_dialect(raw: bytes) -> CsvDialect:
    """Infer how to read a CSV. Every field is a proposal the user may override."""
    text, encoding = _decode(raw)
    lines = text.splitlines()[:40]
    delimiter = _pick_delimiter(lines)

    reader = csv.reader(io.StringIO("\n".join(lines)), delimiter=delimiter)
    rows = list(reader)
    header_row = _find_header_row(rows, delimiter)
    headers = rows[header_row] if rows else []
    body = rows[header_row + 1 :]

    date_samples: list[str] = []
    amount_samples: list[str] = []
    for row in body[:20]:
        for cell in row:
            stripped = cell.strip()
            if re.fullmatch(r"\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}", stripped):
                date_samples.append(stripped)
            elif re.fullmatch(r"[-+(]?[\d\s .,]+\)?\s*€?", stripped) and any(
                ch.isdigit() for ch in stripped
            ):
                amount_samples.append(stripped)

    return CsvDialect(
        encoding=encoding,
        delimiter=delimiter,
        decimal_separator=_detect_decimal_separator(amount_samples),
        date_format=_detect_date_format(date_samples),
        header_row=header_row,
        preamble_rows=header_row,
        quotechar='"',
        sample_headers=[h.strip() for h in headers],
    )


def read_rows(raw: bytes, dialect: CsvDialect) -> tuple[list[str], list[list[str]]]:
    """Decode and split a CSV according to a dialect. Returns (headers, data rows)."""
    text = raw.decode(dialect.encoding, errors="replace")
    reader = csv.reader(io.StringIO(text), delimiter=dialect.delimiter, quotechar=dialect.quotechar)
    rows = list(reader)
    if dialect.header_row >= len(rows):
        return [], []
    headers = [cell.strip() for cell in rows[dialect.header_row]]
    body = [row for row in rows[dialect.header_row + 1 :] if any(c.strip() for c in row)]
    return headers, body


def parse_date(text: str, date_format: str) -> date:
    """Parse a date string, trying the detected format first, then every known one."""
    stripped = (text or "").strip()
    for fmt in (date_format, *DATE_FORMATS):
        try:
            return datetime.strptime(stripped, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Date illisible : {text!r}")


def parse_amount(text: str, decimal_separator: str) -> int:
    """Parse a monetary string into an exact number of cents.

    Uses Decimal (never float) so amounts stay exact; ROUND_HALF_UP matches how
    banks round their own displayed totals.
    """
    stripped = (text or "").strip()
    if not stripped:
        raise ValueError("Montant illisible : valeur vide")

    negative = stripped.startswith("(") and stripped.endswith(")")
    cleaned = _AMOUNT_CLEANUP.sub("", stripped).replace("(", "").replace(")", "")

    thousands_separator = "." if decimal_separator == "," else ","
    cleaned = cleaned.replace(thousands_separator, "").replace(decimal_separator, ".")

    if cleaned in ("", "-", "+", "."):
        raise ValueError(f"Montant illisible : {text!r}")
    try:
        value = Decimal(cleaned)
    except InvalidOperation as exc:
        raise ValueError(f"Montant illisible : {text!r}") from exc

    if negative:
        value = -abs(value)
    cents = (value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(cents)
