import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

import { SIGNATURE_EASE } from "./variants";
import { useReducedMotion } from "./useReducedMotion";

interface SwapProps {
  /**
   * What is on screen. When it changes, the old content leaves and the new
   * content arrives — a month key, a tab name, a period preset.
   */
  swapKey: string;
  /**
   * Which way the new content comes from. `1` = it arrives from the right
   * (moving forward in time), `-1` = from the left. `0` = a straight
   * cross-fade, for a change with no direction to it.
   */
  direction?: 1 | -1 | 0;
  children: ReactNode;
  className?: string;
}

/** How far the content travels, in px. Small on purpose: this is a change of
 *  content, not a change of page. */
const TRAVEL = 18;

/**
 * A change of content that reads as a movement rather than as a repaint.
 *
 * `mode="popLayout"`, not the default: the outgoing content is taken out of
 * flow the instant it starts leaving, so the incoming content occupies the
 * space immediately and the page never grows to hold both at once. With the
 * default mode a month with twelve categories replacing one with three makes
 * the page jump to the sum of the two and back.
 *
 * Under reduced motion the children are returned as they are — not a zero
 * duration animation, which still risks leaving content stuck at opacity 0 if
 * the animation never runs.
 */
export function Swap({ swapKey, direction = 0, children, className }: SwapProps) {
  const reduced = useReducedMotion();
  if (reduced) return <>{children}</>;

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={swapKey}
        className={className}
        initial={{ opacity: 0, x: direction * TRAVEL }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: direction * -TRAVEL }}
        transition={{ duration: 0.26, ease: SIGNATURE_EASE }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
