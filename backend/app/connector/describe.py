"""The French sentence an approval shows on Discord.

A household asked to click « Valider » must read what will happen, named by
its own data: « Supprimer la transaction du 12/09/2026 « CARREFOUR »
(−45,20 €) », not `DELETE /transactions/812`. Each approve tool of the
catalogue carries one describer; `test_connector_catalog.py` fails when one
is missing. A describer only reads. It refuses (404) an object that does not
exist or belongs to another household, so a bad call never reaches Discord.
"""

from collections.abc import Callable
from datetime import date
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import (
    Account,
    AgentProposal,
    Category,
    CategoryRule,
    ColumnProfile,
    Debt,
    DeclaredRecurrence,
    Goal,
    ImportBatch,
    InvestmentAccount,
    Lot,
    PendingImport,
    PlanLine,
    PlannedEvent,
    Position,
    RecurrenceDismissal,
    Scenario,
    Transaction,
    User,
)

Describer = Callable[[Session, User, dict[str, Any]], str]

NBSP = " "
NNBSP = " "

# How a field is named to the household. A field absent from here is shown
# under its own name: better a technical word than a field left out.
FIELD_LABELS: dict[str, str] = {
    "name": "nom", "label": "libellé", "kind": "type", "currency": "devise",
    "amount_cents": "montant", "opening_balance_cents": "solde d'ouverture",
    "opening_balance_on": "date du solde d'ouverture", "target_cents": "cible",
    "saved_cents": "déjà épargné", "principal_cents": "capital",
    "minimum_payment_cents": "mensualité minimale", "annual_rate_bps": "taux annuel (pb)",
    "declared_value_cents": "valeur déclarée", "unit_cost_cents": "prix unitaire",
    "quantity": "quantité", "acquired_on": "acquis le", "date": "date", "due_on": "échéance",
    "category_id": "catégorie", "account_id": "compte", "mode": "lecture",
    "include_in_net_worth": "compté dans le patrimoine", "archived": "archivé",
    "symbol": "symbole", "instrument_id": "instrument", "investment_account_id": "compte-titres",
    "position_id": "position", "periodicity": "périodicité", "note": "note", "notes": "notes",
    "decision_note": "note", "reason": "raison", "payload": "paramètres", "corps": "contenu",
}

MODE_LABELS = {"real": "Réel", "estimated": "Estimé", "blended": "Mixte"}


def euros(cents: int) -> str:
    """« −1 234,56 € » with French spacing."""
    sign = "−" if cents < 0 else ""
    whole, fraction = divmod(abs(cents), 100)
    grouped = f"{whole:,}".replace(",", NNBSP)
    return f"{sign}{grouped},{fraction:02d}{NBSP}€"


def french_date(value: date | str) -> str:
    if isinstance(value, str):
        try:
            value = date.fromisoformat(value)
        except ValueError:
            return value
    return value.strftime("%d/%m/%Y")


def value_text(key: str, value: Any) -> str:
    if value is None:
        return "vide"
    if isinstance(value, bool):
        return "oui" if value else "non"
    if key.endswith("_cents") and isinstance(value, int):
        return euros(value)
    if key.endswith("_bps") and isinstance(value, int):
        return f"{Decimal(value) / 100:.2f}{NBSP}%".replace(".", ",")
    if isinstance(value, date) or (isinstance(value, str) and key.endswith(("_on", "date"))):
        return french_date(value)
    if isinstance(value, (list, dict)):
        return f"{len(value)} élément(s)"
    return f"« {value} »" if isinstance(value, str) else str(value)


def arguments_text(args: dict[str, Any], skip: tuple[str, ...] = ()) -> str:
    parts = [
        f"{FIELD_LABELS.get(key, key)} = {value_text(key, value)}"
        for key, value in args.items()
        if key not in skip
    ]
    return " ; ".join(parts)


def _owned(db: Session, user: User, model: type, row_id: Any, noun: str) -> Any:
    row = db.get(model, row_id) if isinstance(row_id, int) else None
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail=f"{noun.capitalize()} introuvable")
    return row


def deleting(model: type, id_arg: str, noun: str, label: Callable[[Any], str]) -> Describer:
    def describe(db: Session, user: User, args: dict[str, Any]) -> str:
        row = _owned(db, user, model, args.get(id_arg), noun)
        return f"Supprimer {noun} {label(row)}"

    return describe


def changing(model: type, id_arg: str, noun: str, label: Callable[[Any], str]) -> Describer:
    def describe(db: Session, user: User, args: dict[str, Any]) -> str:
        row = _owned(db, user, model, args.get(id_arg), noun)
        changes = arguments_text(args, skip=(id_arg,))
        return f"Modifier {noun} {label(row)} : {changes or 'aucun changement'}"

    return describe


def creating(sentence: str) -> Describer:
    def describe(_db: Session, _user: User, args: dict[str, Any]) -> str:
        details = arguments_text(args)
        return f"{sentence} : {details}" if details else sentence

    return describe


def fixed(sentence: str) -> Describer:
    return lambda _db, _user, _args: sentence


# -- Labels ---------------------------------------------------------------------


def transaction_label(row: Transaction) -> str:
    return f"du {french_date(row.date)} « {row.label_raw} » ({euros(row.amount_cents)})"


def named(row: Any) -> str:
    return f"« {row.name} »"


def labelled(row: Any) -> str:
    return f"« {row.label} »"


def batch_label(row: ImportBatch) -> str:
    imported_on = french_date(row.created_at.date())
    return f"« {row.filename} » ({row.rows_imported} lignes, importé le {imported_on})"


