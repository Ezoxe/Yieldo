"""What a search box's raw text means.

One field is now asked to find a label, a price, a category, an account and a
date. The screen cannot ask the reader which of those they meant, so the
question is answered here: a string comes in, and what it could stand for comes
out. Pure — no session, no clock, no locale lookup.

The reading is deliberately narrow. A number is an amount only when the WHOLE
query is that number: "carte 12" is a label fragment and reading it as 12,00 €
would silently drop every row whose label says "carte 12". The same holds for
dates. Anything the parser is unsure of stays plain text, which the caller
still searches labels with — so a term is never lost, only ever added to.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

__all__ = ["QueryTerms", "like_pattern", "parse_query"]

# A whole query that is nothing but a money amount: an optional sign, digits,
# and at most two decimals behind either separator. Three decimals is not money.
_AMOUNT = re.compile(r"^[+-]?\d+(?:[.,]\d{1,2})?$")
_ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_FR_DATE = re.compile(r"^(\d{2})/(\d{2})/(\d{4})$")
# Dropped before the amount is read: the currency the household types out of
# habit, the non-breaking space its keyboard inserts, and the space that groups
# thousands. A space between two digits is never meaningful in a price.
_AMOUNT_NOISE = re.compile(r"[\s €]|(?i:eur)")


@dataclass(frozen=True)
class QueryTerms:
    """One search box's text, and everything it could also be.

    `text` is always what the reader typed, trimmed — the label search runs on
    it whatever else was recognised. `amount_cents` is an absolute value: the
    ledger stores a 45,90 € expense as -4590 and the household searching for
    "45,90" means that row.
    """

    text: str
    amount_cents: int | None
    on_date: date | None


def _read_date(text: str) -> date | None:
    iso = _ISO_DATE.match(text)
    if iso is not None:
        year, month, day = (int(part) for part in iso.groups())
    else:
        french = _FR_DATE.match(text)
        if french is None:
            return None
        day, month, year = (int(part) for part in french.groups())
    try:
        return date(year, month, day)
    except ValueError:
        # 32/03/2026. Not a date, and not an error either: it stays text.
        return None


def _read_amount(text: str) -> int | None:
    cleaned = _AMOUNT_NOISE.sub("", text)
    if not _AMOUNT.match(cleaned):
        return None
    whole, _, fraction = cleaned.replace(",", ".").lstrip("+-").partition(".")
    return int(whole) * 100 + int(fraction.ljust(2, "0") or 0)


def parse_query(raw: str) -> QueryTerms:
    """Read a search box's text for everything it could be looking for."""
    text = (raw or "").strip()
    if not text:
        return QueryTerms(text="", amount_cents=None, on_date=None)
    on_date = _read_date(text)
    # A date is never also an amount: "2026-03-12" is not minus 20,26 €.
    amount_cents = None if on_date is not None else _read_amount(text)
    return QueryTerms(text=text, amount_cents=amount_cents, on_date=on_date)


def like_pattern(text: str) -> str:
    r"""A LIKE pattern matching the text typed, wildcards included.

    A household searching for a label with a percent sign in it means that
    label, not every label starting with what precedes the sign. Escaping is
    not a nicety: without it the box quietly returns the wrong rows and says
    nothing about it. The caller passes ``escape="\\"`` alongside.
    """
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"
