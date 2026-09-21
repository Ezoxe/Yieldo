import type { DecisionOutcome, InvestAutonomy, InvestMode } from "../../lib/types";

/**
 * The French for every identifier the API returns, in one place.
 *
 * The backend returns stable identifiers (`volatility_ceiling`, `not_armed`,
 * `held`) beside a French sentence it already built. The sentence is printed
 * verbatim — the backend owns every user-facing sentence, per CLAUDE.md. What
 * this module adds is the SHORT word a badge, a filter chip or a legend needs,
 * which no sentence can supply.
 *
 * It is data rather than a chain of ternaries so a rule the backend adds and
 * this file has not learned yet falls back to the identifier instead of
 * disappearing: an unlabelled rule on screen is a bug someone reports, a
 * missing one is a rule nobody knows fired.
 */

export const OUTCOME_LABELS: Record<DecisionOutcome, string> = {
  skipped: "Écarté avant le modèle",
  held: "Aucune action",
  refused: "Refusé par le mandat",
  ordered: "Ordre transmis",
  failed: "En échec",
};

export const OUTCOME_SHORT: Record<DecisionOutcome, string> = {
  skipped: "Écarté",
  held: "Sans action",
  refused: "Refusé",
  ordered: "Ordre",
  failed: "Échec",
};

/**
 * Which accent each outcome carries. Functional, per the design tokens:
 * emerald for an order that went through, rose for a failure, amber for a
 * refusal (a ceiling in reach), blue for a standing condition, neutral for a
 * decision that simply did nothing.
 */
export const OUTCOME_TONE: Record<DecisionOutcome, "positive" | "negative" | "warning" | "info" | "neutral"> = {
  skipped: "neutral",
  held: "info",
  refused: "warning",
  ordered: "positive",
  failed: "negative",
};

export const AUTONOMY_LABELS: Record<InvestAutonomy, string> = {
  observer: "Observation",
  paper: "Papier",
  live: "Réel",
};

export const AUTONOMY_EXPLAINED: Record<InvestAutonomy, string> = {
  observer:
    "Le modèle est interrogé et les ordres sont dimensionnés, mais rien n'est transmis. "
    + "Vous voyez exactement ce qui aurait été fait.",
  paper:
    "Les ordres partent vers un courtier en mode simulé. De l'argent fictif, un vrai "
    + "carnet d'ordres.",
  live:
    "Les ordres partent vers le marché réel, avec votre argent, dans les limites du "
    + "mandat et seulement pendant que l'exécution est armée.",
};

export const MODE_LABELS: Record<InvestMode, string> = {
  paper: "Papier",
  live: "Réel",
};

/** The venue identifiers the backend knows, and what to call them on screen. */
export const VENUE_LABELS: Record<string, string> = {
  internal: "Carnet simulé de Yieldo",
  alpaca: "Alpaca",
  kraken: "Kraken",
  binance: "Binance",
};

export const PRICE_SOURCE_LABELS: Record<string, string> = {
  venue: "Les cours du courtier",
  synthetic: "Marché synthétique (toujours ouvert)",
  market: "Les cours enregistrés par Yieldo",
};

export const PROVIDER_LABELS: Record<string, string> = {
  local: "Modèle auto-hébergé",
  jev: "Jev (TypeSafe)",
  replay: "Moteur déterministe intégré",
};

/** The short word for a risk rule or a skip rule. */
export const RULE_LABELS: Record<string, string> = {
  // Permission rules
  halted: "À l'arrêt",
  not_armed: "Non armé",
  observer_mode: "Mode observation",
  unknown_side: "Sens inconnu",
  unknown_order_type: "Type inconnu",
  side_not_allowed: "Sens non autorisé",
  order_type_not_allowed: "Type non autorisé",
  symbol_not_allowed: "Hors liste blanche",
  limit_price_missing: "Limite absente",
  short_not_allowed: "Découvert interdit",
  sell_exceeds_position: "Vente > position",
  leverage_not_allowed: "Levier interdit",
  non_positive_quantity: "Quantité nulle",
  // Standing conditions
  daily_loss_ceiling: "Perte du jour",
  drawdown_ceiling: "Repli maximal",
  orders_per_day: "Ordres du jour",
  // Size rules
  order_notional_ceiling: "Plafond par ordre",
  position_ceiling: "Plafond par position",
  exposure_ceiling: "Plafond d'exposition",
  cash_buffer: "Réserve de liquidités",
  reduced_to_nothing: "Réduit à néant",
  below_minimum_notional: "Sous le minimum",
  // Strategy skips and gates
  volatility_ceiling: "Volatilité trop forte",
  no_price: "Cours indisponible",
  hold: "Ne rien faire",
  no_conviction: "Conviction absente",
  conviction_threshold: "Conviction insuffisante",
  no_probability: "Probabilité absente",
  probability_threshold: "Probabilité insuffisante",
  budget_too_small: "Budget trop faible",
  sale_too_small: "Vente trop faible",
  nothing_held: "Rien en portefeuille",
  insufficient_history: "Historique trop court",
  // Failure causes
  no_model: "Aucun modèle",
  model_rejected: "Modèle refusé",
  service_unreachable: "Service injoignable",
  too_slow: "Trop lent",
  off_contract: "Hors contrat",
  no_credentials: "Aucune clé",
  credentials_rejected: "Clé refusée",
  unknown_symbol: "Instrument inconnu",
  rejected_by_venue: "Refusé par le courtier",
};

export const ORDER_STATUS_LABELS: Record<string, string> = {
  refused: "Refusé",
  pending: "En attente",
  filled: "Exécuté",
  cancelled: "Annulé",
  failed: "Échec",
};

export const JOURNAL_KIND_LABELS: Record<string, string> = {
  policy_changed: "Mandat modifié",
  venue_added: "Courtier connecté",
  venue_removed: "Courtier supprimé",
  venue_mode_changed: "Mode du courtier modifié",
  model_changed: "Modèle de décision modifié",
  armed: "Exécution réelle armée",
  disarmed: "Exécution réelle désarmée",
  halted: "Pilotage arrêté",
  resumed: "Pilotage relancé",
  decision: "Décision",
  order_refused: "Ordre refusé",
  order_sent: "Ordre transmis",
  order_filled: "Ordre exécuté",
  order_failed: "Ordre en échec",
  sandbox_reset: "Bac à sable remis à zéro",
};

export const ACTOR_LABELS: Record<string, string> = {
  session: "Vous, depuis Yieldo",
  agent: "Une clé d'accès",
  system: "Le pilotage",
};

/** Falls back to the identifier rather than to nothing. */
export function labelFor(table: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "—";
  return table[key] ?? key;
}
