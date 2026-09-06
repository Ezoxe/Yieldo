/**
 * The operator's own answer, read straight off a running
 * `POST /api/feasibility` against the seeded fixture on 2026-08-30 — not
 * hand-written, and not copied from the plan.
 *
 * Shared by every test on this screen so no two of them can disagree about what
 * the backend actually returns. A test file that invents its own figures proves
 * only that the component renders SOMETHING; these prove it renders the answer.
 */
import type {
  Feasibility,
  FeasibilityContext,
  MeasuredRate,
  OwnershipDefaults,
} from "../../lib/types";

export const OPERATOR_CAPACITY: MeasuredRate = {
  months: 3,
  median_cents: -74_619,
  spread_cents: 213_078,
  low_cents: -347_690,
  high_cents: 198_452,
};

export const OPERATOR_EXPENSE: MeasuredRate = {
  months: 3,
  median_cents: 265_449,
  spread_cents: 221_457,
  low_cents: -18_360,
  high_cents: 549_258,
};

export const OPERATOR_INCOME: MeasuredRate = {
  months: 3,
  median_cents: 47_111,
  spread_cents: 40_002,
  low_cents: -4_154,
  high_cents: 98_376,
};

export const OPERATOR_HISTORY = {
  date_from: "2025-01-24",
  date_to: "2026-01-09",
  transaction_count: 197,
};

export const OPERATOR_ASSUMPTIONS = {
  annual_return_bps: 300,
  loan_rate_bps: 500,
  loan_months: 60,
  ownership_years: 5,
  monthly_income_cents: 47_111,
  existing_debt_payments_cents: 0,
};

/** `GET /api/feasibility/context`'s own `ownership_defaults`, verbatim — the
 *  French averages `engines/ownership.defaults_for` carries, in the shape the
 *  POST accepts back. Note the two shapes: a flat monthly amount, and a
 *  percentage of the asset's remaining value per year. Exactly one is set on
 *  each item, and the engine refuses both or neither in French. */
export const OWNERSHIP_DEFAULTS: Record<string, OwnershipDefaults> = {
  vehicle: {
    items: [
      { key: "insurance", label: "Assurance", monthly_cents: 6_500, annual_bps_of_value: null },
      {
        key: "maintenance",
        label: "Entretien et réparations",
        monthly_cents: 7_000,
        annual_bps_of_value: null,
      },
      { key: "fuel", label: "Carburant", monthly_cents: 13_000, annual_bps_of_value: null },
    ],
    depreciation_bps_per_year: 1_500,
    label: "Véhicule",
    note: "Assurance, entretien et carburant préremplis. Décote de 15 % par an.",
    ownership_years: 5,
  },
  property: {
    items: [
      {
        key: "property_tax",
        label: "Taxe foncière",
        monthly_cents: null,
        annual_bps_of_value: 90,
      },
      {
        key: "charges",
        label: "Charges de copropriété",
        monthly_cents: 15_000,
        annual_bps_of_value: null,
      },
      {
        key: "home_insurance",
        label: "Assurance habitation",
        monthly_cents: 2_500,
        annual_bps_of_value: null,
      },
      { key: "upkeep", label: "Entretien", monthly_cents: null, annual_bps_of_value: 100 },
    ],
    depreciation_bps_per_year: 0,
    label: "Immobilier",
    note: "Taxe foncière, charges, assurance et entretien préremplis. Aucune décote.",
    ownership_years: 5,
  },
  // No running cost at all, on purpose: `NATURE_PROFILES` invents no average
  // for a laptop's electricity any more than for a sofa's insurance.
  tech: {
    items: [],
    depreciation_bps_per_year: 3_500,
    label: "High-tech et équipement",
    note: "Décote de 35 % par an sur trois ans. Aucun coût d'usage prérempli.",
    ownership_years: 3,
  },
  other: {
    items: [],
    depreciation_bps_per_year: 0,
    label: "Autre",
    note: "Rien n'est prérempli et rien n'est supposé.",
    ownership_years: 5,
  },
};

