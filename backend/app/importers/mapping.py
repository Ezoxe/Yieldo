import re
import unicodedata
from collections.abc import Sequence

from app.importers.dialect import parse_amount

COLUMN_ROLES = (
    "date", "value_date", "amount", "debit", "credit", "label", "category",
    "account", "currency", "balance", "notes", "reference", "ignore",
)

ROLE_LABELS: dict[str, str] = {
    "date": "Date",
    "value_date": "Date de valeur",
    "amount": "Montant",
    "debit": "Débit",
    "credit": "Crédit",
    "label": "Libellé",
    "category": "Catégorie",
    "account": "Compte",
    "currency": "Devise",
    "balance": "Solde",
    "notes": "Notes",
    "reference": "Référence",
    "ignore": "Ignorer",
}

# Roles that may appear at most once in a mapping.
SINGLE_USE_ROLES = frozenset(COLUMN_ROLES) - {"ignore"}

# Ordered: the first pattern that matches a header wins, so put the most
# specific ones first (value date before date, debit before amount).
# "Date de comptabilisation" is the booking date, i.e. the operation date — not
# the value date. Several French banks ship both columns, so putting
# "comptabilis" on the wrong pattern swaps the two roles silently.
_HEADER_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("value_date", re.compile(r"date\s*(de\s*)?val|dateval|value\s*date")),
    ("date", re.compile(
        r"^date|dateop|date\s*op|operation\s*date|transaction\s*date|jour|comptabilis"
    )),
    ("debit", re.compile(r"debit|sortie|retrait|withdrawal")),
    ("credit", re.compile(r"credit|entree|depot|deposit")),
    ("amount", re.compile(r"montant|amount|somme|valeur|mouvement")),
    ("balance", re.compile(r"solde|balance")),
    ("label", re.compile(r"libell|label|description|intitul|nature|designation|motif|detail")),
    ("category", re.compile(r"categor|rubrique|type")),
    ("account", re.compile(r"compte|account|iban")),
    ("currency", re.compile(r"devise|currency|monnaie")),
    ("reference", re.compile(r"ref|numero|number|piece")),
    ("notes", re.compile(r"note|commentaire|memo|remarque")),
]


# How many data rows are read to decide whether a column carries both signs.
# A bounded scan keeps the suggestion cheap on a 200 000-row export; a real
# statement mixes debits and credits well inside the first few dozen lines, and
# the user still sees and confirms the proposal either way.
SIGN_SAMPLE_ROWS = 200


def _normalize_header(header: str) -> str:
    text = unicodedata.normalize("NFKD", header or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _carries_both_signs(
    rows: Sequence[Sequence[str]], index: int, decimal_separator: str
) -> bool:
    """True when column `index` holds at least one negative AND one positive amount.

    That shape is what a two-column débit/crédit export cannot produce: each of
    its columns is filled on one side of the ledger only. A single unreadable
    cell disqualifies the column outright -- a column carrying text is not a
    column of amounts, and no proposal should be built on half a reading. Empty
    cells are skipped (a bank leaves the unused column blank) and an exact zero
    counts as neither sign ("0,00" is a placeholder, not a movement).
    """
    negative = positive = False
    for row in rows[:SIGN_SAMPLE_ROWS]:
        if index >= len(row):
            continue
        cell = (row[index] or "").strip()
        if not cell:
            continue
        try:
            cents = parse_amount(cell, decimal_separator)
        except ValueError:
            return False
        if cents < 0:
            negative = True
        elif cents > 0:
            positive = True
    return negative and positive


def suggest_mapping(
    headers: list[str],
    rows: Sequence[Sequence[str]] = (),
    decimal_separator: str = ",",
) -> dict[int, str]:
    """Propose a role per column. The user always sees and can override this.

    `rows` are the file's data rows, in the same column order as `headers`. They
    are read for one purpose only: a header alone cannot tell a two-column
    débit/crédit export from the single signed column most French banks actually
    ship -- both are commonly headed "Débit" -- and only the values can. A column
    matched as `debit` or `credit` whose values carry both signs is proposed as
    `amount` instead. Without rows the proposal is exactly the header-only one.

    Pure: no session, no clock, no I/O. Nothing here imports anything; the user
    confirms the mapping on screen before a single row is written.
    """
    mapping: dict[int, str] = {}
    taken: set[str] = set()
    for index, header in enumerate(headers):
        normalized = _normalize_header(header)
        role = "ignore"
        for candidate, pattern in _HEADER_PATTERNS:
            if candidate in taken:
                continue
            if pattern.search(normalized):
                role = candidate
                break
        if (
            role in ("debit", "credit")
            and "amount" not in taken
            and _carries_both_signs(rows, index, decimal_separator)
        ):
            role = "amount"
        if role != "ignore":
            taken.add(role)
        mapping[index] = role
    return mapping


def validate_mapping(mapping: dict[int, str], column_count: int) -> list[str]:
    """Return user-facing French error messages. Empty list means the mapping is usable."""
    errors: list[str] = []
    roles = list(mapping.values())

    for index in mapping:
        if index < 0 or index >= column_count:
            errors.append(f"La colonne n°{index + 1} n'existe pas dans le fichier.")

    for role in SINGLE_USE_ROLES:
        if roles.count(role) > 1:
            errors.append(f"Le rôle « {ROLE_LABELS[role]} » est attribué plusieurs fois.")

    for role in roles:
        if role not in COLUMN_ROLES:
            errors.append(f"Rôle de colonne inconnu : {role}.")

    if "date" not in roles:
        errors.append("Aucune colonne n'est taggée comme Date.")
    if "label" not in roles:
        errors.append("Aucune colonne n'est taggée comme Libellé.")
    if "amount" not in roles and not ("debit" in roles or "credit" in roles):
        errors.append(
            "Aucune colonne de Montant, ni de couple Débit / Crédit, n'est taggée."
        )
    return errors
