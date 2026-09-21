import { Suspense, lazy, type ComponentType } from "react";
import { createBrowserRouter } from "react-router";

import { PageSkeleton } from "../design/PageSkeleton";
import { LoginPage } from "../features/auth/LoginPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { RequireAuth } from "../features/auth/RequireAuth";
import { AppShellRoute, HomeRoute } from "./HomeRoute";

/**
 * One screen, loaded when it is first asked for.
 *
 * Every screen used to be imported here statically, which put twenty-two
 * screens, every chart and the charting library into the one 2 MB bundle a
 * reader downloaded before the sign-in form could paint. A screen's code now
 * travels with the first click on it, and `PageSkeleton` stands where it will
 * land in the meantime.
 *
 * The screens export named components, not defaults — that is the codebase's
 * convention and it stays; `pick` adapts a named export to what `lazy` wants.
 */
function screen<M extends Record<string, unknown>>(
  load: () => Promise<M>,
  pick: (module: M) => ComponentType,
) {
  const Component = lazy(() => load().then((module) => ({ default: pick(module) })));
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Component />
    </Suspense>
  );
}

const overview = screen(() => import("../features/overview/OverviewPage"), (m) => m.OverviewPage);
const transactions = screen(
  () => import("../features/transactions/TransactionsPage"),
  (m) => m.TransactionsPage,
);
const budgets = screen(() => import("../features/budgets/BudgetsPage"), (m) => m.BudgetsPage);
const recurrences = screen(
  () => import("../features/recurrences/RecurrencesPage"),
  (m) => m.RecurrencesPage,
);
const plan = screen(() => import("../features/plan/PlanPage"), (m) => m.PlanPage);
const cashflow = screen(() => import("../features/cashflow/CashflowPage"), (m) => m.CashflowPage);
const analysis = screen(() => import("../features/analysis/AnalysisPage"), (m) => m.AnalysisPage);
const debts = screen(() => import("../features/debts/DebtsPage"), (m) => m.DebtsPage);
const goals = screen(() => import("../features/goals/GoalsPage"), (m) => m.GoalsPage);
const suivi = screen(() => import("../features/engagement/SuiviPage"), (m) => m.SuiviPage);
const alerts = screen(() => import("../features/alerts/AlertsPage"), (m) => m.AlertsPage);
const patrimoine = screen(
  () => import("../features/portfolio/PatrimoinePage"),
  (m) => m.PatrimoinePage,
);
const projection = screen(
  () => import("../features/projection/ProjectionPage"),
  (m) => m.ProjectionPage,
);
const feasibility = screen(
  () => import("../features/feasibility/FeasibilityPage"),
  (m) => m.FeasibilityPage,
);
const assistant = screen(
  () => import("../features/assistant/AssistantPage"),
  (m) => m.AssistantPage,
);
const proposals = screen(() => import("../features/agent/ProposalsPage"), (m) => m.ProposalsPage);
const exportPage = screen(() => import("../features/export/ExportPage"), (m) => m.ExportPage);
const simulators = screen(
  () => import("../features/simulators/SimulatorsPage"),
  (m) => m.SimulatorsPage,
);
const categories = screen(
  () => import("../features/categories/CategoriesPage"),
  (m) => m.CategoriesPage,
);
const importPage = screen(() => import("../features/import/ImportPage"), (m) => m.ImportPage);
const settings = screen(() => import("../features/settings/SettingsPage"), (m) => m.SettingsPage);
const shibiSheet = screen(() => import("../features/shibi/ShibiSheetPage"), (m) => m.ShibiSheetPage);
const connections = screen(
  () => import("../features/connections/ConnectionsPage"),
  (m) => m.ConnectionsPage,
);

