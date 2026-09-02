/**
 * Two `GET /api/projection` bodies, both taken from what the real API returns.
 *
 * `OPERATOR_PROJECTION` is the operator's ACTUAL state — zero positions, a
 * measured savings capacity of −746,19 €/month — where all four engines refuse.
 * It is the first fixture in this file on purpose: a screen only tested on a
 * healthy fixture is defect class 5 on this project's own list, and this is the
 * state the operator opens every day.
 *
 * `RICH_PROJECTION` is the same screen with a real portfolio behind it, so the
 * fan chart, the FIRE timeline, the four tax regimes and the three stress
 * scenarios are all exercised.
 */
import type { Projection, StressShock } from "../../lib/types";

const SHOCKS: StressShock[] = [
  {
    key: "2008",
    label: "Crise financière de 2008",
    period: "octobre 2007 - mars 2009",
    source:
      "MSCI World Net Total Return (actions), Bloomberg US Aggregate Bond Index (obligations), FTSE Nareit All Equity REITs (immobilier coté) -- sommet 31 octobre 2007, creux 9 mars 2009 pour les actions et l'immobilier ; rendement total de l'année civile 2008 pour les obligations.",
    impact_bps_by_asset_class: { equity: -5_400, bond: 500, real_estate: -6_800, cash: 0 },
  },
  {
    key: "2020",
    label: "Krach du COVID-19 (2020)",
    period: "février - mars 2020",
    source:
      "MSCI World Net Total Return (actions), Bloomberg US Aggregate Bond Index (obligations, creux intra-mensuel de mars 2020), FTSE Nareit All Equity REITs (immobilier coté), Bitcoin via CoinMarketCap (cryptomonnaies) -- sommet 19 février 2020, creux 23 mars 2020 (13 mars pour le Bitcoin).",
    impact_bps_by_asset_class: {
      equity: -3_400,
      bond: -600,
      real_estate: -4_200,
      crypto: -6_200,
      cash: 0,
    },
  },
  {
    key: "2022",
    label: "Marché baissier de 2022",
    period: "année civile 2022",
    source:
      "MSCI World Net Total Return (actions), Bloomberg US Aggregate Bond Index (obligations), FTSE Nareit All Equity REITs (immobilier coté), Bitcoin via CoinMarketCap (cryptomonnaies) -- rendements totaux de l'année civile 2022.",
    impact_bps_by_asset_class: {
      equity: -1_800,
      bond: -1_300,
      real_estate: -2_400,
      crypto: -6_400,
      cash: 0,
    },
  },
];

const ASSUMPTIONS = {
  seed: 424_242,
  months: 240,
  annual_return_bps: 300,
  annual_volatility_bps: 1_500,
  trials: 1_000,
  withdrawal_rate_bps: 400,
  marginal_rate_bps: null,
  joint_taxation: false,
  reporting_currency: "EUR",
  horizon_end_on: "2046-09-30",
};

export const OPERATOR_PROJECTION: Projection = {
  as_of: "2026-09-02",
  reporting_currency: "EUR",
  assumptions: ASSUMPTIONS,
  // The operator's real figures, read off `GET /api/projection` against the
  // seeded fixture: three complete months, a capacity of −746,19 €/month and a
  // measured spend of 2 654,49 €/month.
  months_observed: 3,
  capacity: {
    months: 3,
    median_cents: -74_619,
    spread_cents: 51_200,
    low_cents: -140_215,
    high_cents: -9_023,
  },
  capacity_unavailable_reason: null,
  expense_rate: {
    months: 3,
    median_cents: 265_449,
    spread_cents: 60_000,
    low_cents: 188_630,
    high_cents: 342_268,
  },
  portfolio: {
    market_value_cents: 0,
    cost_basis_cents: 0,
    unrealised_gain_cents: 0,
    positions_total: 0,
    positions_valued: 0,
    positions_missing_price: 0,
    positions_missing_fx: 0,
    weight_by_asset_class: [],
  },
  monte_carlo: null,
  monte_carlo_unavailable_reason:
    "Aucun capital de départ : vous ne détenez aucune position. Une simulation partant de 0 € ne produirait pas de bande de centiles, seulement une ligne — et une ligne n'est pas une mesure du risque. Saisissez vos comptes, vos positions et leurs lots sur l'écran Patrimoine.",
  fire: {
    target: {
      annual_expenses_cents: 3_185_388,
      withdrawal_rate_bps: 400,
      target_capital_cents: 79_634_700,
    },
    independence: {
      target_capital_cents: 79_634_700,
      current_capital_cents: 0,
      withdrawal_rate_bps: 400,
      annual_return_bps: 300,
      capacity: {
        months: 3,
        median_cents: -74_619,
        spread_cents: 51_200,
        low_cents: -140_215,
        high_cents: -9_023,
      },
      months_to_independence: null,
      independent_on: null,
      unavailable_reason:
        "Votre capacité d'épargne mesurée est négative ou nulle : à ce rythme, l'indépendance financière ne se rapproche pas, elle recule ou stagne. Aucun délai ne peut être avancé tant que la capacité n'est pas redevenue positive.",
    },
    retirement: null,
    retirement_unavailable_reason:
      "Aucune rente ne peut être projetée : votre capital constitué est de 0 €. La phase de retrait suppose un capital déjà là — le délai pour l'atteindre est la ligne au-dessus.",
  },
  fire_unavailable_reason: null,
  tax: null,
  tax_unavailable_reason:
    "Aucune plus-value latente à imposer : vous ne détenez aucune position. La fiscalité française (PFU, barème, PEA, assurance-vie) porte sur un gain, et un gain se calcule à partir des lots — quantité, prix de revient et date d'acquisition. Saisissez-les sur l'écran Patrimoine, avec la date d'ouverture de chaque enveloppe.",
  stress: { shocks: SHOCKS, scenarios: [] },
  stress_unavailable_reason:
    "Aucune classe d'actifs à soumettre à un choc : vous ne détenez aucune position. Appliquer −54 % à un patrimoine vide afficherait −0,00 €, ce qui se lirait comme « mesuré, sans effet » — c'est un chiffre inventé, pas une mesure. Les trois épisodes restent affichés ci-dessous avec leurs périodes et leurs sources. Saisissez vos positions et leur classe d'actifs sur l'écran Patrimoine.",
};

