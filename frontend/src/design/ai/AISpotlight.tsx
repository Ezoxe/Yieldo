import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useReducedMotion } from "../motion/useReducedMotion";
import "./spotlight.css";

interface SpotlightState {
  /** The `data-ai-target` currently lit, or null. */
  active: string | null;
  /** True while the assistant is walking the reader through something and the
   *  rest of the page is dimmed behind it. */
  dimmed: boolean;
  /**
   * Light one target. Scrolls it into view when it is off screen, and clears
   * itself after `HOLD_MS` so the page does not stay decorated for ever.
   */
  spotlight: (id: string, options?: { dim?: boolean }) => void;
  /** Light one target for as long as the pointer stays on the chip. */
  preview: (id: string | null) => void;
  clear: () => void;
  /** Whether an element carrying this id is in the document right now. A chip
   *  for something that is not on this screen navigates first. */
  exists: (id: string) => boolean;
}

const SpotlightContext = createContext<SpotlightState | null>(null);

/**
 * How long a clicked spotlight holds before it fades on its own.
 *
 * Long enough to look at the thing, short enough that a reader who wanders off
 * does not come back to a page still ringed in violet. A hover preview is not
 * on this clock — it ends when the pointer leaves.
 */
const HOLD_MS = 6000;

export function AISpotlightProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  const [dimmed, setDimmed] = useState(false);
  const reduced = useReducedMotion();
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setActive(null);
    setDimmed(false);
  }, []);

  const exists = useCallback(
    (id: string) => document.querySelector(`[data-ai-target="${CSS.escape(id)}"]`) !== null,
    [],
  );

  const spotlight = useCallback(
    (id: string, options?: { dim?: boolean }) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      setActive(id);
      setDimmed(options?.dim ?? false);

      // Scrolled into view only when it is not already in it: a page that
      // jumps when the reader can already see the thing reads as a glitch.
      const node = document.querySelector(`[data-ai-target="${CSS.escape(id)}"]`);
      if (node instanceof HTMLElement && !isFullyVisible(node)) {
        node.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
      }

      timer.current = window.setTimeout(() => {
        setActive(null);
        setDimmed(false);
        timer.current = null;
      }, HOLD_MS);
    },
    [reduced],
  );

  const preview = useCallback((id: string | null) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setActive(id);
    setDimmed(false);
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  /**
   * Puts `data-ai-active` on the node the id names, and takes it off every
   * other.
   *
   * Imperative, and safe to be: React patches the attributes a component
   * declares, and no component in this app declares `data-ai-active`. It only
   * declares `data-ai-target`, which is the convention — a component becomes
   * pointable by carrying one attribute and nothing else. The alternative was
   * a hook call in every card, which would have made "add a target" a change
   * to that card's props rather than one attribute.
   *
   * `useSpotlightTarget` below is still exported for anything that would
   * rather React owned the attribute; both routes end at the same selector.
   */
  useEffect(() => {
    const previously = document.querySelectorAll("[data-ai-active]");
    previously.forEach((node) => node.removeAttribute("data-ai-active"));
    if (active === null) return;
    document
      .querySelector(`[data-ai-target="${CSS.escape(active)}"]`)
      ?.setAttribute("data-ai-active", "");
  }, [active]);

  const value = useMemo(
    () => ({ active, dimmed, spotlight, preview, clear, exists }),
    [active, dimmed, spotlight, preview, clear, exists],
  );

  return (
    <SpotlightContext.Provider value={value}>
      {children}
      {dimmed ? <div className="yd-spotlight__veil" aria-hidden="true" onClick={clear} /> : null}
    </SpotlightContext.Provider>
  );
}

/** Whether the whole element is inside the viewport already. */
function isFullyVisible(node: HTMLElement): boolean {
  const box = node.getBoundingClientRect();
  return box.top >= 0 && box.bottom <= (window.innerHeight || 0);
}

/**
 * The assistant's side of the wire: light something, or ask whether it is here
 * to be lit.
 *
 * Returns a no-op outside the provider rather than throwing. The provider
 * wraps the authenticated shell; a component rendered on the login screen, or
 * in a unit test that mounts it alone, must not crash for want of a feature it
 * is not using.
 */
export function useAISpotlight(): SpotlightState {
  return (
    useContext(SpotlightContext) ?? {
      active: null,
      dimmed: false,
      spotlight: () => {},
      preview: () => {},
      clear: () => {},
      exists: () => false,
    }
  );
}

/**
 * The other side: what a component spreads onto its own element to become
 * pointable.
 *
 *     const spot = useSpotlightTarget("kpi-autonomie");
 *     <BentoCell {...spot}>…</BentoCell>
 *
 * `data-ai-active` is what `spotlight.css` styles, so React owns the attribute
 * and nothing reaches into the DOM to add a class behind its back — which is
 * how an imperatively-added class disappears at the next re-render.
 */
export function useSpotlightTarget(id: string): {
  "data-ai-target": string;
  "data-ai-active"?: "" | undefined;
} {
  const { active } = useAISpotlight();
  return {
    "data-ai-target": id,
    "data-ai-active": active === id ? "" : undefined,
  };
}

/**
 * A wrapper for the cases where spreading props onto the component is awkward
 * — a third-party element, or a group of nodes that light together.
 */
export function SpotlightTarget({
  id,
  className = "",
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const spot = useSpotlightTarget(id);
  return (
    <div className={`yd-spotlight-wrap ${className}`.trim()} {...spot}>
      {children}
    </div>
  );
}