// The Investissement environment. Its own prefix, its own sidebar
// (`app/navigation.ts`), and its own six screens — see `EnvironmentSwitcher`
// on why the two halves of the application are separated rather than folded
// into five more sidebar sections.
const controlRoom = screen(
  () => import("../features/invest/ControlRoomPage"),
  (m) => m.ControlRoomPage,
);
const investDecisions = screen(
  () => import("../features/invest/DecisionsPage"),
  (m) => m.DecisionsPage,
);
const mandate = screen(() => import("../features/invest/MandatePage"), (m) => m.MandatePage);
const brokers = screen(() => import("../features/invest/BrokersPage"), (m) => m.BrokersPage);
const decisionModel = screen(() => import("../features/invest/ModelPage"), (m) => m.ModelPage);
const oversight = screen(
  () => import("../features/invest/OversightPage"),
  (m) => m.OversightPage,
);

// Development-only instrument, not a shipped screen: /design-systeme renders
// every visual primitive on one page so they can be judged in a browser. It is
// registered only under `import.meta.env.DEV`, and is deliberately absent from
// the sidebar navigation in AppShell.tsx.
const devRoutes = import.meta.env.DEV
  ? [
      {
        path: "design-systeme",
        element: screen(
          () => import("../features/design-system/DesignSystemPage"),
          (m) => m.DesignSystemPage,
        ),
      },
    ]
  : [];

export const router = createBrowserRouter([
  { path: "/connexion", element: <LoginPage /> },
  { path: "/inscription", element: <RegisterPage /> },
  {
    // Deliberately not behind RequireAuth: an anonymous visitor here gets the
    // public landing page instead of a redirect to /connexion. HomeRoute is the
    // gate, and the index child below only ever renders through AppShell's
    // <Outlet />, which HomeRoute returns for an authenticated session alone.
    path: "/",
    element: <HomeRoute />,
    children: [{ index: true, element: overview }],
  },
  {
    // Every other authenticated route keeps the phase-1 guard.
    element: <RequireAuth />,
    children: [
      {
        element: <AppShellRoute />,
        children: [
          { path: "transactions", element: transactions },
          { path: "budgets", element: budgets },
          { path: "recurrences", element: recurrences },
          { path: "plan", element: plan },
          { path: "tresorerie", element: cashflow },
          { path: "analyse", element: analysis },
          { path: "dettes", element: debts },
          { path: "objectifs", element: goals },
          { path: "suivi", element: suivi },
          { path: "alertes", element: alerts },
          { path: "patrimoine", element: patrimoine },
          { path: "projection", element: projection },
          { path: "faisabilite", element: feasibility },
          { path: "assistant", element: assistant },
          { path: "propositions", element: proposals },
          { path: "export", element: exportPage },
          { path: "simulateurs", element: simulators },
          { path: "categories", element: categories },
          { path: "import", element: importPage },
          { path: "reglages", element: settings },
          // The mascot's model sheet. Deliberately absent from the sidebar:
          // it is a reference for whoever works on Yieldo next, reached from
          // the switch in Reglages that turns him off, not a screen a
          // household visits to read its own figures.
          { path: "reglages/shibi", element: shibiSheet },
          // Réglages -> Connexions. A route of its own rather than a section
          // of /reglages: every French refusal in `market/client.py` and
          // `llm/client.py` points the reader at "Réglages -> Connexions",
          // and a URL they can be sent to is what makes that sentence
          // actionable.
          //
          // The screen now LIVES in the Investissement environment, at
          // /invest/connexions: the market-data keys feed the indicators a
          // trading decision is taken on, and they belong beside the brokers
          // rather than beside the household's password. This path stays
          // registered because those French refusals name it, and a sentence
          // pointing at a 404 is worse than no sentence.
          { path: "reglages/connexions", element: connections },

          // --- Investissement ---
          { path: "invest", element: controlRoom },
          { path: "invest/decisions", element: investDecisions },
          { path: "invest/mandat", element: mandate },
          { path: "invest/modele", element: decisionModel },
          { path: "invest/courtiers", element: brokers },
          { path: "invest/connexions", element: connections },
          { path: "invest/supervision", element: oversight },
          ...devRoutes,
        ],
      },
    ],
  },
]);