/** Six months of a band whose P10 crosses zero on the fifth — the shape the
 *  fan chart must NOT anchor at zero. */
const POINTS = [
  [980_000, 1_010_000, 1_040_000],
  [720_000, 900_000, 1_080_000],
  [410_000, 800_000, 1_150_000],
  [90_000, 700_000, 1_240_000],
  [-260_000, 600_000, 1_330_000],
  [-640_000, 500_000, 1_420_000],
].map(([low, median, high], index) => ({
  month: index + 1,
  on: `2026-${String(index + 10).padStart(2, "0")}-30`,
  percentiles_cents: { "10": low, "50": median, "90": high },
}));

export const RICH_PROJECTION: Projection = {
  as_of: "2026-09-02",
  reporting_currency: "EUR",
  assumptions: { ...ASSUMPTIONS, months: 6, marginal_rate_bps: 3_000 },
  months_observed: 12,
  capacity: {
    months: 12,
    median_cents: 120_000,
    spread_cents: 30_000,
    low_cents: 81_600,
    high_cents: 158_400,
  },
  capacity_unavailable_reason: null,
  expense_rate: {
    months: 12,
    median_cents: 250_000,
    spread_cents: 40_000,
    low_cents: 198_800,
    high_cents: 301_200,
  },
  portfolio: {
    market_value_cents: 1_000_000,
    cost_basis_cents: 600_000,
    unrealised_gain_cents: 400_000,
    positions_total: 3,
    positions_valued: 2,
    positions_missing_price: 1,
    positions_missing_fx: 0,
    weight_by_asset_class: [
      { key: "equity", value_cents: 700_000, weight: 0.7 },
      { key: "crypto", value_cents: 300_000, weight: 0.3 },
    ],
  },
  monte_carlo: {
    initial_cents: 1_000_000,
    months: 6,
    assumptions: {
      annual_return_bps: 300,
      annual_volatility_bps: 1_500,
      monthly_cents: 120_000,
      trials: 1_000,
      seed: 424_242,
      percentiles: [10, 50, 90],
    },
    points: POINTS,
    horizon_end_on: "2027-03-31",
  },
  monte_carlo_unavailable_reason: null,
  fire: {
    target: {
      annual_expenses_cents: 3_000_000,
      withdrawal_rate_bps: 400,
      target_capital_cents: 75_000_000,
    },
    independence: {
      target_capital_cents: 75_000_000,
      current_capital_cents: 1_000_000,
      withdrawal_rate_bps: 400,
      annual_return_bps: 300,
      capacity: {
        months: 12,
        median_cents: 120_000,
        spread_cents: 30_000,
        low_cents: 81_600,
        high_cents: 158_400,
      },
      months_to_independence: 373,
      independent_on: "2057-10-31",
      unavailable_reason: null,
    },
    retirement: {
      initial_cents: 1_000_000,
      annual_return_bps: 300,
      withdrawal_rate_bps: 400,
      tax_regime: "bareme",
      marginal_rate_bps: 3_000,
      months: 6,
      points: [
        {
          month: 1,
          balance_cents: 999_167,
          gross_withdrawal_cents: 3_333,
          taxable_gain_cents: 8,
          tax_cents: 4,
          net_withdrawal_cents: 3_329,
        },
      ],
      exhausted_at_month: null,
      horizon_end_on: "2027-03-31",
    },
    retirement_unavailable_reason: null,
  },
  fire_unavailable_reason: null,
  tax: {
    total_unrealised_gain_cents: 400_000,
    total_tax_cents: 68_800,
    accounts_unavailable: 1,
    accounts: [
      {
        account_id: 1,
        account_name: "PEA Boursorama",
        account_kind: "pea",
        opened_on: "2015-04-01",
        positions_total: 1,
        positions_valued: 1,
        unrealised_gain_cents: 300_000,
        regime: "pea_exempt",
        regime_label:
          "PEA exonéré d'impôt sur le revenu (art. 157, 5° bis CGI) — 17,2 % PS dus",
        income_tax_cents: 0,
        social_levies_cents: 51_600,
        total_tax_cents: 51_600,
        net_gain_cents: 248_400,
        exempt: true,
        years_held: 11,
        abatement_applied_cents: null,
        alternative: null,
        unavailable_reason: null,
      },
      {
        account_id: 2,
        account_name: "CTO Boursorama",
        account_kind: "cto",
        opened_on: null,
        positions_total: 1,
        positions_valued: 1,
        unrealised_gain_cents: 100_000,
        regime: "pfu",
        regime_label: "PFU — prélèvement forfaitaire unique, 30 % (12,8 % IR + 17,2 % PS)",
        income_tax_cents: 12_800,
        social_levies_cents: 17_200,
        total_tax_cents: 30_000,
        net_gain_cents: 70_000,
        exempt: null,
        years_held: null,
        abatement_applied_cents: null,
        alternative: {
          regime: "bareme",
          regime_label: "Barème progressif de l'impôt sur le revenu (+ 17,2 % PS)",
          gross_gain_cents: 100_000,
          income_tax_cents: 30_000,
          social_levies_cents: 17_200,
          total_tax_cents: 47_200,
          net_gain_cents: 52_800,
        },
        unavailable_reason: null,
      },
      {
        account_id: 3,
        account_name: "PER Linxea",
        account_kind: "per",
        opened_on: "2021-01-01",
        positions_total: 1,
        positions_valued: 0,
        unrealised_gain_cents: null,
        regime: null,
        regime_label: null,
        income_tax_cents: null,
        social_levies_cents: null,
        total_tax_cents: null,
        net_gain_cents: null,
        exempt: null,
        years_held: null,
        abatement_applied_cents: null,
        alternative: null,
        unavailable_reason:
          "Yieldo ne calcule pas la fiscalité d'un PER : elle dépend de la déduction des versements à l'entrée et du mode de sortie choisi (rente ou capital), que Yieldo ne connaît pas. Aucun chiffre n'est avancé plutôt qu'un chiffre faux — les autres enveloppes ci-dessous restent calculées.",
      },
    ],
    cheaper: "pfu",
  },
  tax_unavailable_reason: null,
  stress: {
    shocks: SHOCKS,
    scenarios: [
      {
        shock: SHOCKS[0],
        portfolio_value_cents: 1_000_000,
        stressable_value_cents: 700_000,
        stressed_value_cents: 322_000,
        impact_cents: -378_000,
        impact_bps: -5_400,
        by_class: [
          {
            asset_class: "equity",
            current_value_cents: 700_000,
            impact_bps: -5_400,
            stressed_value_cents: 322_000,
          },
          {
            asset_class: "crypto",
            current_value_cents: 300_000,
            impact_bps: null,
            stressed_value_cents: null,
          },
        ],
        classes_without_data: ["crypto"],
      },
      {
        shock: SHOCKS[1],
        portfolio_value_cents: 1_000_000,
        stressable_value_cents: 1_000_000,
        stressed_value_cents: 576_200,
        impact_cents: -423_800,
        impact_bps: -4_238,
        by_class: [
          {
            asset_class: "equity",
            current_value_cents: 700_000,
            impact_bps: -3_400,
            stressed_value_cents: 462_000,
          },
          {
            asset_class: "crypto",
            current_value_cents: 300_000,
            impact_bps: -6_200,
            stressed_value_cents: 114_000,
          },
        ],
        classes_without_data: [],
      },
      {
        shock: SHOCKS[2],
        portfolio_value_cents: 1_000_000,
        stressable_value_cents: 1_000_000,
        stressed_value_cents: 682_000,
        impact_cents: -318_000,
        impact_bps: -3_180,
        by_class: [
          {
            asset_class: "equity",
            current_value_cents: 700_000,
            impact_bps: -1_800,
            stressed_value_cents: 574_000,
          },
          {
            asset_class: "crypto",
            current_value_cents: 300_000,
            impact_bps: -6_400,
            stressed_value_cents: 108_000,
          },
        ],
        classes_without_data: [],
      },
    ],
  },
  stress_unavailable_reason: null,
};
