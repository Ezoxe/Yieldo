import hashlib
import re
import unicodedata
from datetime import date

# Bank statement labels carry noise that is not part of the transaction's identity:
# embedded dates, card numbers, terminal ids. Stripping them keeps re-imports idempotent.
_DATE_FRAGMENT = re.compile(r"\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b")
_LONG_DIGITS = re.compile(r"\b\d{3,}\b")
_CARD_MARKER = re.compile(r"\bcarte\s*\d*\b")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_SPACES = re.compile(r"\s+")


def normalize_label(raw: str) -> str:
    """Reduce a statement label to its stable identifying core."""
    text = unicodedata.normalize("NFKD", raw or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    text = _DATE_FRAGMENT.sub(" ", text)
    text = _CARD_MARKER.sub(" ", text)
    text = _LONG_DIGITS.sub(" ", text)
    text = _NON_ALNUM.sub(" ", text)
    return _SPACES.sub(" ", text).strip()


def compute_dedup_hash(
    user_id: int, account_id: int, on: date, amount_cents: int, label_raw: str
) -> str:
    """Stable fingerprint identifying one transaction within one user's data."""
    payload = "|".join([
        str(user_id), str(account_id), on.isoformat(),
        str(amount_cents), normalize_label(label_raw),
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
