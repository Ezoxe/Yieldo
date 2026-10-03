import { animate } from "motion";
import { useEffect, useRef, useState } from "react";

import { figureMemory } from "./sessionMemory";
import { useReducedMotion } from "./useReducedMotion";
import { QUART_OUT } from "./variants";

interface AnimatedNumberProps {
  value: number;
  format: (value: number) => string;
  /**
   * The figure's name in the session memory (`overview.net`,
   * `budgets.total`…). With one, a figure that changed since the reader last
   * saw it rolls from that value; without one it only rolls between two
   * renders of the same screen.
   */
  memoryKey?: string;
  /** Seconds. */
  duration?: number;
  className?: string;
  /** Once per change, with the value the reader saw and the value now — what
   *  a DeltaPill prints. Never called for a figure that did not move. */
  onChange?: (previous: number, next: number) => void;
}

/**
 * A figure that moves only when it has something to say.
 *
 * The first time a figure is seen it is simply shown: counting up from zero
 * on every visit (what CountUp did) is decoration, the same figure re-earned
 * on each mount. When the figure differs from what the reader last saw — an
 * import landed, a ceiling was saved, the month changed — it rolls from the
 * old value to the new one in 640ms, so the change itself is visible. Nothing
 * changed, nothing moves.
 *
 * Motion off (the Réglages switch or the OS) shows the value at once and
 * still remembers it. A screen reader gets the true value as the label; the
 * passing digits are `aria-hidden`.
 */
export function AnimatedNumber({
  value,
  format,
  memoryKey,
  duration = 0.64,
  className = "",
  onChange,
}: AnimatedNumberProps) {
  const reduced = useReducedMotion();
  // Where the figure stands before this render's value: what the reader last
  // saw of it, or — the first time — the value itself, which means no roll.
  const [start] = useState(() =>
    memoryKey === undefined ? value : (figureMemory.recall(memoryKey) ?? value),
  );
  const [displayed, setDisplayed] = useState(reduced ? value : start);
  const shown = useRef(reduced ? value : start);
  const changed = useRef(onChange);
  changed.current = onChange;

  useEffect(() => {
    if (memoryKey !== undefined) figureMemory.remember(memoryKey, value);
    const from = shown.current;
    if (from === value) return;
    changed.current?.(from, value);
    if (reduced) {
      shown.current = value;
      setDisplayed(value);
      return;
    }
    const controls = animate(from, value, {
      duration,
      ease: QUART_OUT,
      onUpdate: (latest) => {
        shown.current = latest;
        setDisplayed(latest);
      },
      onComplete: () => {
        shown.current = value;
      },
    });
    return () => controls.stop();
  }, [value, duration, reduced, memoryKey]);

  return (
    <span role="status" aria-label={format(value)} className={`yd-num ${className}`.trim()}>
      <span aria-hidden="true">{format(reduced ? value : displayed)}</span>
    </span>
  );
}
