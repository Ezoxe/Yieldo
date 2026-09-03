import { createBrowserRouter } from "react-router";

import { AlertsPage } from "../features/alerts/AlertsPage";
import { AnalysisPage } from "../features/analysis/AnalysisPage";
import { AssistantPage } from "../features/assistant/AssistantPage";
import { ExportPage } from "../features/export/ExportPage";
import { LoginPage } from "../features/auth/LoginPage";
import { BudgetsPage } from "../features/budgets/BudgetsPage";
import { CashflowPage } from "../features/cashflow/CashflowPage";
import { ConnectionsPage } from "../features/connections/ConnectionsPage";
import { DebtsPage } from "../features/debts/DebtsPage";
import { DesignSystemPage } from "../features/design-system/DesignSystemPage";
import { SuiviPage } from "../features/engagement/SuiviPage";
import { FeasibilityPage } from "../features/feasibility/FeasibilityPage";
import { GoalsPage } from "../features/goals/GoalsPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { RequireAuth } from "../features/auth/RequireAuth";
import { ImportPage } from "../features/import/ImportPage";
import { OverviewPage } from "../features/overview/OverviewPage";
import { PatrimoinePage } from "../features/portfolio/PatrimoinePage";
import { ProjectionPage } from "../features/projection/ProjectionPage";
import { RecurrencesPage } from "../features/recurrences/RecurrencesPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { SimulatorsPage } from "../features/simulators/SimulatorsPage";
import { TransactionsPage } from "../features/transactions/TransactionsPage";
import { AppShellRoute, HomeRoute } from "./HomeRoute";

// Placeholder screen for the one route whose real implementation is still
// pending. /, /transactions, /budgets, /reglages and /import are real screens
// — see features/overview/OverviewPage.tsx, features/transactions/TransactionsPage.tsx,
// features/budgets/BudgetsPage.tsx, features/settings/SettingsPage.tsx and
// features/import/ImportPage.tsx. Until /categories exists, /budgets is the
// only place a monthly budget can be set.
function CategoriesPlaceholder() {
  return <p>Catégories — à venir.</p>;
}

// Development-only instrument, not a shipped screen: /design-systeme renders
// every visual primitive on one page so they can be judged in a browser. It is
// registered only under `import.meta.env.DEV`, and is deliberately absent from
// the sidebar navigation in AppShell.tsx.
const devRoutes = import.meta.env.DEV
  ? [{ path: "design-systeme", element: <DesignSystemPage /> }]
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
    children: [{ index: true, element: <OverviewPage /> }],
  },
  {
    // Every other authenticated route keeps the phase-1 guard.
    element: <RequireAuth />,
    children: [
      {
        element: <AppShellRoute />,
        children: [
          { path: "transactions", element: <TransactionsPage /> },
          { path: "budgets", element: <BudgetsPage /> },
          { path: "recurrences", element: <RecurrencesPage /> },
          { path: "tresorerie", element: <CashflowPage /> },
          { path: "analyse", element: <AnalysisPage /> },
          { path: "dettes", element: <DebtsPage /> },
          { path: "objectifs", element: <GoalsPage /> },
          { path: "suivi", element: <SuiviPage /> },
          { path: "alertes", element: <AlertsPage /> },
          { path: "patrimoine", element: <PatrimoinePage /> },
          { path: "projection", element: <ProjectionPage /> },
          { path: "faisabilite", element: <FeasibilityPage /> },
          { path: "assistant", element: <AssistantPage /> },
          { path: "export", element: <ExportPage /> },
          { path: "simulateurs", element: <SimulatorsPage /> },
          { path: "categories", element: <CategoriesPlaceholder /> },
          { path: "import", element: <ImportPage /> },
          { path: "reglages", element: <SettingsPage /> },
          // Réglages -> Connexions. A route of its own rather than a section
          // of /reglages: every French refusal in `market/client.py` and
          // `llm/client.py` points the reader at "Réglages -> Connexions",
          // and a URL they can be sent to is what makes that sentence
          // actionable.
          { path: "reglages/connexions", element: <ConnectionsPage /> },
          ...devRoutes,
        ],
      },
    ],
  },
]);
