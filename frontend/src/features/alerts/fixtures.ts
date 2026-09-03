import type { AlertReport } from "../../lib/types";

/**
 * The operator's ACTUAL report, read live off `GET /api/alerts` against the
 * seeded fixture before this screen was written.
 *
 * Two anomalies fire and nothing else does: no threshold is stored, no budget
 * is declared, no subscription has risen, and the one label without a recent
 * charge is a pharmacy card spend whose amounts vary far too much to call a
 * scheduled debit. Eight months inside his own ledger's span hold nothing at
 * all, which is why the notice is there.
 */
export const OPERATOR_REPORT: AlertReport = {
  alerts: [
    {
      kind: "anomaly",
      severity: "info",
      severity_label: "Pour information",
      key: "anomaly:171",
      title: "Montant inhabituel : CARTE X1234 FNAC DARTY",
      measured:
        "236,55 € dans « Équipement et high-tech », contre 68,41 € habituellement — un écart de 168,14 € par rapport à la médiane de la catégorie (score robuste 4,1).",
      period:
        "Opération du 28 décembre 2025, comparée à l'ensemble de l'historique de sa catégorie et retenue parce qu'elle tombe dans la fenêtre analysée, du 24 janvier 2025 au 9 janvier 2026.",
      clears_when:
        "Une opération passée ne se corrige pas : cette alerte quittera le fil quand l'opération sortira de la fenêtre analysée, à mesure que vous importerez des relevés plus récents. Elle disparaîtra aussi si vous reclassez l'opération dans une catégorie où ce montant est ordinaire.",
      amount_cents: -23655,
      on: "2025-12-28",
    },
    {
      kind: "anomaly",
      severity: "info",
      severity_label: "Pour information",
      key: "anomaly:34",
      title: "Montant inhabituel : CARTE X1234 FNAC DARTY",
      measured:
        "220,39 € dans « Équipement et high-tech », contre 68,41 € habituellement — un écart de 151,98 € par rapport à la médiane de la catégorie (score robuste 3,8).",
      period:
        "Opération du 13 février 2025, comparée à l'ensemble de l'historique de sa catégorie et retenue parce qu'elle tombe dans la fenêtre analysée, du 24 janvier 2025 au 9 janvier 2026.",
      clears_when:
        "Une opération passée ne se corrige pas : cette alerte quittera le fil quand l'opération sortira de la fenêtre analysée, à mesure que vous importerez des relevés plus récents. Elle disparaîtra aussi si vous reclassez l'opération dans une catégorie où ce montant est ordinaire.",
      amount_cents: -22039,
      on: "2025-02-13",
    },
  ],
  conditions: [
    {
      kind: "balance_floor",
      label: "Solde projeté sous un seuil",
      measured: false,
      detail:
        "Aucun seuil de solde n'est enregistré. Un seuil absent n'est pas un seuil à 0 € : tant que vous n'en avez pas fixé un, Yieldo ne surveille aucun plancher et ne lève aucune alerte sur le solde projeté. Enregistrez-en un pour activer cette surveillance.",
      alert_count: 0,
      withheld: [],
    },
    {
      kind: "missing_debit",
      label: "Prélèvement attendu non constaté",
      measured: true,
      detail:
        "1 récurrence(s) sans prélèvement récent sur 4 détectées. Une absence n'est retenue que si le libellé revient à un montant constant et que le mois attendu figure réellement dans vos relevés.",
      alert_count: 0,
      withheld: [
        "Aucune conclusion pour « CARTE X1234 PHARMACIE CENTRALE » : ce libellé revient à un rythme hebdomadaire, mais pour des montants qui varient de ±7,92 € autour de 21,97 €. Un rythme n'est pas un prélèvement programmé : ce sont des achats différents sous un même libellé, et leur silence ne prouve aucun paiement manqué.",
      ],
    },
    {
      kind: "price_rise",
      label: "Hausse de prix d'un abonnement",
      measured: true,
      detail:
        "4 récurrence(s) encore actives sur 4 détectées, comparées à leur propre niveau antérieur. Une variation de moins de 2 % ou une baisse de prix n'est pas signalée.",
      alert_count: 0,
      withheld: [],
    },
    {
      kind: "budget_crossed",
      label: "Budget mensuel dépassé",
      measured: false,
      detail:
        "Aucun budget mensuel n'est déclaré : sans plafond, il n'y a rien à dépasser. Fixez un budget sur une catégorie depuis l'écran Budgets pour activer cette surveillance.",
      alert_count: 0,
      withheld: [],
    },
    {
      kind: "anomaly",
      label: "Montant inhabituel pour sa catégorie",
      measured: true,
      detail:
        "8 groupe(s) catégorie/sens comparés à leur propre historique, sur la fenêtre du 24 janvier 2025 au 9 janvier 2026.",
      alert_count: 2,
      withheld: [],
    },
  ],
  coverage: {
    first_on: "2025-01-24",
    last_on: "2026-01-09",
    covered_months: ["2025-01", "2025-02", "2025-03", "2025-12", "2026-01"],
    missing_months: [
      "2025-04", "2025-05", "2025-06", "2025-07",
      "2025-08", "2025-09", "2025-10", "2025-11",
    ],
  },
  settings: { balance_floor_cents: null },
  notice:
    "8 mois de votre historique ne sont pas importés (avril 2025, mai 2025, juin 2025, juillet 2025, août 2025, septembre 2025, octobre 2025, novembre 2025). Aucune alerte n'est levée sur ces mois : une absence dans un mois non importé est un trou dans les données, pas un événement. Importez ces relevés pour que Yieldo puisse s'y prononcer.",
  ledger_last_on: "2026-01-09",
};

/** A household that has imported nothing: five unmeasured conditions and no
 *  invented span. */
export const EMPTY_REPORT: AlertReport = {
  alerts: [],
  conditions: OPERATOR_REPORT.conditions.map((condition) => ({
    ...condition,
    measured: false,
    alert_count: 0,
    withheld: [],
    detail: `Rien à mesurer pour « ${condition.label} » : aucun relevé n'a été importé.`,
  })),
  coverage: { first_on: null, last_on: null, covered_months: [], missing_months: [] },
  settings: { balance_floor_cents: null },
  notice: null,
  ledger_last_on: null,
};

/** The same ledger with a floor stored and the projection breaching it. */
export const REPORT_WITH_FLOOR: AlertReport = {
  ...OPERATOR_REPORT,
  alerts: [
    {
      kind: "balance_floor",
      severity: "critical",
      severity_label: "Critique",
      key: "balance_floor:2026-03",
      title: "Solde projeté sous votre seuil en mars 2026",
      measured:
        "Le pire dixième de la projection (P10) descend à −4 210,45 € en mars 2026, sous le seuil de −500,00 € que vous avez enregistré. L'estimation médiane du même mois est de −2 980,12 €.",
      period:
        "Horizon projeté : février 2026 à janvier 2027, à partir d'un solde de −2 209,63 € et de 3 mois complets de relevés. Premier mois sous le seuil : mars 2026.",
      clears_when:
        "Elle disparaîtra quand le pire dixième de mars 2026 repassera au-dessus de −500,00 € — en important des relevés plus récents, ou en réduisant les dépenses que la projection reconduit.",
      amount_cents: -421045,
      on: "2026-03-31",
    },
    ...OPERATOR_REPORT.alerts,
  ],
  settings: { balance_floor_cents: -50000 },
};
