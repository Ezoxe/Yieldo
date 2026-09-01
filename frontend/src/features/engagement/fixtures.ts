/**
 * The operator's own answer from `GET /api/engagement`, measured live against
 * the seeded fixture on 1 September 2026 and copied here field for field.
 *
 * Every panel in this feature is designed for THIS state, not for a healthy
 * one: a streak broken for seven months, a health score of **0** built from
 * three measured components out of four, no goals declared at all, and exactly
 * one challenge — an anomaly. Nothing below is rounded, softened or invented.
 */
import type {
  Challenge,
  Engagement,
  Health,
  HealthComponent,
  MonthCovered,
  Streak,
} from "../../lib/types";

function month(key: string, over: Partial<MonthCovered> = {}): MonthCovered {
  return { key, covered: false, transaction_count: 0, imported: true, ...over };
}

/**
 * Twenty-two months, and all three states are present.
 *
 * 2025-04 through 2025-11 are `imported: true, covered: false` — the import
 * batch's own span reaches them and they simply hold nothing. 2026-02 onward
 * are `imported: false` — no statement has ever touched them. The engine
 * counts the first kind toward the streak and breaks on the second, which is
 * why `longest` is 13 and not 3.
 */
export const OPERATOR_STREAK: Streak = {
  current: 0,
  longest: 13,
  last_complete_month: "2026-01",
  months: [
    month("2025-01", { covered: true, transaction_count: 13 }),
    month("2025-02", { covered: true, transaction_count: 61 }),
    month("2025-03", { covered: true, transaction_count: 20 }),
    month("2025-04"),
    month("2025-05"),
    month("2025-06"),
    month("2025-07"),
    month("2025-08"),
    month("2025-09"),
    month("2025-10"),
    month("2025-11"),
    month("2025-12", { covered: true, transaction_count: 77 }),
    month("2026-01", { covered: true, transaction_count: 26 }),
    month("2026-02", { imported: false }),
    month("2026-03", { imported: false }),
    month("2026-04", { imported: false }),
    month("2026-05", { imported: false }),
    month("2026-06", { imported: false }),
    month("2026-07", { imported: false }),
    month("2026-08", { imported: false }),
    month("2026-09", { imported: false }),
  ],
  broken_reason:
    "Le suivi s'est interrompu : cela fait 7 mois qu'aucun relevé n'a été importé.",
};

/** `engines/health.py`'s `_reason_no_budget_outcomes`, verbatim. */
export const NO_BUDGET_REASON =
  "Aucun budget n'a encore été suivi sur un mois complet : l'adhérence aux budgets ne peut " +
  "pas être mesurée.";

export const OPERATOR_COMPONENTS: HealthComponent[] = [
  {
    key: "savings_rate",
    label: "Taux d'épargne",
    weight: 30,
    // MEASURED, and it landed at the bottom of the scale. Not an absence.
    score: 0,
    measured_value: -1.5838976035320838,
    unavailable_reason: null,
    delta_score: null,
  },
  {
    key: "essential_share",
    label: "Part des dépenses essentielles",
    weight: 25,
    score: 0,
    measured_value: 2.6628388274500647,
    unavailable_reason: null,
    delta_score: null,
  },
  {
    key: "runway",
    label: "Autonomie financière",
    weight: 25,
    score: 0,
    measured_value: 0.0,
    unavailable_reason: null,
    delta_score: null,
  },
  {
    key: "budget_adherence",
    label: "Adhérence aux budgets",
    weight: 20,
    // UNMEASURABLE. Never drawn as the row above it.
    score: null,
    measured_value: null,
    unavailable_reason: NO_BUDGET_REASON,
    delta_score: null,
  },
];

export const OPERATOR_HEALTH: Health = {
  score: 0,
  components: OPERATOR_COMPONENTS,
  unavailable_reason: null,
  previous_taken_on: null,
  score_delta: null,
  history: [{ taken_on: "2026-09-01", score: 0 }],
};

/** The single challenge his 197 transactions actually produced. */
export const OPERATOR_CHALLENGE: Challenge = {
  id: 1,
  kind: "anomaly",
  title: "Dépense inhabituelle : CARTE X1234 FNAC DARTY",
  detail:
    "Cette opération s'écarte fortement de l'historique de sa catégorie, mesuré sur 17 " +
    "opérations.",
  target_cents: 16814,
  category_id: 38,
  proposed_on: "2026-09-01",
  state: "proposed",
  decided_on: null,
  measured_cents: null,
  measured_on: null,
  outcome_unavailable_reason: null,
};

export const OPERATOR_ENGAGEMENT: Engagement = {
  streak: OPERATOR_STREAK,
  // He has declared none. The milestone panel's own empty state is his state.
  goals: [],
  health: OPERATOR_HEALTH,
  challenges: [OPERATOR_CHALLENGE],
};
