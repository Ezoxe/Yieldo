import re
import unicodedata

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
_HEADER_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("value_date", re.compile(r"date\s*(de\s*)?val|dateval|value\s*date|comptabilis")),
    ("date", re.compile(r"^date|dateop|date\s*op|operation\s*date|transaction\s*date|jour")),
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


def _normalize_header(header: str) -> str:
    text = unicodedata.normalize("NFKD", header or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def suggest_mapping(headers: list[str]) -> dict[int, str]:
    """Propose a role per column. The user always sees and can override this."""
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
