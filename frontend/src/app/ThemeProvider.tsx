import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

import {
  readStoredTheme,
  resolveTheme,
  storeTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "../design/theme";
import { useReducedMotion } from "../design/motion/useReducedMotion";

/** Where on screen a theme change was asked for, in viewport pixels. */
export interface RevealOrigin {
  x: number;
  y: number;
}

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  /**
   * Changes the theme. Given the point it was asked from, the new theme
   * opens in a circle from there (see `revealTheme`); without one, at once.
   */
  setPreference: (next: ThemePreference, origin?: RevealOrigin) => void;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => {
    ready: Promise<void>;
    finished: Promise<void>;
  };
};

/**
 * The page is pictured once in the old colours, the new theme is applied
 * underneath, and a circle opens from `origin` until it covers the screen
 * (520ms, the signature curve). `data-vt="theme"` on the root makes the
 * whole page ONE picture for that moment (viewTransitions.css): the regions
 * that travel on their own when a screen changes stay inside it.
 *
 * Returns false when the browser cannot do it, so the caller applies the
 * theme the ordinary way.
 */
function revealTheme(apply: () => void, origin: RevealOrigin): boolean {
  const doc = document as ViewTransitionDocument;
  if (typeof doc.startViewTransition !== "function") return false;
  const root = document.documentElement;
  root.dataset.vt = "theme";
  const transition = doc.startViewTransition(apply);
  const radius = Math.hypot(
    Math.max(origin.x, window.innerWidth - origin.x),
    Math.max(origin.y, window.innerHeight - origin.y),
  );
  const at = `at ${origin.x}px ${origin.y}px`;
  transition.ready.then(
    () => {
      root.animate?.(
        { clipPath: [`circle(0px ${at})`, `circle(${radius}px ${at})`] },
        {
          duration: 520,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    },
    // Skipped (another transition started first): the theme was still
    // applied by `apply`, there is just no circle to draw.
    () => undefined,
  );
  const done = () => {
    delete root.dataset.vt;
  };
  transition.finished.then(done, done);
  return true;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredTheme);
  const [prefersDark, setPrefersDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true,
  );

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const update = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const resolved = resolveTheme(preference, prefersDark);

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setPreference = useCallback(
    (next: ThemePreference, origin?: RevealOrigin) => {
      storeTheme(next);
      const nextResolved = resolveTheme(next, prefersDark);
      const changes = nextResolved !== document.documentElement.dataset.theme;
      if (origin !== undefined && changes && !reduced) {
        const revealed = revealTheme(() => {
          // Inside the transition's update: the DOM must hold the new theme
          // by the time this returns, so the new picture is taken in it.
          flushSync(() => setPreferenceState(next));
          document.documentElement.dataset.theme = nextResolved;
        }, origin);
        if (revealed) return;
      }
      setPreferenceState(next);
    },
    [prefersDark, reduced],
  );

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme doit être utilisé dans un ThemeProvider");
  return context;
}
