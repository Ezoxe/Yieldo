import { createBrowserRouter } from "react-router";

import { LoginPage } from "../features/auth/LoginPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { RequireAuth } from "../features/auth/RequireAuth";
import { useSession } from "../features/auth/session";
import { ImportPage } from "../features/import/ImportPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { AppShell } from "./AppShell";

// Placeholder screens for the routes whose real implementation lands in later
// tasks (19: transactions view, 20: overview dashboard). /reglages and /import
// are real screens — see features/settings/SettingsPage.tsx and
// features/import/ImportPage.tsx.
function OverviewPlaceholder() {
  return <p>Vue d'ensemble — à venir.</p>;
}

function TransactionsPlaceholder() {
  return <p>Transactions — à venir.</p>;
}

function CategoriesPlaceholder() {
  return <p>Catégories — à venir.</p>;
}

function AppShellRoute() {
  const userName = useSession((state) => state.user?.name ?? "");
  return <AppShell userName={userName} />;
}

export const router = createBrowserRouter([
  { path: "/connexion", element: <LoginPage /> },
  { path: "/inscription", element: <RegisterPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShellRoute />,
        children: [
          { index: true, element: <OverviewPlaceholder /> },
          { path: "transactions", element: <TransactionsPlaceholder /> },
          { path: "categories", element: <CategoriesPlaceholder /> },
          { path: "import", element: <ImportPage /> },
          { path: "reglages", element: <SettingsPage /> },
        ],
      },
    ],
  },
]);
