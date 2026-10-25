"""The connector's tools, one line each, and the routes it must never reach.

A tool is a name, a tier, a French title and the route it replays. Its input
schema comes from that route (`schema.py`), its approval sentence from
`describe.py`. Three tiers:

* `read`    -- nothing written; allowed directly by EZLink (scope finance_read).
* `write`   -- written directly, easy to undo or to correct (finance_write).
* `approve` -- the household clicks « Valider » on Discord first
               (finance_write). Every deletion is one.

`NEVER` names every write route left out, with the reason. A route behind
`get_session_user` is there by construction -- the key would be refused
anyway -- and `test_connector_catalog.py` fails when a write route of the
application is in neither list, so a new route is a decision, not an accident.
"""

import hashlib
import json
from dataclasses import dataclass
from functools import cache
from typing import Any, Literal

from app.connector.describe import DESCRIBERS, Describer
from app.connector.schema import plan_for

Tier = Literal["read", "write", "approve"]

# The custom tools (no route of their own) live in `dispatch.CUSTOM_TOOLS`.
CUSTOM = "CUSTOM"


@dataclass(frozen=True)
class ToolDef:
    name: str
    tier: Tier
    method: str
    path: str
    title: str
    description: str = ""

    @property
    def scope(self) -> str:
        return "finance_read" if self.tier == "read" else "finance_write"

    @property
    def describer(self) -> Describer | None:
        return DESCRIBERS.get(self.name)


def _tools(tier: Tier, rows: list[tuple[str, str, str, str]]) -> list[ToolDef]:
    return [ToolDef(name, tier, method, path, title) for name, method, path, title in rows]


