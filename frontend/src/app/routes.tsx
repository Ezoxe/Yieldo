import { createBrowserRouter, useNavigate } from "react-router";

import { LoginPage } from "../features/auth/LoginPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { RequireAuth } from "../features/auth/RequireAuth";
import { useSession } from "../features/auth/session";
import { AppShell } from "./AppShell";

// Placeholder screens for the routes whose real implementation lands in later
// tasks (18: import wizard, 19: transactions view, 20: overview dashboard).
// Task 17 only wires the routing and the auth guard around them.
function OverviewPlaceholder() {
  return <p>Vue d'ensemble — à venir.</p>;
}

function TransactionsPlaceholder() {
  return <p>Transactions — à venir.</p>;
}

function CategoriesPlaceholder() {
  return <p>Catégories — à venir.</p>;
}

function ImportPlaceholder() {
  return <p>Import — à venir.</p>;
}

// The full Réglages screen (density, animation toggle, admin registration
// switch) is out of scope for task 17 — only the bare minimum the plan calls
// out as required from this task onward: a way to sign out.
function SettingsPlaceholder() {
  const userName = useSession((state) => state.user?.name ?? "");
  const logout = useSession((state) => state.logout);
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/connexion", { replace: true });
  }

  return (
    <section>
      <h1>Réglages</h1>
      <p>Connecté en tant que {userName}.</p>
      <button type="button" onClick={handleLogout}>
        Se déconnecter
      </button>
    </section>
  );
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
          { path: "import", element: <ImportPlaceholder /> },
          { path: "reglages", element: <SettingsPlaceholder /> },
        ],
      },
    ],
  },
]);