def lot_label(row: Lot) -> str:
    return (
        f"de {row.quantity} au prix de {euros(row.unit_cost_cents)} "
        f"(acquis le {french_date(row.acquired_on)})"
    )


# -- Describers that need more than a row -----------------------------------------


def unchecking(db: Session, user: User, args: dict[str, Any]) -> str:
    declaration = _owned(db, user, DeclaredRecurrence, args.get("declaration_id"), "récurrence")
    return (
        f"Retirer le pointage de l'échéance du {french_date(str(args.get('due_on')))} "
        f"de « {declaration.label} »"
    )


def applying_proposal(db: Session, user: User, args: dict[str, Any]) -> str:
    proposal = _owned(db, user, AgentProposal, args.get("proposal_id"), "proposition")
    return f"Appliquer la proposition de l'agent : « {proposal.summary} »"


def deleting_proposal(db: Session, user: User, args: dict[str, Any]) -> str:
    proposal = _owned(db, user, AgentProposal, args.get("proposal_id"), "proposition")
    return f"Supprimer la proposition de l'agent « {proposal.summary} »"


def changing_mode(_db: Session, _user: User, args: dict[str, Any]) -> str:
    mode = args.get("mode")
    return f"Passer la lecture des chiffres en « {MODE_LABELS.get(str(mode), mode)} »"


def creating_account(_db: Session, _user: User, args: dict[str, Any]) -> str:
    return f"Créer le compte « {args.get('name')} » : {arguments_text(args, skip=('name',))}"


def creating_position(db: Session, user: User, args: dict[str, Any]) -> str:
    account = _owned(
        db, user, InvestmentAccount, args.get("investment_account_id"), "compte-titres")
    return f"Ajouter une position au compte-titres « {account.name} » : {arguments_text(args)}"


def creating_lot(db: Session, user: User, args: dict[str, Any]) -> str:
    _owned(db, user, Position, args.get("position_id"), "position")
    return f"Ajouter un lot à la position n° {args.get('position_id')} : {arguments_text(args)}"


DESCRIBERS: dict[str, Describer] = {
    "yieldo_creer_compte": creating_account,
    "yieldo_modifier_compte": changing(Account, "account_id", "le compte", named),
    "yieldo_supprimer_compte": deleting(Account, "account_id", "le compte", named),
    "yieldo_annuler_import": deleting(ImportBatch, "batch_id", "l'import", batch_label),
    "yieldo_ecarter_import_prepare": deleting(
        PendingImport, "pending_id", "le relevé préparé", lambda row: f"« {row.filename} »"),
    "yieldo_creer_profil_import": creating("Enregistrer un profil d'import"),
    "yieldo_supprimer_profil_import": deleting(
        ColumnProfile, "profile_id", "le profil d'import", named),
    "yieldo_supprimer_transaction": deleting(
        Transaction, "transaction_id", "la transaction", transaction_label),
    "yieldo_supprimer_categorie": deleting(Category, "category_id", "la catégorie", named),
    "yieldo_supprimer_regle": deleting(
        CategoryRule, "rule_id", "la règle", lambda row: f"« {row.pattern} »"),
    "yieldo_indice_prix_insee": fixed("Charger l'indice des prix de l'INSEE intégré à Yieldo"),
    "yieldo_regler_indice_prix": creating("Remplacer l'indice des prix saisi"),
    "yieldo_supprimer_recurrence": deleting(
        DeclaredRecurrence, "declaration_id", "la récurrence déclarée", labelled),
    "yieldo_depointer_echeance": unchecking,
    "yieldo_retablir_detection": deleting(
        RecurrenceDismissal, "dismissal_id", "la mise à l'écart de", labelled),
    "yieldo_supprimer_ligne_plan": deleting(PlanLine, "line_id", "la ligne de plan", labelled),
    "yieldo_plan_depuis_recurrences": creating("Créer des lignes de plan depuis les récurrences"),
    "yieldo_changer_lecture": changing_mode,
    "yieldo_supprimer_evenement": deleting(PlannedEvent, "event_id", "l'événement prévu", labelled),
    "yieldo_appliquer_proposition": applying_proposal,
    "yieldo_supprimer_proposition": deleting_proposal,
    "yieldo_supprimer_dette": deleting(Debt, "debt_id", "la dette", named),
    "yieldo_supprimer_objectif": deleting(Goal, "goal_id", "l'objectif", named),
    "yieldo_enregistrer_scenario": creating("Enregistrer un scénario de faisabilité"),
    "yieldo_supprimer_scenario": deleting(Scenario, "scenario_id", "le scénario", named),
    "yieldo_creer_instrument": creating("Ajouter un instrument"),
    "yieldo_creer_compte_titres": creating("Créer un compte-titres"),
    "yieldo_modifier_compte_titres": changing(
        InvestmentAccount, "account_id", "le compte-titres", named),
    "yieldo_supprimer_compte_titres": deleting(
        InvestmentAccount, "account_id", "le compte-titres", named),
    "yieldo_creer_position": creating_position,
    "yieldo_supprimer_position": deleting(
        Position, "position_id", "la position", lambda row: f"n° {row.id}"),
    "yieldo_creer_lot": creating_lot,
    "yieldo_modifier_lot": changing(Lot, "lot_id", "le lot", lot_label),
    "yieldo_supprimer_lot": deleting(Lot, "lot_id", "le lot", lot_label),
    "yieldo_effacer_chat": fixed("Effacer tout l'historique de l'assistant"),
    "yieldo_exporter": creating("Générer un document d'export"),
    "yieldo_invest_tour": fixed(
        "Lancer un tour de pilotage de l'investissement (fictif : un mandat réel le refuse)"),
}
