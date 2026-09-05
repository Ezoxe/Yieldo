/**
 * What the assistant is allowed to point at, and the words that name it.
 *
 * The answer the backend returns carries a sentence and a figure — never an
 * element id (see `ChatAnswer` in lib/types.ts). So the link between "ta jauge
 * d'autonomie est à 0,8 mois" and the card showing it has to be made here, and
 * it is made the only honest way available: a declared list of things on
 * screen, each with the French terms that name it, matched against the text
 * the engine actually produced.
 *
 * Two rules follow from that, and both are load-bearing:
 *
 *   - Nothing is invented. A target is offered only if its own terms appear in
 *     the answer AND the element carrying its id is really in the document
 *     (see `AISpotlight`). A chip that scrolls to nothing is worse than no
 *     chip.
 *   - The list is data, not inference. Adding a card to a screen means adding
 *     a line here; it cannot be guessed at runtime, and pretending otherwise
 *     would make the feature quietly wrong as the app grows.
 */

export interface AiTarget {
  /** The value of the element's `data-ai-target` attribute. */
  id: string;
  /** What the chip in the conversation says. */
  label: string;
  /** Where the element lives. The chip navigates here first when the reader
   *  is somewhere else. */
  route: string;
  /**
   * The words that name this thing in French, lower-cased and without
   * accents — `normalise` below strips them from both sides, so "trésorerie"
   * and "tresorerie" match the same entry.
   */
  terms: string[];
}

/** Lower-case, accent-stripped: the one form both sides of a match are in. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export const AI_TARGETS: AiTarget[] = [
  // Vue d'ensemble
  { id: "kpi-solde-net", label: "Solde net", route: "/", terms: ["solde net"] },
  { id: "kpi-entrees", label: "Entrées", route: "/", terms: ["entrees", "revenus", "rentrees"] },
  { id: "kpi-sorties", label: "Sorties", route: "/", terms: ["sorties"] },
  {
    id: "kpi-taux-epargne",
    label: "Taux d'épargne",
    route: "/",
    terms: ["taux d'epargne", "taux d epargne"],
  },
  { id: "chart-flux", label: "Flux de trésorerie", route: "/", terms: ["flux de tresorerie"] },
  {
    id: "chart-repartition",
    label: "Répartition des dépenses",
    route: "/",
    terms: ["repartition des depenses", "par categorie"],
  },
  {
    id: "panel-recent",
    label: "Dernières opérations",
    route: "/",
    terms: ["dernieres operations"],
  },
  { id: "panel-calendrier", label: "Calendrier", route: "/", terms: ["calendrier"] },

  // Plan prévisionnel
  {
    id: "panel-plan",
    label: "Plan prévisionnel",
    route: "/plan",
    terms: ["plan previsionnel", "estimation", "estime", "previsionnel"],
  },
  {
    id: "panel-plan-restant",
    label: "Ce qui n'est pas encore passé",
    route: "/plan",
    terms: ["pas encore passe", "reste a passer", "reel complete"],
  },

  // Trésorerie
  {
    id: "kpi-solde-disponible",
    label: "Solde disponible",
    route: "/tresorerie",
    terms: ["solde disponible"],
  },
  {
    id: "kpi-autonomie",
    label: "Autonomie",
    route: "/tresorerie",
    terms: ["autonomie", "combien de temps sans revenu", "mois de reserve"],
  },
  {
    id: "panel-prevision",
    label: "Prévision",
    route: "/tresorerie",
    terms: ["prevision", "projection sur douze mois"],
  },

  // Budgets
  {
    id: "panel-budgets",
    label: "Budgets",
    route: "/budgets",
    terms: ["budget", "budgets", "enveloppe", "enveloppes", "depassement"],
  },

  // Suivi
  {
    id: "kpi-sante",
    label: "Santé financière",
    route: "/suivi",
    terms: ["sante financiere", "score de sante"],
  },
  {
    id: "panel-regularite",
    label: "Régularité",
    route: "/suivi",
    terms: ["regularite", "serie de releves"],
  },

  // Récurrences
  {
    id: "panel-recurrences",
    label: "Abonnements",
    route: "/recurrences",
    terms: ["abonnement", "abonnements", "prelevement recurrent", "recurrence", "recurrences"],
  },

  // Analyse
  {
    id: "panel-anomalies",
    label: "Montants inhabituels",
    route: "/analyse",
    terms: ["anomalie", "anomalies", "montants inhabituels"],
  },
  {
    id: "panel-panier",
    label: "Votre panier",
    route: "/analyse",
    terms: ["panier", "inflation"],
  },

  // Dettes et objectifs
  {
    id: "panel-dettes",
    label: "Dettes",
    route: "/dettes",
    terms: ["dette", "dettes", "remboursement"],
  },
  {
    id: "panel-objectifs",
    label: "Objectifs",
    route: "/objectifs",
    terms: ["objectif", "objectifs"],
  },
];

/**
 * The id a category's budget row carries.
 *
 * Derived from the NAME rather than from the API's own slug, and deliberately:
 * both sides of this match — the chip built from `GET /categories` and the row
 * rendered from `GET /budgets`, which carries no slug at all — can compute it
 * from the one field they both have. A shared derivation cannot drift; two
 * sources agreeing by convention can.
 */
export function categoryTargetId(name: string): string {
  return `budget-${normalise(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

/**
 * A target for one budget category — "budget-courses" for Courses.
 *
 * Built at runtime from the categories the account actually has, because the
 * static list above cannot know them. Same contract as every other target: the
 * id has to exist in the document for the chip to be offered.
 */
export function categoryTarget(name: string): AiTarget {
  return {
    id: categoryTargetId(name),
    // Prefixed, and not just the category's name: an account with a category
    // called "Abonnements" would otherwise put two chips reading "Abonnements"
    // side by side — one pointing at that budget row, one at the recurrences
    // screen — with nothing on either saying which is which. Seen in the
    // browser on the seeded category tree.
    label: `Budget ${name}`,
    route: "/budgets",
    terms: [normalise(name)],
  };
}

/**
 * The targets an answer names, in the order they are first mentioned.
 *
 * Word-boundary matching, not `includes`: "dette" must not fire on "détecté",
 * and "budget" must not fire inside a longer word. The boundary is anything
 * that is not a letter or a digit, which in normalised French text is exactly
 * the separators.
 */
export function targetsMentionedIn(text: string, extra: AiTarget[] = []): AiTarget[] {
  const haystack = normalise(text);
  const found: { target: AiTarget; at: number }[] = [];

  for (const target of [...extra, ...AI_TARGETS]) {
    let earliest = -1;
    for (const term of target.terms) {
      const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}([^\\p{L}\\p{N}]|$)`, "u");
      const match = pattern.exec(haystack);
      if (match && (earliest === -1 || match.index < earliest)) earliest = match.index;
    }
    if (earliest !== -1) found.push({ target, at: earliest });
  }

  // First mention first, and one chip per target however often it is named.
  return found
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.target)
    .filter((target, index, all) => all.findIndex((t) => t.id === target.id) === index);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
