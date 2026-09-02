/**
 * The four states `/assistant` actually has to render, taken from real
 * `GET /api/chat` responses against the seeded fixture — never invented.
 *
 * The operator has 197 transactions over three complete months, no goal, no
 * position and no API key, so **most of what this screen shows is a refusal**.
 * That is why three of the four fixtures below are refusals or a non-answer:
 * a fixture where everything answers would let the screen's best-designed
 * state go untested.
 */
import type { ChatMessage } from "../../lib/types";

/** The ten phrasings `engines/intent.py` ships in SUPPORTED_FORMULATIONS, in
 *  order. Mirrored here so a test can assert the screen renders all ten and
 *  makes every one of them clickable. */
export const SUPPORTED_FORMULATIONS = [
  "Combien j'ai dépensé en restaurant en mars ?",
  "Quelle est ma moyenne mensuelle de dépenses depuis janvier ?",
  "Ai-je dépensé plus ce mois-ci que le mois dernier ?",
  "Est-ce que mon abonnement Netflix a augmenté ?",
  "Combien me coûtent mes abonnements ?",
  "Puis-je m'acheter une voiture à 20 000 € dans 12 mois ?",
  "Si j'épargne 200 € par mois pendant 24 mois, combien aurai-je ?",
  "Où en est mon objectif Vacances ?",
  "Montre-moi mes achats chez Darty en mars.",
  "Quelle sera la valeur de mon patrimoine dans 5 ans ?",
];

/** A real answer, with the monthly decomposition of the very figure it quotes. */
export const ANSWERED: ChatMessage = {
  id: 1,
  text: "Combien j'ai dépensé depuis novembre 2025 ?",
  created_at: "2026-09-03T09:00:00Z",
  answer: {
    recognised: true,
    query_description:
      "Total des dépenses, catégorie : toutes catégories confondues, période : depuis novembre 2025 (jusqu'à aujourd'hui).",
    text: "Vous avez dépensé 7 963,47 € en toutes catégories confondues entre le 2025-11-01 et le 2026-09-03 (176 opérations).",
    amount_cents: -796_347,
    is_refusal: false,
    supported_formulations: null,
    chart: {
      kind: "bars",
      title: "Dépenses par mois — toutes catégories confondues",
      points: [
        { label: "novembre 2025", amount_cents: -265_449 },
        { label: "décembre 2025", amount_cents: -265_449 },
        { label: "janvier 2026", amount_cents: -265_449 },
      ],
    },
  },
};

/** An engine declining to compute. It reaches the screen verbatim and stays
 *  verbatim: it already names its own cause and its own remedy. */
export const REFUSED: ChatMessage = {
  id: 2,
  text: "Quelle sera la valeur de mon patrimoine dans 5 ans ?",
  created_at: "2026-09-03T09:01:00Z",
  answer: {
    recognised: true,
    query_description: "Projection de patrimoine à 60 mois.",
    text: "Aucun capital de départ : vous ne détenez aucune position. Saisissez vos comptes, vos positions et leurs lots sur l'écran Patrimoine.",
    amount_cents: null,
    is_refusal: true,
    supported_formulations: null,
    chart: null,
  },
};

/** A second refusal, naming a DIFFERENT cause and a different remedy — the
 *  pair proves the screen prints what it was given rather than one house
 *  sentence for every refusal. */
export const REFUSED_GOAL: ChatMessage = {
  id: 3,
  text: "Où en est mon objectif Vacances ?",
  created_at: "2026-09-03T09:02:00Z",
  answer: {
    recognised: true,
    query_description: "État de l'objectif « Vacances ».",
    text: "Vous n'avez aucun objectif enregistré. Créez-en un depuis l'écran Objectifs.",
    amount_cents: null,
    is_refusal: true,
    supported_formulations: null,
    chart: null,
  },
};

/** The unrecognised-intent state: a designed state, not an error banner. */
export const UNRECOGNISED: ChatMessage = {
  id: 4,
  text: "Quel temps fera-t-il demain ?",
  created_at: "2026-09-03T09:03:00Z",
  answer: {
    recognised: false,
    query_description: null,
    text: "Je n'ai pas compris cette question. Voici des formulations que je sais traiter :",
    amount_cents: null,
    is_refusal: true,
    supported_formulations: SUPPORTED_FORMULATIONS,
    chart: null,
  },
};

export const OPERATOR_CONVERSATION: ChatMessage[] = [
  ANSWERED,
  REFUSED,
  REFUSED_GOAL,
  UNRECOGNISED,
];
