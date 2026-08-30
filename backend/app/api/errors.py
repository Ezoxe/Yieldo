"""French text for request-validation failures.

FastAPI answers a schema violation with pydantic's own English message. On
`/connexion`, typing `pas-un-email` put *"value is not a valid email address: An
email address must have an @-sign."* straight into the alert on screen -- the
first screen anyone touches, in a project whose contract says every user-facing
message is French.

The translation belongs here rather than in the client: `LoginPage` renders the
backend's `detail` verbatim precisely because the backend's messages are
supposed to be French already, and rewriting them in the browser would mean
every caller had to know how to do it.

The reply keeps FastAPI's own 422 shape -- a list of `{loc, msg, type}` -- so a
client still knows which field failed and why without reading prose; only `msg`
is rewritten. `input` is dropped rather than translated: FastAPI echoes the
rejected value back, which on a too-short password is the password itself.
"""

from collections.abc import Mapping, Sequence
from typing import Any

# How a field is named in a sentence, subject-first so the message reads as
# French rather than as a label with text bolted on. A field absent from this
# map is quoted by its own identifier ("Le champ « limit » ..."), which is worse
# prose but still tells the user exactly what to fix.
FIELD_SUBJECTS: dict[str, str] = {
    "email": "L'adresse e-mail",
    "password": "Le mot de passe",
    "name": "Le nom",
    "file": "Le fichier",
    "account_id": "Le compte",
    "category_id": "La catégorie",
    "parent_id": "La catégorie parente",
    "currency": "La devise",
    "notes": "Les notes",
    "tags": "Les étiquettes",
    "color": "La couleur",
    "icon": "L'icône",
    "monthly_budget_cents": "Le budget mensuel",
    "opening_balance_cents": "Le solde initial",
    "opened_on": "La date d'ouverture",
    "date_from": "La date de début",
    "date_to": "La date de fin",
    "mapping": "Le taggage des colonnes",
    "dialect": "Le format du fichier",
    "upload_token": "Le jeton de téléversement",
    "original_filename": "Le nom du fichier",
    "overrides": "Les catégories corrigées",
    "keep_duplicates": "Les doublons à conserver",
    "kind": "Le type",
    "archived": "L'archivage",
    "include_in_net_worth": "La prise en compte dans le patrimoine",
    "is_essential": "Le caractère essentiel",
    "is_transfer": "Le virement interne",
    "principal_cents": "Le capital restant dû",
    "annual_rate_bps": "Le taux annuel",
    "minimum_payment_cents": "La mensualité",
    "term_months": "La durée",
    "extra_cents": "Le versement supplémentaire",
    # Shared with `GoalIn.target_cents` ("Le montant cible" -- a savings goal,
    # already shipped in task 7). `FeasibilityIn.target_cents` names a purchase
    # price, and the brief this task was handed asks for "Le prix du bien"
    # here -- but `FIELD_SUBJECTS` is one global dict keyed by bare field name,
    # with no route or schema context, so the two meanings collide on the same
    # key. Overwriting it would silently mislabel every future goal-creation
    # 422. Kept as the existing, already-correct goals wording; a purchase
    # price of zero still reads as a true, if generic, sentence. See the task
    # report for this discrepancy.
    "target_cents": "Le montant cible",
    "saved_cents": "Le montant déjà constitué",
    "due_on": "L'échéance",
    "priority": "La priorité",
    "horizon_months": "L'échéance",
    "down_payment_cents": "L'apport",
    "nature": "La nature du bien",
    "loan_rate_bps": "Le taux du crédit",
    "loan_months": "La durée du crédit",
    "ownership_years": "La durée de possession",
    "monthly_cents": "Le montant mensuel",
    "residual_cents": "La valeur de rachat",
    "deposit_cents": "L'apport initial",
}

