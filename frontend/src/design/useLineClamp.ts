import { useLayoutEffect, useState, type RefObject } from "react";

interface LineClamp {
  /** The clamp hides something — a « Lire la suite » has text to reveal. */
  clamped: boolean;
  expanded: boolean;
  toggle: () => void;
}

/**
 * Whether a block cut by `line-clamp` actually hides part of itself.
 *
 * Measured rather than assumed: a « Lire la suite » under a lead that already
 * fits in its two lines would promise text that is not there. Re-measured when
 * the block is resized (a phone turned on its side), and not measured at all
 * while `active` is false — on a wide screen nothing is clamped.
 */
export function useLineClamp(ref: RefObject<HTMLElement | null>, active: boolean): LineClamp {
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !active || expanded) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, active, expanded]);

  return {
    // Once open the block no longer overflows, but the control must stay — it
    // is how the reader closes it again.
    clamped: active && (overflows || expanded),
    expanded,
    toggle: () => setExpanded((open) => !open),
  };
}
