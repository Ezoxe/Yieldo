import { useEffect, useState } from "react";

import type { ResolvedTheme } from "./theme";

/**
 * Which of the two themes is painted right now, read from the document rather
 * than from React context.
 *
 * `main.tsx` stamps `data-theme` on `<html>` before the first paint and
 * `ThemeProvider` rewrites it on every preference change, so the attribute is
 * the one place both boots agree on. Reading it here means a component can
 * hand a colour to something outside the cascade — a canvas, a WebGL material
 * — without being mounted under a provider it does not otherwise need.
 *
 * Dark is the fallback, the way it is everywhere else in the application.
 */
export function readDocumentTheme(): ResolvedTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function useResolvedTheme(): ResolvedTheme {
  const [resolved, setResolved] = useState<ResolvedTheme>(readDocumentTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => setResolved(readDocumentTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    // The attribute can have changed between the first render and this effect.
    setResolved(readDocumentTheme());
    return () => observer.disconnect();
  }, []);

  return resolved;
}
