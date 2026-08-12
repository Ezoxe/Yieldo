import { createBrowserRouter } from "react-router";

import { LoginPage } from "../features/auth/LoginPage";
import { DesignSystemPage } from "../features/design-system/DesignSystemPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { RequireAuth } from "../features/auth/RequireAuth";
import { useSession } from "../features/auth/session";
import { ImportPage } from "../features/import/ImportPage";
import { OverviewPage } from "../features/overview/OverviewPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { TransactionsPage } from "../features/transactions/TransactionsPage";
import { AppShell } from "./AppShell";

// Placeholder screen for the one route whose real implementation is still
// pending. /, /transactions, /reglages and /import are real screens — see
// features/overview/OverviewPage.tsx, features/transactions/TransactionsPage.tsx,
// features/settings/SettingsPage.tsx and features/import/ImportPage.tsx.
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
          { index: true, element: <OverviewPage /> },
          { path: "transactions", element: <TransactionsPage /> },
          { path: "categories", element: <CategoriesPlaceholder /> },
          { path: "import", element: <ImportPage /> },
          { path: "reglages", element: <SettingsPage /> },
          ...devRoutes,
        ],
      },
    ],
  },
]);