export const OPERATOR_CONTEXT: FeasibilityContext = {
  capacity: OPERATOR_CAPACITY,
  expense_rate: OPERATOR_EXPENSE,
  income_rate: OPERATOR_INCOME,
  months_observed: 3,
  history: OPERATOR_HISTORY,
  balance_cents: -220_963,
  existing_debt_payments_cents: 0,
  assumptions: OPERATOR_ASSUMPTIONS,
  ownership_defaults: OWNERSHIP_DEFAULTS,
  natures: ["vehicle", "property", "other"],
  default_ownership_years: 5,
  default_annual_return_bps: 300,
};

/** 40 000 € · 12 mois · apport 0 · véhicule. */
export const OPERATOR_REPORT: Feasibility = {
  target_cents: 4_000_000,
  horizon_months: 12,
  down_payment_cents: 0,
  nature: "vehicle",
  horizon_end_on: "2027-08-31",
  // 40 000 € en 12 mois, apport nul, à 3 %/an.
  required_monthly_cents: 328_312,
  // Sa capacité mesurée est négative : la somme n'est jamais atteinte.
  months_at_measured_capacity: null,
  assumptions: OPERATOR_ASSUMPTIONS,
  capacity: OPERATOR_CAPACITY,
  capacity_unavailable_reason: null,
  months_observed: 3,
  history: OPERATOR_HISTORY,
  balance_cents: -220_963,
  verdict: "out_of_reach",
  saved_at_horizon_cents: -895_428,
  saved_at_horizon_low_cents: -4_172_280,
  saved_at_horizon_high_cents: 2_414_442,
  gap_cents: 4_895_428,
  opportunity_cost_cents: 646_466,
  opportunity_horizon_months: 60,
  ownership: {
    price_cents: 4_000_000,
    years: 5,
    lines: [
      { key: "insurance", label: "Assurance", total_cents: 390_000, monthly_average_cents: 6_500 },
      {
        key: "maintenance",
        label: "Entretien et réparations",
        total_cents: 420_000,
        monthly_average_cents: 7_000,
      },
      { key: "fuel", label: "Carburant", total_cents: 780_000, monthly_average_cents: 13_000 },
    ],
    depreciation_cents: 2_225_179,
    residual_value_cents: 1_774_821,
    running_cost_cents: 1_590_000,
    total_cost_cents: 3_815_179,
    monthly_average_cents: 63_586,
  },
  impact: {
    emergency: {
      runway_months_before: 0.0,
      runway_months_after: 0.0,
      // The measured expense rate's median: 2 654,49 € a month.
      monthly_burn_cents: 265_449,
      unavailable_reason: null,
    },
    liquid_in_five_years_before_cents: -4_698_103,
    liquid_in_five_years_after_cents: -8_698_103,
    liquid_unavailable_reason: null,
  },
  // FEASIBLE FIRST, which on this household puts `borrow` second and `delay`
  // third — not the documented tie-break order, and the screen must not assume
  // it. Exactly the order `build_levers` returned.
  levers: [
    {
      kind: "save_more",
      feasible: true,
      unavailable_reason: null,
      note:
        "Ce montant comprend le retour à l'équilibre : votre capacité d'épargne mesurée est " +
        "actuellement un déficit, et il faut d'abord le combler avant de mettre quoi que ce soit " +
        "de côté.",
      extra_monthly_cents: 403_394,
      effort_ratio: null,
      reached_in_months: null,
      delay_months: null,
      reduced_target_cents: null,
      borrow_cents: null,
      loan_payment_cents: null,
      loan_total_interest_cents: null,
      debt_ratio_bps: null,
      debt_ratio_exceeded: false,
      category_id: null,
      category_name: null,
      category_median_cents: null,
      cut_monthly_cents: null,
      months_at_or_below: null,
      months_observed: null,
    },
    {
      kind: "borrow",
      feasible: true,
      unavailable_reason: null,
      note: null,
      extra_monthly_cents: null,
      effort_ratio: null,
      reached_in_months: null,
      delay_months: null,
      reduced_target_cents: null,
      borrow_cents: 4_895_428,
      loan_payment_cents: 92_383,
      loan_total_interest_cents: 647_532,
      debt_ratio_bps: 19_610,
      debt_ratio_exceeded: true,
      category_id: null,
      category_name: null,
      category_median_cents: null,
      cut_monthly_cents: null,
      months_at_or_below: null,
      months_observed: null,
    },
    {
      kind: "delay",
      feasible: false,
      unavailable_reason:
        "Votre capacité d'épargne mesurée est négative ou nulle : attendre n'y change rien, la " +
        "somme mise de côté ne grandit pas avec le temps.",
      note: null,
      extra_monthly_cents: null,
      effort_ratio: null,
      reached_in_months: null,
      delay_months: null,
      reduced_target_cents: null,
      borrow_cents: null,
      loan_payment_cents: null,
      loan_total_interest_cents: null,
      debt_ratio_bps: null,
      debt_ratio_exceeded: false,
      category_id: null,
      category_name: null,
      category_median_cents: null,
      cut_monthly_cents: null,
      months_at_or_below: null,
      months_observed: null,
    },
    {
      kind: "reduce_target",
      feasible: false,
      unavailable_reason:
        "Aucune cible n'est atteignable à l'échéance choisie : au rythme mesuré, la somme mise " +
        "de côté diminue au lieu d'augmenter.",
      note: null,
      extra_monthly_cents: null,
      effort_ratio: null,
      reached_in_months: null,
      delay_months: null,
      reduced_target_cents: null,
      borrow_cents: null,
      loan_payment_cents: null,
      loan_total_interest_cents: null,
      debt_ratio_bps: null,
      debt_ratio_exceeded: false,
      category_id: null,
      category_name: null,
      category_median_cents: null,
      cut_monthly_cents: null,
      months_at_or_below: null,
      months_observed: null,
    },
    {
      kind: "cut_category",
      feasible: false,
      unavailable_reason:
        "Aucune catégorie ne pèse assez pour libérer la somme nécessaire chaque mois. La plus " +
        "lourde, « Loyer », coûte moins que cela un mois normal : la supprimer entièrement ne " +
        "suffirait pas.",
      note: null,
      extra_monthly_cents: null,
      effort_ratio: null,
      reached_in_months: null,
      delay_months: null,
      reduced_target_cents: null,
      borrow_cents: null,
      loan_payment_cents: null,
      loan_total_interest_cents: null,
      debt_ratio_bps: null,
      debt_ratio_exceeded: false,
      category_id: 2,
      category_name: "Loyer",
      category_median_cents: 78_000,
      cut_monthly_cents: null,
      // null even though a category IS named: there is no post-cut level to
      // count against on a refusal.
      months_at_or_below: null,
      months_observed: 1,
    },
  ],
  financing: {
    horizon_months: 60,
    options: [
      {
        kind: "cash",
        available: true,
        unavailable_reason: null,
        out_of_pocket_cents: 4_000_000,
        monthly_cents: 0,
        total_paid_cents: 4_000_000,
        interest_cents: 0,
        wealth_at_end_cents: 4_879_854,
        wealth_unavailable_reason: null,
      },
      {
        kind: "credit",
        available: true,
        unavailable_reason: null,
        out_of_pocket_cents: 0,
        monthly_cents: 75_485,
        total_paid_cents: 4_529_093,
        interest_cents: 529_093,
        wealth_at_end_cents: 4_646_466,
        wealth_unavailable_reason: null,
      },
      {
        kind: "loa",
        available: false,
        unavailable_reason:
          "Aucun loyer de location avec option d'achat n'a été saisi. Ces montants viennent du " +
          "devis du concessionnaire : Yieldo ne les invente pas.",
        out_of_pocket_cents: null,
        monthly_cents: null,
        total_paid_cents: null,
        interest_cents: null,
        wealth_at_end_cents: null,
        wealth_unavailable_reason: null,
      },
    ],
    break_even_rate_bps: 299,
    break_even_reason: null,
    better_kind: "cash",
    wealth_gap_cents: -233_388,
  },
};