READ = _tools("read", [
    ("yieldo_lire_profil", "GET", "/auth/me", "Le compte connecté : nom, email, rôle."),
    ("yieldo_lire_comptes", "GET", "/accounts", "Les comptes bancaires du foyer."),
    ("yieldo_lire_soldes", "GET", "/accounts/balance", "Le solde de chaque compte."),
    ("yieldo_lire_imports", "GET", "/imports",
     "Les relevés importés, du plus récent au plus ancien."),
    ("yieldo_lire_dernier_import", "GET", "/imports/last", "Le dernier import et sa date."),
    ("yieldo_lire_imports_prepares", "GET", "/imports/pending",
     "Les relevés préparés par le connecteur, en attente du foyer."),
    ("yieldo_lire_profils_import", "GET", "/imports/profiles",
     "Les profils de colonnes enregistrés."),
    ("yieldo_lire_transactions", "GET", "/transactions",
     "Les transactions, paginées ; `search` cherche dans le libellé, le montant, la catégorie, "
     "le compte et la date."),
    ("yieldo_lire_categories", "GET", "/categories", "L'arbre des catégories et leurs plafonds."),
    ("yieldo_lire_regles", "GET", "/rules", "Les règles de catégorisation, intégrées et du foyer."),
    ("yieldo_lire_inflation", "GET", "/analysis/inflation", "L'inflation du foyer par catégorie."),
    ("yieldo_lire_anomalies", "GET", "/analysis/anomalies",
     "Les dépenses inhabituelles détectées."),
    ("yieldo_lire_indice_prix", "GET", "/analysis/price-index", "L'indice des prix enregistré."),
    ("yieldo_lire_series", "GET", "/analytics/series", "Entrées et sorties mois par mois."),
    ("yieldo_lire_repartition", "GET", "/analytics/categories", "La dépense par catégorie."),
    ("yieldo_lire_resume", "GET", "/analytics/summary", "Le résumé de la période."),
    ("yieldo_lire_calendrier", "GET", "/analytics/calendar", "La dépense jour par jour."),
    ("yieldo_lire_budgets", "GET", "/budgets", "Les budgets du mois : plafond, dépensé, reste."),
    ("yieldo_lire_historique_budgets", "GET", "/budgets/history", "Les budgets mois après mois."),
    ("yieldo_lire_univers", "GET", "/budgets/{category_id}/detail",
     "Une catégorie en détail : mois, mois ordinaire, années, sous-catégories."),
    ("yieldo_lire_recurrences", "GET", "/recurrences",
     "Les dépenses et revenus récurrents détectés."),
    ("yieldo_lire_recurrences_declarees", "GET", "/recurrences/declared",
     "Les récurrences déclarées par le foyer."),
    ("yieldo_lire_calendrier_recurrences", "GET", "/recurrences/calendar",
     "Les échéances à venir des récurrences."),
    ("yieldo_lire_mises_a_l_ecart", "GET", "/recurrences/dismissals", "Les détections écartées."),
    ("yieldo_lire_plan", "GET", "/plan", "Les lignes du plan prévisionnel."),
    ("yieldo_lire_apercu_plan", "GET", "/plan/preview", "Ce que le plan prévoit, mois par mois."),
    ("yieldo_lire_mode_lecture", "GET", "/plan/mode",
     "La lecture des chiffres : réel, estimé ou mixte."),
    ("yieldo_lire_evenements", "GET", "/planned-events", "Les événements ponctuels prévus."),
    ("yieldo_lire_runs_agent", "GET", "/agent/runs", "Les exécutions de l'agent interne."),
    ("yieldo_lire_propositions", "GET", "/agent/proposals", "Les propositions de l'agent interne."),
    ("yieldo_lire_tresorerie", "GET", "/cashflow/forecast", "La prévision de trésorerie."),
    ("yieldo_lire_autonomie", "GET", "/cashflow/runway", "Combien de mois le disponible tient."),
    ("yieldo_lire_avenir", "GET", "/outlook",
     "Avenir : le solde projeté jour par jour, sa bande P10/P90, le point bas et le risque."),
    ("yieldo_lire_fiabilite", "GET", "/outlook/reliability",
     "La fiabilité de la projection, rejouée sur l'historique du foyer."),
    ("yieldo_lire_remboursement", "GET", "/debts/payoff", "Le plan de remboursement des dettes."),
    ("yieldo_lire_dettes", "GET", "/debts", "Les dettes et crédits."),
    ("yieldo_lire_objectifs", "GET", "/goals", "Les objectifs d'épargne."),
    ("yieldo_lire_contexte_faisabilite", "GET", "/feasibility/context",
     "Les chiffres du foyer qui servent à la faisabilité."),
    ("yieldo_lire_scenarios", "GET", "/feasibility/scenarios", "Les scénarios enregistrés."),
    ("yieldo_lire_contexte_simulateurs", "GET", "/simulators/context",
     "Les chiffres du foyer qui servent aux simulateurs."),
    ("yieldo_lire_defis", "GET", "/engagement", "Santé financière, défis et progrès."),
    ("yieldo_lire_instruments", "GET", "/portfolio/instruments", "Les instruments connus."),
    ("yieldo_lire_comptes_titres", "GET", "/portfolio/accounts", "Les comptes d'investissement."),
    ("yieldo_lire_positions", "GET", "/portfolio/positions", "Les positions détenues."),
    ("yieldo_lire_lots", "GET", "/portfolio/lots", "Les lots d'achat des positions."),
    ("yieldo_lire_valorisation", "GET", "/portfolio/valuation", "La valeur du portefeuille."),
    ("yieldo_lire_patrimoine", "GET", "/portfolio/networth", "Le patrimoine net."),
    ("yieldo_lire_cibles", "GET", "/portfolio/targets", "Les cibles d'allocation."),
    ("yieldo_lire_allocation", "GET", "/portfolio/allocation", "L'allocation face à ses cibles."),
    ("yieldo_lire_projection", "GET", "/projection", "La projection de patrimoine à long terme."),
    ("yieldo_lire_conversations", "GET", "/chat/conversations",
     "Les conversations avec l'assistant."),
    ("yieldo_lire_chat", "GET", "/chat", "Les messages d'une conversation avec l'assistant."),
    ("yieldo_lire_options_export", "GET", "/export/options", "Ce que l'export sait produire."),
    ("yieldo_lire_modeles_export", "GET", "/export/templates", "Les modèles d'export."),
    ("yieldo_lire_alertes", "GET", "/alerts", "Les alertes et leurs seuils."),
    ("yieldo_lire_nombre_alertes", "GET", "/alerts/count", "Le nombre d'alertes actives."),
    ("yieldo_rechercher", "GET", "/search",
     "La recherche globale : transactions, comptes, catégories, récurrences, objectifs, dettes."),
    ("yieldo_invest_profils", "GET", "/invest/policy/profils", "Les profils de risque du mandat."),
    ("yieldo_invest_contrat", "GET", "/invest/oversight/contrat",
     "Le contrat du pilotage : règles déclarées, règles de risque, questions posées au modèle."),
    ("yieldo_invest_etat", "GET", "/invest/oversight/etat",
     "L'état du pilotage de l'investissement."),
    ("yieldo_invest_journal", "GET", "/invest/oversight/journal",
     "Le journal chaîné du pilotage, avec sa vérification d'intégrité."),
    ("yieldo_invest_journees", "GET", "/invest/sessions", "Les journées simulées."),
    ("yieldo_invest_journee", "GET", "/invest/sessions/{session_id}",
     "Une journée simulée en détail."),
    ("yieldo_invest_decisions", "GET", "/invest/decisions", "Les décisions du modèle."),
    ("yieldo_invest_decision", "GET", "/invest/decisions/{decision_id}",
     "Une décision avec les chiffres exacts montrés au modèle."),
    ("yieldo_invest_ordres", "GET", "/invest/orders", "Les ordres passés."),
    ("yieldo_invest_avoirs", "GET", "/invest/avoirs",
     "Ce que le foyer détient réellement chez ses courtiers : liquidités et positions, lues "
     "en direct, sans passer d'ordre."),
    ("yieldo_invest_vue", "GET", "/invest/overview",
     "La vue d'ensemble : P&L, calibration, entonnoir."),
    ("yieldo_avenir_scenario", "POST", "/outlook/scenario",
     "« Et si… » : la projection avec des ajustements, rien n'est enregistré."),
    ("yieldo_faisabilite", "POST", "/feasibility",
     "La faisabilité d'un projet, rien n'est enregistré."),
    ("yieldo_simuler_credit", "POST", "/simulators/credit", "Simuler un crédit."),
    ("yieldo_simuler_epargne", "POST", "/simulators/epargne", "Simuler une épargne."),
    ("yieldo_simuler_immobilier", "POST", "/simulators/immobilier", "Simuler un achat immobilier."),
])

