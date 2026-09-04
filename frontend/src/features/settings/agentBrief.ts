/**
 * Everything a program needs to drive this account, in one block.
 *
 * A key on its own is not usable by an agent: it does not say where to send
 * it, what the figures mean, or which routes exist. This builds the rest —
 * the base URL, the header, the expiry, the conventions the whole codebase
 * rests on, and the entry points worth knowing — so the operator copies one
 * thing and the agent can start.
 *
 * Two rules hold it honest, and they are the same two `design/ai/targets.ts`
 * keeps:
 *
 *   - **Nothing is invented.** Every route below exists in the OpenAPI
 *     document the server serves, with the query parameters it really
 *     declares. A brief that named a plausible route would send an agent to a
 *     404 and make Yieldo look broken.
 *   - **The list is data.** A new route means a new line here, and the brief
 *     points at `/api/openapi.json` for the 97 the server describes itself —
 *     so the curated list can be short without being a lie about the surface.
 *
 * The account password is deliberately NOT here and never will be. The API
 * does not accept one, the key is the whole credential, and a block meant to
 * be pasted into a third-party agent is the last place a password belongs.
 * `agentBrief.test.ts` asserts that.
 */

export interface AgentBriefInput {
  /** The key, in the clear — the same string the panel shows. */
  key: string;
  /** ISO-8601, from the API. */
  expiresAt: string;
  /** Where Yieldo is served, e.g. `https://yieldo.chez-moi.fr`. Normally
   *  `window.location.origin`; passed in so this stays a pure function. */
  origin: string;
}

interface AgentRoute {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  /** What it answers, in French. */
  what: string;
  /** The query parameters it actually declares, or null when it takes none. */
  params?: string;
}

/**
 * The entry points worth naming, verified against `/api/openapi.json`.
 *
 * Curated, not exhaustive: an agent handed ninety-seven lines reads none of
 * them, and the full document is one GET away. What is here is what answers
 * the questions a household actually asks.
 */
export const AGENT_ROUTES: AgentRoute[] = [
  { method: "GET", path: "/api/auth/me", what: "Le compte : id, nom, email" },
  { method: "GET", path: "/api/accounts", what: "Les comptes bancaires et leur solde d'ouverture" },
  {
    method: "GET",
    path: "/api/transactions",
    what: "Les opérations",
    params: "date_from, date_to, account_id, category_id, search, uncategorized_only, min_cents, max_cents, limit, offset",
  },
  {
    method: "PATCH",
    path: "/api/transactions/{id}",
    what: "Recatégoriser une opération, la marquer virement, l'étiqueter",
  },
  { method: "GET", path: "/api/categories", what: "L'arbre de catégories" },
  {
    method: "GET",
    path: "/api/analytics/summary",
    what: "Entrées, sorties, solde net sur une période",
    params: "date_from, date_to",
  },
  {
    method: "GET",
    path: "/api/analytics/series",
    what: "La même chose dans le temps",
    params: "granularity, date_from, date_to, account_id, include_transfers",
  },
  {
    method: "GET",
    path: "/api/analytics/categories",
    what: "Répartition des dépenses par catégorie",
    params: "date_from, date_to",
  },
  { method: "GET", path: "/api/budgets", what: "Enveloppes, consommation, dépassements", params: "month" },
  { method: "GET", path: "/api/recurrences", what: "Les prélèvements réguliers détectés" },
  { method: "GET", path: "/api/cashflow/runway", what: "Solde disponible et autonomie en mois" },
  { method: "GET", path: "/api/cashflow/forecast", what: "Prévision de trésorerie" },
  { method: "GET", path: "/api/debts", what: "Les dettes" },
  {
    method: "GET",
    path: "/api/debts/payoff",
    what: "Boule de neige contre avalanche, chiffrées",
    params: "extra_cents",
  },
  { method: "GET", path: "/api/goals", what: "Les objectifs et leur avancement" },
  { method: "POST", path: "/api/feasibility", what: "« Puis-je m'acheter X dans N mois ? »" },
  { method: "GET", path: "/api/engagement", what: "Score de santé financière, régularité, défis" },
  {
    method: "GET",
    path: "/api/analysis/anomalies",
    what: "Les montants inhabituels",
    params: "date_from, date_to",
  },
  { method: "GET", path: "/api/portfolio/valuation", what: "Valorisation du patrimoine" },
  {
    method: "POST",
    path: "/api/chat",
    what: "Poser une question en français ; la réponse porte le calcul et sa trace",
  },
  { method: "POST", path: "/api/export", what: "Exporter le contexte complet (md, txt, json)" },
];

