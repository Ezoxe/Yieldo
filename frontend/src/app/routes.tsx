import { createBrowserRouter } from "react-router";

import { LoginPage } from "../features/auth/LoginPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { RequireAuth } from "../features/auth/RequireAuth";
import { useSession } from "../features/auth/session";
import { ImportPage } from "../features/import/ImportPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { TransactionsPage } from "../features/transactions/TransactionsPage";
import { AppShell } from "./AppShell";

// Placeholder screens for the routes whose real implementation lands in a
// later task (20: overview dashboard). /transactions, /reglages and /import
// are real screens — see features/transactions/TransactionsPage.tsx,
// features/settings/SettingsPage.tsx and features/import/ImportPage.tsx.
function OverviewPlaceholder() {
  return <p>Vue d'ensemble — à venir.</p>;
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
          { path: "transactions", element: <TransactionsPage /> },
          { path: "categories", element: <CategoriesPlaceholder /> },
          { path: "import", element: <ImportPage /> },
          { path: "reglages", element: <SettingsPage /> },
        ],
      },
    ],
  },
]);
