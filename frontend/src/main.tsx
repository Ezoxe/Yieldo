import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { readStoredTheme, resolveTheme } from "./design/theme";
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

function App() {
  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100%" }}>
      <p className="yd-num" style={{ color: "var(--yd-text-muted)" }}>
        Yieldo — squelette frontend
      </p>
    </main>
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("L'élément racine #root est introuvable dans index.html.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