/** The routes an agent key does NOT open, and why. Kept as data because the
 *  brief and the panel's own note must never disagree about the count. */
export const SESSION_ONLY_ROUTES: string[] = [
  "PATCH /api/auth/me",
  "POST /api/auth/password",
  "GET /api/access-key",
  "POST /api/access-key/rotate",
  "DELETE /api/access-key",
  "GET /api/connections",
  "POST /api/connections/{provider}",
  "DELETE /api/connections/{provider}",
];

/** `2026-09-05T15:42:00Z` as a French operator reads it. */
function frenchMoment(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * A local origin is the one thing in this brief the operator may have to
 * change: an agent running elsewhere cannot reach `localhost`. Said out loud
 * rather than silently producing a URL that will not resolve.
 */
export function isLocalOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
}

export function buildAgentBrief({ key, expiresAt, origin }: AgentBriefInput): string {
  const routes = AGENT_ROUTES.map((route) => {
    const head = `${route.method.padEnd(6)} ${route.path}`;
    const params = route.params === undefined ? "" : `\n         paramètres : ${route.params}`;
    return `${head}\n         ${route.what}${params}`;
  }).join("\n");

  const localWarning = isLocalOrigin(origin)
    ? "\n- Cette adresse est locale : elle ne fonctionne que pour un programme " +
      "tournant sur la même machine. Un agent distant a besoin de l'adresse " +
      "publique de cette instance, à la place de celle-ci."
    : "";

  return `# Accès API Yieldo — brief agent

Tu peux lire et modifier l'intégralité de ce compte Yieldo par son API HTTP.
Tout ce qu'il te faut est ci-dessous. Ne devine rien : ce qui n'est pas écrit
ici est décrit par le serveur lui-même (voir « Spécification complète »).

## Connexion

- Base : ${origin}
- En-tête, sur chaque requête :
  Authorization: Bearer ${key}
- Type de contenu en écriture : application/json
- Clé valable jusqu'au ${frenchMoment(expiresAt)} (24 heures).
  Ensuite tout répond 401 : demande à l'opérateur d'en émettre une nouvelle
  dans Réglages → Accès API.
- Cette clé est la seule information d'authentification que l'API accepte.
  Il n'y a pas de mot de passe à connaître, et tu ne dois jamais en demander
  un.${localWarning}

## Vérifie l'accès avant toute autre chose

curl -s -H "Authorization: Bearer ${key}" \\
  ${origin}/api/auth/me

Attendu : le compte de l'opérateur. Un 401 signifie que la clé a expiré ou a
été révoquée — dis-le, ne réessaie pas en boucle.

## Spécification complète

- ${origin}/api/openapi.json — les 97 routes, décrites par le serveur
- ${origin}/api/docs — la même chose, lisible

## Points d'entrée les plus utiles

${routes}

## Conventions, non négociables

- Tout montant est un ENTIER DE CENTIMES, jamais un flottant, ni en lecture
  ni en écriture. Le champ s'appelle amount_cents : -1250 vaut -12,50 €.
- Une dépense est négative, une entrée positive.
- Les dates sont ISO-8601 YYYY-MM-DD ; les horodatages, ISO-8601 en UTC.
- Les bornes de période (date_from, date_to) sont incluses.
- Tu n'agis que sur ce compte. L'API filtre tout sur son propriétaire ; il n'y
  a aucun identifiant d'utilisateur à passer, et aucune route ne lit au-delà.
- L'API ne convertit aucune devise et n'invente aucune valeur par défaut :
  quand un moteur ne peut pas mesurer, il refuse et dit pourquoi.

## Ce que cette clé n'ouvre pas

${SESSION_ONLY_ROUTES.map((route) => `- ${route}`).join("\n")}

Ces routes changent les identifiants du compte et exigent une vraie session.
Ce n'est pas un obstacle à contourner : c'est ce qui garantit qu'un programme
ne peut pas verrouiller l'opérateur hors de son propre compte.

## Codes de réponse

- 401 — clé absente, invalide, expirée ou révoquée
- 404 — la ressource n'existe pas, ou n'appartient pas à ce compte
- 422 — la requête est comprise mais un moteur refuse de calculer. Le champ
  detail porte la raison, en français, et elle est exacte : rends-la telle
  quelle plutôt que de la reformuler ou de la contourner.
`;
}