# One template per pydantic error type, formatted with the field's subject.
# Everything the schemas and query parameters of this app can actually raise is
# listed; `_UNKNOWN` covers a type added later, and still names the field rather
# than swallowing the failure. The untranslated `type` stays in the reply.
_SIMPLE: dict[str, str] = {
    "missing": "{subject} est obligatoire.",
    "value_error": "{subject} n'est pas valide.",
    # A PATCH carrying an explicit `null` on a column the database requires.
    "null_not_allowed": "{subject} ne peut pas être vidé.",
    "string_type": "{subject} doit être un texte.",
    "string_pattern_mismatch": "{subject} n'a pas le format attendu.",
    "int_type": "{subject} doit être un nombre entier.",
    "int_parsing": "{subject} doit être un nombre entier.",
    "int_from_float": "{subject} doit être un nombre entier.",
    "float_type": "{subject} doit être un nombre.",
    "float_parsing": "{subject} doit être un nombre.",
    "decimal_parsing": "{subject} doit être un nombre.",
    "bool_type": "{subject} doit valoir vrai ou faux.",
    "bool_parsing": "{subject} doit valoir vrai ou faux.",
    "date_type": "{subject} doit être une date au format AAAA-MM-JJ.",
    "date_parsing": "{subject} doit être une date au format AAAA-MM-JJ.",
    "date_from_datetime_parsing": "{subject} doit être une date au format AAAA-MM-JJ.",
    "date_from_datetime_inexact": "{subject} doit être une date sans heure.",
    "datetime_type": "{subject} doit être une date et une heure au format ISO 8601.",
    "datetime_parsing": "{subject} doit être une date et une heure au format ISO 8601.",
    "list_type": "{subject} doit être une liste.",
    "dict_type": "{subject} doit être un objet.",
    "model_attributes_type": "{subject} doit être un objet.",
    "extra_forbidden": "{subject} n'est pas attendu ici.",
    "enum": "{subject} ne fait pas partie des valeurs acceptées.",
    "literal_error": "{subject} ne fait pas partie des valeurs acceptées.",
}

_UNKNOWN = "{subject} n'est pas valide."

_JSON_INVALID = "Le corps de la requête n'est pas un JSON valide."


def _subject(loc: Sequence[Any]) -> str:
    """The name the user knows this field by, as the subject of a sentence.

    `loc` opens with the part of the request at fault ("body", "query", "path")
    and continues with the path inside it. Integers in that path are list
    indices, which name no field, so the field is the last string element.
    """
    names = [part for part in loc[1:] if isinstance(part, str)]
    if not names:
        return "Le corps de la requête"
    name = names[-1]
    return FIELD_SUBJECTS.get(name, f"Le champ « {name} »")


def _characters(count: int) -> str:
    return f"{count} caractère" if count <= 1 else f"{count} caractères"


def _elements(count: int) -> str:
    return f"{count} élément" if count <= 1 else f"{count} éléments"


def french_message(error: Mapping[str, Any]) -> str:
    """One pydantic error, as a sentence the user can act on."""
    kind = str(error.get("type", ""))
    if kind == "json_invalid":
        return _JSON_INVALID

    subject = _subject(error.get("loc") or ())
    ctx: Mapping[str, Any] = error.get("ctx") or {}

    if kind == "string_too_short":
        return f"{subject} doit contenir au moins {_characters(ctx['min_length'])}."
    if kind == "string_too_long":
        return f"{subject} doit contenir au plus {_characters(ctx['max_length'])}."
    if kind == "too_short":
        return f"{subject} doit contenir au moins {_elements(ctx['min_length'])}."
    if kind == "too_long":
        return f"{subject} doit contenir au plus {_elements(ctx['max_length'])}."
    if kind == "greater_than":
        return f"{subject} doit être strictement supérieur à {ctx['gt']}."
    if kind == "greater_than_equal":
        return f"{subject} doit être supérieur ou égal à {ctx['ge']}."
    if kind == "less_than":
        return f"{subject} doit être strictement inférieur à {ctx['lt']}."
    if kind == "less_than_equal":
        return f"{subject} doit être inférieur ou égal à {ctx['le']}."

    return _SIMPLE.get(kind, _UNKNOWN).format(subject=subject)


def french_validation_detail(errors: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """FastAPI's 422 body, with every message rewritten in French."""
    return [
        {
            "loc": list(error.get("loc") or ()),
            "msg": french_message(error),
            "type": str(error.get("type", "")),
        }
        for error in errors
    ]
