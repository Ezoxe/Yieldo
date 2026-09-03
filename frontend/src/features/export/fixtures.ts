/**
 * Real `GET /api/export/options`, `GET /api/export/templates` and
 * `POST /api/export` responses against the seeded fixture, trimmed.
 *
 * The operator has one account, 69 categories and 197 transactions over five
 * calendar months. The category list is what makes this screen hard — a
 * scope panel with 69 checkboxes has to stay usable at 375 px — so the
 * fixture keeps enough of them to be honest about it.
 */
import type { ExportDocument, ExportOptions, ExportTemplate } from "../../lib/types";

export const MODULE_OPTIONS = [
  { key: "profil", label: "Profil" },
  { key: "budget", label: "Budget" },
  { key: "patrimoine", label: "Patrimoine" },
  { key: "dettes", label: "Dettes" },
  { key: "objectifs", label: "Objectifs" },
  { key: "positions", label: "Positions" },
  { key: "recurrences", label: "Récurrences" },
  { key: "analyses", label: "Analyses" },
  { key: "projections", label: "Projections" },
  { key: "fiscalite", label: "Fiscalité" },
];

export const OPTIONS: ExportOptions = {
  accounts: [{ id: 1, name: "Compte courant", kind: "checking" }],
  categories: [
    { id: 1, name: "Abonnements" },
    { id: 2, name: "Alimentation / Courses" },
    { id: 3, name: "Carburant" },
    { id: 4, name: "Logement" },
    { id: 5, name: "Restaurant" },
    { id: 6, name: "Salaire" },
    { id: 7, name: "Transport" },
  ],
  modules: MODULE_OPTIONS,
  target_models: [
    { key: "local-4k", label: "Modèle local, fenêtre de 4 096 tokens", context_tokens: 4_096 },
    { key: "local-8k", label: "Modèle local, fenêtre de 8 000 tokens", context_tokens: 8_000 },
    { key: "local-32k", label: "Modèle local, fenêtre de 32 768 tokens", context_tokens: 32_768 },
    { key: "gpt-4o", label: "GPT-4o (128 000 tokens)", context_tokens: 128_000 },
    { key: "claude-sonnet", label: "Claude Sonnet (200 000 tokens)", context_tokens: 200_000 },
    {
      key: "gemini-1-5-pro",
      label: "Gemini 1.5 Pro (1 000 000 tokens)",
      context_tokens: 1_000_000,
    },
  ],
  ledger_date_from: "2025-01-24",
  ledger_date_to: "2026-01-09",
};

export const TEMPLATES: ExportTemplate[] = [
  {
    key: "bilan-annuel",
    label: "Bilan annuel",
    summary: "L'année 2025 entière, mois par mois, avec les comptes, les dettes, les objectifs et les récurrences.",
    question:
      "Voici le bilan de mon année 2025. Résume ce qui a le plus pesé, ce qui a changé d'un mois sur l'autre, et les trois points sur lesquels agir en priorité. N'utilise que les chiffres de ce document : n'en calcule aucun autre et n'en invente aucun.",
    date_from: "2025-01-01",
    date_to: "2025-12-31",
    granularity: "monthly",
    modules: ["profil", "budget", "analyses", "patrimoine", "dettes", "objectifs", "recurrences"],
    anonymise: false,
  },
  {
    key: "faisabilite-achat",
    label: "Faisabilité d'achat",
    summary:
      "Les douze derniers mois complets, avec la capacité d'épargne, les dettes en cours, les objectifs déjà engagés et la projection.",
    question:
      "Je veux savoir si un achat important est envisageable. À partir de ce document, dis-moi ce que mes flux permettent, ce qu'ils ne permettent pas, et à quelles conditions. Si le document ne contient pas de quoi trancher, dis-le au lieu de l'estimer.",
    date_from: "2025-09-01",
    date_to: "2026-08-31",
    granularity: "monthly",
    modules: ["profil", "budget", "analyses", "dettes", "objectifs", "patrimoine", "projections"],
    anonymise: false,
  },
  {
    key: "revue-portefeuille",
    label: "Revue de portefeuille",
    summary:
      "Les positions détenues, leur valorisation, la projection et la fiscalité d'une cession, sur les douze derniers mois complets.",
    question:
      "Passe en revue mon portefeuille : concentration, classes d'actifs sur- ou sous-représentées, ce qui manque. Les valorisations de ce document sont les seules à utiliser ; ne recalcule aucune performance.",
    date_from: "2025-09-01",
    date_to: "2026-08-31",
    granularity: "annual",
    modules: ["patrimoine", "positions", "projections", "fiscalite"],
    anonymise: false,
  },
  {
    key: "optimisation-fiscale",
    label: "Optimisation fiscale",
    summary: "L'année 2025, les enveloppes détenues et l'imposition qu'une cession déclencherait.",
    question:
      "Au vu de ce document, quelles enveloppes et quels arbitrages réduiraient mon imposition en France ? Rappelle les règles applicables et dis explicitement ce que tu ne peux pas trancher sans information supplémentaire. Tu n'es pas mon conseiller fiscal.",
    date_from: "2025-01-01",
    date_to: "2025-12-31",
    granularity: "annual",
    modules: ["profil", "patrimoine", "positions", "fiscalite"],
    anonymise: false,
  },
  {
    key: "diagnostic-budgetaire",
    label: "Diagnostic budgétaire",
    summary: "Les six derniers mois complets, poste par poste, avec les prélèvements récurrents détectés.",
    question:
      "Analyse mon budget : quels postes dérivent, quels abonnements méritent d'être revus, quelle marge est réaliste. Chaque recommandation doit citer un chiffre présent dans ce document.",
    date_from: "2026-03-01",
    date_to: "2026-08-31",
    granularity: "monthly",
    modules: ["profil", "budget", "analyses", "recurrences"],
    anonymise: false,
  },
];

export const DOCUMENT: ExportDocument = {
  markdown:
    "# Contexte financier — Yieldo\n\n## Périmètre\n\n- Période : du 2025-01-01 au 2026-12-31 (bornes incluses)\n- Comptes : tous\n\n## Profil\n\n- Opérations retenues : 197\n- Sorties : -12 429,62 €\n",
  estimated_tokens: 1_284,
  warning: null,
  transaction_count: 197,
  excluded_transfer_count: 0,
  date_from: "2025-01-01",
  date_to: "2026-12-31",
  sections: ["profil", "analyses"],
};

/** The same document, measured against a window it does not fit. */
export const DOCUMENT_TOO_BIG: ExportDocument = {
  ...DOCUMENT,
  estimated_tokens: 91_740,
  warning:
    "Ce document est estimé à 91 740 tokens, pour une fenêtre de 8 000 tokens (Modèle local, fenêtre de 8 000 tokens) dont 6 400 utilisables une fois réservée la place de la réponse. Réduisez la granularité, la période ou le nombre de modules avant de le transmettre : au-delà de la fenêtre, le modèle ne lira pas la fin du document et ne dira pas qu'il l'a perdue.",
};
