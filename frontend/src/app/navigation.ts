import {
  AlertsIcon,
  AnalysisIcon,
  AssistantIcon,
  BudgetsIcon,
  CashflowIcon,
  CategoriesIcon,
  ConnectionsIcon,
  DebtsIcon,
  ExportIcon,
  FeasibilityIcon,
  GoalsIcon,
  ImportIcon,
  OverviewIcon,
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

export const NAV_SECTIONS: NavSection[] = [
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
      { to: "/reglages/connexions", label: "Connexions", icon: ConnectionsIcon,
        aliases: ["modèle", "clé api", "fournisseur"] },
    ],
  },
];

/** Every destination, flat, in sidebar order — what the header's search reads. */
export const SCREENS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);