WRITE = _tools("write", [
    ("yieldo_creer_transaction", "POST", "/transactions",
     "Ajouter une transaction saisie à la main."),
    ("yieldo_corriger_transaction", "PATCH", "/transactions/{transaction_id}",
     "Catégoriser ou corriger une transaction (catégorie, note, virement)."),
    ("yieldo_creer_categorie", "POST", "/categories", "Créer une catégorie."),
    ("yieldo_modifier_categorie", "PATCH", "/categories/{category_id}",
     "Modifier une catégorie, son plafond mensuel compris."),
    ("yieldo_creer_regle", "POST", "/rules",
     "Créer une règle du foyer : un fragment du libellé envoie vers une catégorie."),
    ("yieldo_modifier_regle", "PATCH", "/rules/{rule_id}", "Modifier une règle du foyer."),
    ("yieldo_declarer_recurrence", "POST", "/recurrences/declared", "Déclarer une récurrence."),
    ("yieldo_modifier_recurrence", "PATCH", "/recurrences/declared/{declaration_id}",
     "Modifier une récurrence déclarée."),
    ("yieldo_pointer_echeance", "POST", "/recurrences/declared/{declaration_id}/checkins",
     "Pointer une échéance d'une récurrence déclarée."),
    ("yieldo_ecarter_detection", "POST", "/recurrences/dismissals",
     "Écarter une récurrence détectée."),
    ("yieldo_creer_ligne_plan", "POST", "/plan", "Ajouter une ligne au plan prévisionnel."),
    ("yieldo_modifier_ligne_plan", "PATCH", "/plan/{line_id}", "Modifier une ligne du plan."),
    ("yieldo_creer_evenement", "POST", "/planned-events", "Ajouter un événement ponctuel prévu."),
    ("yieldo_modifier_evenement", "PATCH", "/planned-events/{event_id}",
     "Modifier un événement prévu."),
    ("yieldo_refuser_proposition", "POST", "/agent/proposals/{proposal_id}/refuse",
     "Refuser une proposition de l'agent interne."),
    ("yieldo_creer_dette", "POST", "/debts", "Ajouter une dette ou un crédit."),
    ("yieldo_modifier_dette", "PATCH", "/debts/{debt_id}", "Modifier une dette."),
    ("yieldo_creer_objectif", "POST", "/goals", "Créer un objectif d'épargne."),
    ("yieldo_modifier_objectif", "PATCH", "/goals/{goal_id}", "Modifier un objectif."),
    ("yieldo_accepter_defi", "POST", "/engagement/challenges/{challenge_id}/accept",
     "Accepter un défi."),
    ("yieldo_refuser_defi", "POST", "/engagement/challenges/{challenge_id}/reject",
     "Refuser un défi."),
    ("yieldo_regler_cibles", "PUT", "/portfolio/targets",
     "Remplacer les cibles d'allocation (le total doit faire 100 %)."),
    ("yieldo_demander", "POST", "/chat",
     "Poser une question à l'assistant déterministe de Yieldo."),
    ("yieldo_regler_alertes", "PUT", "/alerts/settings", "Régler les seuils d'alerte."),
    ("yieldo_invest_rejouer", "POST", "/invest/oversight/replay/{decision_id}",
     "Rejouer une décision du modèle sur ses entrées enregistrées."),
    ("yieldo_invest_arreter", "POST", "/invest/oversight/halt",
     "Arrêter le pilotage de l'investissement (le relancer demande le foyer)."),
    ("yieldo_import_preparer", "POST", CUSTOM,
     "Préparer l'import d'un relevé CSV : il est analysé et rangé dans Imports, où le foyer "
     "confirme les colonnes. Rien n'est importé avant."),
])

