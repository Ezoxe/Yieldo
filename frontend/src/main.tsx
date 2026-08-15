import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import { router } from "./app/routes";
import { DensityProvider } from "./app/DensityProvider";
import { ThemeProvider } from "./app/ThemeProvider";
import { applyMotionAttribute } from "./design/motion/motionPreference";
import {
  readStoredDensity,
  readStoredMotionDisabled,
  readStoredTheme,
  resolveTheme,
} from "./design/theme";
import { useSession } from "./features/auth/session";
// Self-hosted, bundled by Vite as local woff2. Never a CDN or a Google Fonts
// <link>: this app promises the operator that nothing leaves the machine, and
// an external font request would break that on the very first paint. The
// families they register are "Geist Variable" and "Geist Mono Variable", which
// is what --yd-font and --yd-font-mono name first.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
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

// Same reasoning as the theme above: apply the stored density before the
// first paint so there is no flash of the wrong spacing scale.
document.documentElement.dataset.density = readStoredDensity();

// And the same again for the Réglages "Animations" switch. Written here rather
// than only inside setDisabled so a reload with animations off never plays one
// frame of motion before React boots.
applyMotionAttribute(readStoredMotionDisabled());

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
        <DensityProvider>
          <RouterProvider router={router} />
        </DensityProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
