import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import { router } from "./app/routes";
import { ThemeProvider } from "./app/ThemeProvider";
import { readStoredTheme, resolveTheme } from "./design/theme";
import { useSession } from "./features/auth/session";
import "./index.css";

// Resolve and apply the theme before the first paint so there is no flash
// of the wrong palette while React boots.
function applyResolvedTheme(): void {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveTheme(readStoredTheme(), prefersDark);
  document.documentElement.dataset.theme = resolved;
}

applyResolvedTheme();
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", applyResolvedTheme);

const queryClient = new QueryClient();

// The access token lives in memory only (never localStorage), so it is gone
// on every reload. Kicking this off here, before the router mounts, trades
// the HttpOnly refresh cookie (which does survive a reload) for a fresh
// token — RequireAuth shows a loading state until this settles, so it never
// races the router into bouncing an already-authenticated user to /connexion.
void useSession.getState().hydrate();

const container = document.getElementById("root");
if (!container) {
  throw new Error("L'élément racine #root est introuvable dans index.html.");
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