APPROVE = _tools("approve", [
    ("yieldo_creer_compte", "POST", "/accounts", "Créer un compte bancaire."),
    ("yieldo_modifier_compte", "PATCH", "/accounts/{account_id}",
     "Modifier un compte, son solde d'ouverture compris."),
    ("yieldo_supprimer_compte", "DELETE", "/accounts/{account_id}", "Supprimer un compte."),
    ("yieldo_annuler_import", "DELETE", "/imports/{batch_id}", "Annuler un import et ses lignes."),
    ("yieldo_ecarter_import_prepare", "DELETE", "/imports/pending/{pending_id}",
     "Écarter un relevé préparé, sans l'importer."),
    ("yieldo_creer_profil_import", "POST", "/imports/profiles",
     "Enregistrer un profil de colonnes."),
    ("yieldo_supprimer_profil_import", "DELETE", "/imports/profiles/{profile_id}",
     "Supprimer un profil de colonnes."),
    ("yieldo_supprimer_transaction", "DELETE", "/transactions/{transaction_id}",
     "Supprimer une transaction."),
    ("yieldo_supprimer_categorie", "DELETE", "/categories/{category_id}",
     "Supprimer une catégorie (ses transactions deviennent non catégorisées)."),
    ("yieldo_supprimer_regle", "DELETE", "/rules/{rule_id}", "Supprimer une règle du foyer."),
    ("yieldo_indice_prix_insee", "POST", "/analysis/price-index/insee",
     "Charger l'indice des prix de l'INSEE."),
    ("yieldo_regler_indice_prix", "PUT", "/analysis/price-index", "Remplacer l'indice des prix."),
    ("yieldo_supprimer_recurrence", "DELETE", "/recurrences/declared/{declaration_id}",
     "Supprimer une récurrence déclarée."),
    ("yieldo_depointer_echeance", "DELETE",
     "/recurrences/declared/{declaration_id}/checkins/{due_on}",
     "Retirer le pointage d'une échéance."),
    ("yieldo_retablir_detection", "DELETE", "/recurrences/dismissals/{dismissal_id}",
     "Rétablir une détection écartée."),
    ("yieldo_supprimer_ligne_plan", "DELETE", "/plan/{line_id}", "Supprimer une ligne du plan."),
    ("yieldo_plan_depuis_recurrences", "POST", "/plan/from-recurrences",
     "Créer des lignes de plan depuis les récurrences."),
    ("yieldo_changer_lecture", "PUT", "/plan/mode",
     "Changer la lecture des chiffres (réel, estimé, mixte) pour toute l'application."),
    ("yieldo_supprimer_evenement", "DELETE", "/planned-events/{event_id}",
     "Supprimer un événement prévu."),
    ("yieldo_appliquer_proposition", "POST", "/agent/proposals/{proposal_id}/apply",
     "Appliquer une proposition de l'agent interne."),
    ("yieldo_supprimer_proposition", "DELETE", "/agent/proposals/{proposal_id}",
     "Supprimer une proposition de l'agent interne."),
    ("yieldo_supprimer_dette", "DELETE", "/debts/{debt_id}", "Supprimer une dette."),
    ("yieldo_supprimer_objectif", "DELETE", "/goals/{goal_id}", "Supprimer un objectif."),
    ("yieldo_enregistrer_scenario", "POST", "/feasibility/scenarios",
     "Enregistrer un scénario de faisabilité."),
    ("yieldo_supprimer_scenario", "DELETE", "/feasibility/scenarios/{scenario_id}",
     "Supprimer un scénario."),
    ("yieldo_creer_instrument", "POST", "/portfolio/instruments", "Ajouter un instrument."),
    ("yieldo_creer_compte_titres", "POST", "/portfolio/accounts",
     "Créer un compte d'investissement."),
    ("yieldo_modifier_compte_titres", "PATCH", "/portfolio/accounts/{account_id}",
     "Modifier un compte d'investissement."),
    ("yieldo_supprimer_compte_titres", "DELETE", "/portfolio/accounts/{account_id}",
     "Supprimer un compte d'investissement."),
    ("yieldo_creer_position", "POST", "/portfolio/positions", "Ajouter une position."),
    ("yieldo_supprimer_position", "DELETE", "/portfolio/positions/{position_id}",
     "Supprimer une position."),
    ("yieldo_creer_lot", "POST", "/portfolio/lots", "Ajouter un lot d'achat."),
    ("yieldo_modifier_lot", "PATCH", "/portfolio/lots/{lot_id}", "Modifier un lot."),
    ("yieldo_supprimer_lot", "DELETE", "/portfolio/lots/{lot_id}", "Supprimer un lot."),
    ("yieldo_effacer_chat", "DELETE", "/chat", "Effacer l'historique de l'assistant."),
    ("yieldo_exporter", "POST", "/export", "Générer un document d'export."),
    ("yieldo_invest_tour", "POST", "/invest/run",
     "Lancer un tour de pilotage. Refusé par Yieldo quand le mandat est en exécution réelle."),
])

