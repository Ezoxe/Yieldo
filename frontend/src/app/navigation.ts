import {
  AlertsIcon,
  AnalysisIcon,
  AssistantIcon,
  BrokersIcon,
  BudgetsIcon,
  CashflowIcon,
  CategoriesIcon,
  ConnectionsIcon,
  ControlRoomIcon,
  DebtsIcon,
  DecisionModelIcon,
  DecisionsIcon,
  ExportIcon,
  FeasibilityIcon,
  FinanceEnvironmentIcon,
  GoalsIcon,
  ImportIcon,
  InvestEnvironmentIcon,
  MandateIcon,
  OverviewIcon,
  OversightIcon,
  PlanIcon,
  PortfolioIcon,
  ProposalsIcon,
  ProjectionIcon,
  RecurrencesIcon,
  SettingsIcon,
  SimulatorsIcon,
  StreakIcon,
  TransactionsIcon,
  type IconComponent,
} from "../design/icons";

/** The two halves of the application. See `ENVIRONMENTS` below. */
export type EnvironmentId = "finances" | "investissement";

export interface NavItem {
  to: string;
  label: string;
  icon: IconComponent;
  end?: boolean;
  /**
   * Other French words a household might reach for. The sidebar never shows
   * them; the header's search matches on them, so "dépenses" finds Transactions
   * and "épargne" finds Objectifs. Data, like `design/ai/targets.ts` — a new
   * screen means a new line here, not a new branch somewhere.
   */
  aliases?: string[];
  /**
   * Which environment this screen belongs to. Filled in by `ENVIRONMENTS`
   * below rather than typed on every entry, so a screen cannot claim to be in
   * one environment while sitting in the other's list.
   */
  environment?: EnvironmentId;
}

/**
 * The sidebar, in groups.
 *
 * Twenty flat entries is a wall nobody reads top to bottom; the same twenty
 * under five headings is a map. The ORDER of the entries is pinned by
 * `AppShell.test.tsx` as a list, because an entry silently dropped in a
 * refactor is a screen the operator can no longer reach.
 *
 * It lives here rather than in `AppShell` because two things read it now: the
 * sidebar draws it, and the header's search looks screens up in it. One list,
 * so a screen can never be reachable by one and invisible to the other.
 */
export interface NavSection {
  /** null for the first group — a heading over a single entry is noise. */
  title: string | null;
  items: NavItem[];
}

/**
 * One half of the application: its own sidebar, its own home, its own screens.
 *
 * **Why two environments rather than five more sections.** Managing a
 * household's money and running software that trades it are two different
 * activities with two different tempos, and a sidebar that mixed them would
 * put « Arrêt d'urgence » three entries below « Courses ». The switcher at the
 * top left is the whole of the boundary: everything else — the sidebar, the
 * phone tabs, the header search's grouping — reads this list.
 *
 * `prefixes` is what decides which environment a URL belongs to, and it is
 * data for the same reason the sections are: a route reachable from a sidebar
 * that the switcher does not recognise would light up the wrong environment,
 * and nobody would notice until they were in it.
 */
export interface Environment {
  id: EnvironmentId;
  label: string;
  /** One line, in the switcher, saying what this half is for. */
  tagline: string;
  icon: IconComponent;
  /** Where the switcher lands. */
  home: string;
  /** Every route in this environment starts with one of these. */
  prefixes: string[];
  sections: NavSection[];
}

const FINANCE_SECTIONS: NavSection[] = [
  {
    title: null,
    items: [
      { to: "/", label: "Vue d'ensemble", icon: OverviewIcon, end: true,
        aliases: ["tableau de bord", "accueil", "résumé"] },
    ],
  },
  {
    title: "Au quotidien",
    items: [
      { to: "/transactions", label: "Transactions", icon: TransactionsIcon,
        aliases: ["opérations", "dépenses", "achats", "relevé"] },
      { to: "/budgets", label: "Budgets", icon: BudgetsIcon,
        aliases: ["enveloppes", "plafonds"] },
      { to: "/recurrences", label: "Récurrences", icon: RecurrencesIcon,
        aliases: ["abonnements", "prélèvements", "charges fixes"] },
      { to: "/plan", label: "Plan prévisionnel", icon: PlanIcon,
        aliases: ["prévisionnel", "budget prévisionnel"] },
      { to: "/tresorerie", label: "Trésorerie", icon: CashflowIcon,
        aliases: ["solde", "reste à vivre", "flux"] },
      { to: "/analyse", label: "Analyse", icon: AnalysisIcon,
        aliases: ["statistiques", "répartition"] },
    ],
  },
  {
    title: "Objectifs",
    items: [
      { to: "/dettes", label: "Dettes", icon: DebtsIcon,
        aliases: ["crédits", "prêts", "emprunts"] },
      { to: "/objectifs", label: "Objectifs", icon: GoalsIcon,
        aliases: ["épargne", "projets"] },
      { to: "/suivi", label: "Suivi", icon: StreakIcon,
        aliases: ["série", "habitudes", "défis"] },
      { to: "/alertes", label: "Alertes", icon: AlertsIcon,
        aliases: ["notifications", "seuils"] },
    ],
  },
  {
    title: "Horizon",
    items: [
      { to: "/patrimoine", label: "Patrimoine", icon: PortfolioIcon,
        aliases: ["investissements", "portefeuille", "placements"] },
      { to: "/projection", label: "Projection", icon: ProjectionIcon,
        aliases: ["prévision", "long terme"] },
      { to: "/faisabilite", label: "Faisabilité", icon: FeasibilityIcon,
        aliases: ["est-ce que je peux", "achat"] },
      { to: "/simulateurs", label: "Simulateurs", icon: SimulatorsIcon,
        aliases: ["simulation", "crédit", "impôts"] },
    ],
  },
  {
    title: "Outils",
    items: [
      { to: "/assistant", label: "Assistant", icon: AssistantIcon,
        aliases: ["ia", "chat", "shibi"] },
      { to: "/propositions", label: "Propositions", icon: ProposalsIcon,
        aliases: ["suggestions", "agent"] },
      { to: "/export", label: "Export IA", icon: ExportIcon,
        aliases: ["exporter", "contexte"] },
      { to: "/categories", label: "Catégories", icon: CategoriesIcon,
        aliases: ["règles", "classement"] },
      { to: "/import", label: "Import", icon: ImportIcon,
        aliases: ["csv", "relevé bancaire", "importer"] },
      { to: "/reglages", label: "Réglages", icon: SettingsIcon, end: true,
        aliases: ["paramètres", "compte", "mot de passe", "apparence",
                  "mode de lecture", "réel", "estimation"] },
    ],
  },
];