CATALOG: dict[str, ToolDef] = {tool.name: tool for tool in (*READ, *WRITE, *APPROVE)}

_SESSION = "demande une session : identifiants, brokers ou mandat"

NEVER: dict[tuple[str, str], str] = {
    ("POST", "/auth/register"): "créer un compte n'est pas une opération du foyer",
    ("POST", "/auth/login"): "le connecteur a sa clé, il ne se connecte pas",
    ("POST", "/auth/refresh"): "le connecteur a sa clé, il ne se connecte pas",
    ("POST", "/auth/logout"): "le connecteur a sa clé, il ne se connecte pas",
    ("PATCH", "/auth/me"): _SESSION,
    ("POST", "/auth/password"): _SESSION,
    ("POST", "/auth/sessions/revoke-others"): _SESSION,
    ("PATCH", "/admin/settings"): _SESSION,
    ("POST", "/access-key/rotate"): _SESSION,
    ("DELETE", "/access-key"): _SESSION,
    ("POST", "/connector-key"): _SESSION,
    ("DELETE", "/connector-key"): _SESSION,
    ("POST", "/connections/{provider}"): _SESSION,
    ("DELETE", "/connections/{provider}"): _SESSION,
    ("PUT", "/assistant/llm-settings"): "la clé du modèle de langage est un identifiant",
    ("DELETE", "/assistant/llm-settings"): "la clé du modèle de langage est un identifiant",
    ("POST", "/assistant/llm"): "Claude ne pilote pas un autre modèle de langage",
    ("POST", "/agent/run"): "Claude ne pilote pas l'agent interne",
    ("POST", "/imports/analyze"): "fichier en multipart : yieldo_import_preparer le remplace",
    ("POST", "/imports/commit"): "les colonnes d'un import sont confirmées par le foyer, à l'écran",
    ("POST", "/export/download"): "un fichier, pas une réponse",
    ("POST", "/invest/venues"): _SESSION,
    ("POST", "/invest/venues/{venue_id}/verifier"): _SESSION,
    ("DELETE", "/invest/venues/{venue_id}"): _SESSION,
    ("PUT", "/invest/policy"): _SESSION,
    ("POST", "/invest/policy/arm"): _SESSION,
    ("POST", "/invest/policy/disarm"): _SESSION,
    ("POST", "/invest/policy/resume"): _SESSION,
    ("PUT", "/invest/model"): _SESSION,
    ("DELETE", "/invest/model"): _SESSION,
    ("POST", "/invest/model/apprendre"): _SESSION,
    ("POST", "/invest/sessions"): _SESSION,
    ("POST", "/invest/sessions/{session_id}/stop"): _SESSION,
    ("POST", "/invest/sandbox/reset"): _SESSION,
}


def input_schema(tool: ToolDef) -> dict[str, Any]:
    if tool.path == CUSTOM:
        from app.connector.dispatch import CUSTOM_TOOLS

        return CUSTOM_TOOLS[tool.name].schema
    return plan_for(tool.method, tool.path).schema


@cache
def catalog_payload() -> dict[str, Any]:
    """What `GET /api/connector/tools` answers, fingerprint included. Built
    once per process: the catalogue only changes with a deployment."""
    tools = [
        {
            "name": tool.name,
            "title": tool.title,
            "description": tool.description or tool.title,
            "tier": tool.tier,
            "scope": tool.scope,
            "input_schema": input_schema(tool),
        }
        for tool in CATALOG.values()
    ]
    encoded = json.dumps(tools, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return {"fingerprint": hashlib.sha256(encoded).hexdigest(), "tools": tools}


def fingerprint() -> str:
    return catalog_payload()["fingerprint"]