const INVESTMENT_SECTIONS: NavSection[] = [
  {
    title: null,
    items: [
      { to: "/invest", label: "Salle de contrôle", icon: ControlRoomIcon, end: true,
        aliases: ["pilotage", "tableau de bord investissement", "en direct",
                  "arrêt d'urgence", "kill switch"] },
    ],
  },
  {
    title: "Le pilotage",
    items: [
      { to: "/invest/decisions", label: "Décisions", icon: DecisionsIcon,
        aliases: ["flux", "raisonnement", "pourquoi", "historique des décisions"] },
      { to: "/invest/mandat", label: "Mandat", icon: MandateIcon,
        aliases: ["limites", "risque", "plafonds", "armement", "autonomie",
                  "règles", "liste blanche"] },
      { to: "/invest/modele", label: "Modèle de décision", icon: DecisionModelIcon,
        aliases: ["jev", "ia", "modèle", "vllm", "ollama", "system one"] },
    ],
  },
  {
    title: "Les connexions",
    items: [
      { to: "/invest/courtiers", label: "Courtiers", icon: BrokersIcon,
        aliases: ["alpaca", "kraken", "binance", "bac à sable", "exécution",
                  "clé api courtier"] },
      // Réglages → Connexions lives here now: the market data keys feed the
      // indicators a decision is taken on, and they belong beside the brokers
      // rather than beside the household's password.
      { to: "/invest/connexions", label: "Connexions marché", icon: ConnectionsIcon,
        aliases: ["cours", "finnhub", "alpha vantage", "coingecko", "clé api",
                  "fournisseur de cours", "quota"] },
    ],
  },
  {
    title: "Le contrôle",
    items: [
      { to: "/invest/supervision", label: "Supervision", icon: OversightIcon,
        aliases: ["journal", "audit", "rejeu", "intégrité", "api", "claude",
                  "vérifier"] },
    ],
  },
];

export const ENVIRONMENTS: Environment[] = [
  {
    id: "finances",
    label: "Finances",
    tagline: "Le grand livre du foyer : comptes, budgets, objectifs.",
    icon: FinanceEnvironmentIcon,
    home: "/",
    // Everything that is not the investment environment. Listed as the empty
    // prefix so `environmentFor` can fall through to it without a special case.
    prefixes: [""],
    sections: FINANCE_SECTIONS,
  },
  {
    id: "investissement",
    label: "Investissement",
    tagline: "Le pilotage : marché, décisions, mandat, exécution.",
    icon: InvestEnvironmentIcon,
    home: "/invest",
    prefixes: ["/invest"],
    sections: INVESTMENT_SECTIONS,
  },
];

export const FINANCES = ENVIRONMENTS[0];
export const INVESTISSEMENT = ENVIRONMENTS[1];

/** The finance sidebar. Kept exported because it is the default environment. */
export const NAV_SECTIONS: NavSection[] = FINANCE_SECTIONS;

function stamp(environment: Environment): NavItem[] {
  return environment.sections.flatMap((section) =>
    section.items.map((item) => ({ ...item, environment: environment.id })),
  );
}

/**
 * Every destination in BOTH environments, flat — what the header's search
 * reads.
 *
 * The search deliberately looks across the switcher: someone typing « mandat »
 * from the Transactions screen wants the mandate, and a search that only saw
 * the environment they happen to be in would answer « rien trouvé » about a
 * screen that exists. Each entry carries its `environment` so the dialog can
 * say which half it is in.
 */
export const SCREENS: NavItem[] = ENVIRONMENTS.flatMap(stamp);

/**
 * Which environment a URL belongs to.
 *
 * Longest matching prefix wins, so `/invest/mandat` resolves to the investment
 * environment rather than to the finance one's catch-all. An unknown path
 * lands in Finances, which is where an unknown path in this application has
 * always landed.
 */
export function environmentFor(pathname: string): Environment {
  let best = ENVIRONMENTS[0];
  let bestLength = -1;
  for (const environment of ENVIRONMENTS) {
    for (const prefix of environment.prefixes) {
      const matches =
        prefix === "" ||
        pathname === prefix ||
        pathname.startsWith(`${prefix}/`);
      if (matches && prefix.length > bestLength) {
        best = environment;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

/** The other environment, for the switcher's one-key toggle. */
export function otherEnvironment(current: Environment): Environment {
  return current.id === "finances" ? INVESTISSEMENT : FINANCES;
}
